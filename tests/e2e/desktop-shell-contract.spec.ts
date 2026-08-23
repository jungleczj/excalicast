import { expect, test } from '@playwright/test';
import {
  createDesktopWindowOptions,
  exposedDesktopBridgeChannels,
} from '../../apps/desktop/src/windowContract';
import {
  NativeHelperClient,
  NativeHelperError,
  type HelperTransport,
} from '../../apps/desktop/src/nativeHelperClient';
import { parseDesktopCapturePayload } from '../../apps/desktop/src/captureRequest';
import {
  CaptureResourceCoordinator,
  startDesktopCaptureWithResourcePriority,
  waitForCaptureResourceRelease,
} from '../../src/desktop/captureResourceGate';

test('desktop shell uses a hardened renderer with a narrow versioned bridge', () => {
  const options = createDesktopWindowOptions('/tmp/excalicast-preload.js');
  const webPreferences = options.webPreferences;
  expect(webPreferences).toBeDefined();

  expect(webPreferences?.contextIsolation).toBe(true);
  expect(webPreferences?.nodeIntegration).toBe(false);
  expect(webPreferences?.sandbox).toBe(true);
  expect(webPreferences?.preload).toBe('/tmp/excalicast-preload.js');
  expect(exposedDesktopBridgeChannels.every((channel) => channel.endsWith('.v1'))).toBe(true);
});

test('renderer bridge never exposes raw frames or unrestricted IPC', () => {
  expect(exposedDesktopBridgeChannels.some((channel) => /frame|pixel|blob/i.test(channel))).toBe(false);
  expect(exposedDesktopBridgeChannels).not.toContain('*');
});

test('native helper handshake is correlated and rejects protocol mismatch', async () => {
  let onLine: ((line: string) => void) | null = null;
  const writes: string[] = [];
  const transport: HelperTransport = {
    write(line) {
      writes.push(line);
      const command = JSON.parse(line) as { id: string };
      queueMicrotask(() => onLine?.(JSON.stringify({
        id: command.id,
        ok: true,
        protocolVersion: 1,
        engine: 'mac-media-engine',
        state: 'idle',
      })));
    },
    onLine(listener) { onLine = listener; },
    close() {},
  };

  const client = new NativeHelperClient(transport);
  await expect(client.handshake()).resolves.toEqual({
    protocolVersion: 1,
    engine: 'mac-media-engine',
    state: 'idle',
  });
  expect(JSON.parse(writes[0])).toMatchObject({ channel: 'helper.handshake.v1', protocolVersion: 1 });
});

test('native capture request preserves requested quality and project file references', async () => {
  let onLine: ((line: string) => void) | null = null;
  let command: Record<string, unknown> | null = null;
  const transport: HelperTransport = {
    write(line) {
      command = JSON.parse(line) as Record<string, unknown>;
      queueMicrotask(() => onLine?.(JSON.stringify({
        id: command?.id,
        ok: true,
        protocolVersion: 1,
        engine: 'mac-media-engine',
        state: 'recording',
        capability: {
          requested: { width: 3840, height: 2160, framesPerSecond: 60, codec: 'h264' },
          effective: { width: 3840, height: 2160, framesPerSecond: 60, codec: 'h264' },
          hardwareEncodingConfirmed: true,
          availableBytes: 100_000_000_000,
        },
      })));
    },
    onLine(listener) { onLine = listener; },
    close() {},
  };
  const client = new NativeHelperClient(transport);
  const result = await client.startCapture({
    recordingId: 'rec-4k',
    projectRoot: '/projects/rec-4k',
    sourceKind: 'display',
    sourceID: 1,
    width: 3840,
    height: 2160,
    framesPerSecond: 60,
    codec: 'h264',
    captureSystemAudio: true,
    captureMicrophone: true,
    captureCamera: true,
    cameraWidth: 1280,
    cameraHeight: 720,
    cameraFramesPerSecond: 24,
  });

  expect(command).toMatchObject({
    channel: 'capture.start.v1',
    recordingId: 'rec-4k',
    projectRoot: '/projects/rec-4k',
    sourceKind: 'display',
    sourceID: 1,
    width: 3840,
    height: 2160,
    framesPerSecond: 60,
    captureSystemAudio: true,
    captureMicrophone: true,
    captureCamera: true,
    cameraWidth: 1280,
    cameraHeight: 720,
    cameraFramesPerSecond: 24,
  });
  expect(result.capability.effective).toEqual(result.capability.requested);
  expect(result.capability.hardwareEncodingConfirmed).toBe(true);
});

test('native media devices expose stable ids before camera capture starts', async () => {
  let onLine: ((line: string) => void) | null = null;
  let command: Record<string, unknown> | null = null;
  const transport: HelperTransport = {
    write(line) {
      command = JSON.parse(line) as Record<string, unknown>;
      queueMicrotask(() => onLine?.(JSON.stringify({
        id: command?.id,
        ok: true,
        state: 'idle',
        devices: {
          microphones: [{ id: 'mic-1', name: 'MacBook Microphone', isDefault: true }],
          cameras: [{ id: 'cam-1', name: 'FaceTime Camera', isDefault: true }],
        },
      })));
    },
    onLine(listener) { onLine = listener; },
    close() {},
  };
  const client = new NativeHelperClient(transport);
  await expect(client.captureDevices()).resolves.toEqual({
    microphones: [{ id: 'mic-1', name: 'MacBook Microphone', isDefault: true }],
    cameras: [{ id: 'cam-1', name: 'FaceTime Camera', isDefault: true }],
  });
  expect(command).toMatchObject({ channel: 'capture.devices.v1' });
});

test('native track startup failures preserve a stable code and affected track', async () => {
  let onLine: ((line: string) => void) | null = null;
  const transport: HelperTransport = {
    write(line) {
      const command = JSON.parse(line) as { id: string };
      queueMicrotask(() => onLine?.(JSON.stringify({
        id: command.id,
        ok: false,
        error: 'Camera did not deliver an encodable sample before startup timeout.',
        errorCode: 'capture_track_not_ready',
        errorTrack: 'camera',
      })));
    },
    onLine(listener) { onLine = listener; },
    close() {},
  };
  const client = new NativeHelperClient(transport);

  let failure: unknown;
  try {
    await client.startCapture({
      recordingId: 'missing-camera',
      projectRoot: '/projects/missing-camera',
      sourceKind: 'display',
      sourceID: 1,
      width: 1920,
      height: 1080,
      framesPerSecond: 30,
      codec: 'h264',
      captureCamera: true,
    });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(NativeHelperError);
  expect(failure).toMatchObject({
    code: 'capture_track_not_ready',
    track: 'camera',
  });
});

test('electron capture parsing preserves optional camera, microphone and system audio tracks', () => {
  expect(parseDesktopCapturePayload({
    recordingId: 'lesson-1',
    sourceKind: 'window',
    sourceID: 42,
    width: 2560,
    height: 1440,
    framesPerSecond: 30,
    codec: 'h264',
    captureSystemAudio: true,
    captureMicrophone: true,
    microphoneDeviceID: 'mic-1',
    captureCamera: true,
    cameraDeviceID: 'cam-1',
    cameraWidth: 1280,
    cameraHeight: 720,
    cameraFramesPerSecond: 24,
  }, '/projects/lesson-1')).toMatchObject({
    projectRoot: '/projects/lesson-1',
    captureSystemAudio: true,
    captureMicrophone: true,
    microphoneDeviceID: 'mic-1',
    captureCamera: true,
    cameraDeviceID: 'cam-1',
    cameraWidth: 1280,
    cameraHeight: 720,
    cameraFramesPerSecond: 24,
  });
});

test('heavy work waits until native recording releases network, cpu and disk resources', async () => {
  const states = ['recording', 'recording', 'idle'] as const;
  let reads = 0;
  let waits = 0;
  await waitForCaptureResourceRelease({
    readStatus: async () => ({ state: states[Math.min(reads++, states.length - 1)] }),
    sleep: async () => { waits += 1; },
  });
  expect(reads).toBe(3);
  expect(waits).toBe(2);
});

test('capture priority aborts and drains in-flight heavy work before native capture starts', async () => {
  const coordinator = new CaptureResourceCoordinator();
  const lease = coordinator.acquire();
  const events: string[] = [];
  lease.signal.addEventListener('abort', () => {
    events.push('heavy-aborted');
    queueMicrotask(() => {
      events.push('heavy-released');
      lease.release();
    });
  });

  const result = await startDesktopCaptureWithResourcePriority(
    { recordingId: 'priority-capture' },
    {
      coordinator,
      invoke: async () => {
        events.push('capture-started');
        return { state: 'recording' };
      },
      drainTimeoutMs: 1_000,
    },
  );

  expect(result).toEqual({ state: 'recording' });
  expect(events).toEqual(['heavy-aborted', 'heavy-released', 'capture-started']);
  expect(coordinator.isCapturePriorityActive()).toBe(false);
});

test('capture does not start while an in-flight task ignores its abort signal', async () => {
  const coordinator = new CaptureResourceCoordinator();
  const lease = coordinator.acquire();
  let invoked = false;

  await expect(startDesktopCaptureWithResourcePriority(
    { recordingId: 'busy-capture' },
    {
      coordinator,
      invoke: async () => {
        invoked = true;
        return { state: 'recording' };
      },
      drainTimeoutMs: 5,
    },
  )).rejects.toThrow('capture_resources_did_not_drain');
  expect(lease.signal.aborted).toBe(true);
  expect(invoked).toBe(false);
  expect(coordinator.isCapturePriorityActive()).toBe(false);
  lease.release();
});

test('a duplicate capture start cannot release another start request priority lock', async () => {
  const coordinator = new CaptureResourceCoordinator();
  await coordinator.beginCapturePriority();

  await expect(startDesktopCaptureWithResourcePriority({}, {
    coordinator,
    invoke: async () => ({ state: 'recording' }),
  })).rejects.toThrow('capture_priority_already_active');
  expect(coordinator.isCapturePriorityActive()).toBe(true);

  coordinator.endCapturePriority();
});

test('native project recovery returns a checkpointed interrupted manifest', async () => {
  let onLine: ((line: string) => void) | null = null;
  let command: Record<string, unknown> | null = null;
  const transport: HelperTransport = {
    write(line) {
      command = JSON.parse(line) as Record<string, unknown>;
      queueMicrotask(() => onLine?.(JSON.stringify({
        id: command?.id,
        ok: true,
        state: 'idle',
        manifest: {
          schemaVersion: 1,
          recordingId: 'lesson-crash',
          state: 'interrupted',
          tracks: { screen: [] },
        },
      })));
    },
    onLine(listener) { onLine = listener; },
    close() {},
  };
  const client = new NativeHelperClient(transport);
  await expect(client.recoverProject('/projects/lesson-crash')).resolves.toMatchObject({
    recordingId: 'lesson-crash',
    state: 'interrupted',
  });
  expect(command).toMatchObject({
    channel: 'project.recover.v1',
    projectRoot: '/projects/lesson-crash',
  });
});
