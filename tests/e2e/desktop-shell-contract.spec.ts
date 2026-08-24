import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDesktopInkWindowOptions,
  createDesktopTeleprompterWindowOptions,
  createDesktopWindowOptions,
  exposedDesktopBridgeChannels,
  exposedDesktopEventChannels,
  parseDesktopWindowMediaSourceId,
  isTrustedDesktopRendererUrl,
  resolveDesktopTeleprompterBounds,
} from '../../apps/desktop/src/windowContract';
import {
  NativeHelperClient,
  NativeHelperError,
  type HelperTransport,
} from '../../apps/desktop/src/nativeHelperClient';
import {
  mergeDesktopCaptureExclusions,
  parseDesktopCapturePayload,
} from '../../apps/desktop/src/captureRequest';
import {
  runNativeCaptureSoak,
  summarizeNativeCaptureSoak,
} from '../../apps/desktop/src/nativeCaptureSoak';
import { createNativeInkEventBatch } from '../../apps/desktop/src/inkEventBatch';
import { readNativeInkEventSegments } from '../../apps/desktop/src/inkEventReader';
import { readNativeMediaSegmentRange } from '../../apps/desktop/src/nativeMediaReader';
import {
  createNativeMediaResponse,
  nativeMediaUrl,
  parseMediaRange,
  parseNativeMediaUrl,
} from '../../apps/desktop/src/nativeMediaProtocol';
import {
  CaptureResourceCoordinator,
  startDesktopCaptureWithResourcePriority,
  waitForCaptureResourceRelease,
} from '../../src/desktop/captureResourceGate';
import {
  startDesktopAiCameraSession,
  type DesktopCaptureBridge,
} from '../../src/desktop/aiCameraSession';

test('native media protocol exposes only project-owned tracks and supports byte ranges', () => {
  expect(nativeMediaUrl('recording_123', 'system-audio')).toBe(
    'excalicast-media://project/recording_123/system-audio',
  );
  expect(parseNativeMediaUrl('excalicast-media://project/recording_123/camera')).toEqual({
    recordingId: 'recording_123',
    track: 'camera',
  });
  expect(parseMediaRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
  expect(parseMediaRange('bytes=-12', 100)).toEqual({ start: 88, end: 99 });
  expect(() => parseNativeMediaUrl('excalicast-media://project/secret/screen/extra')).toThrow(
    'native_media_url_invalid',
  );
});

test('native media protocol streams only the requested file range with seek headers', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'excalicast-native-protocol-'));
  try {
    const mediaPath = join(projectRoot, 'screen.mp4');
    await writeFile(mediaPath, Buffer.from([10, 11, 12, 13, 14, 15]));
    const response = await createNativeMediaResponse(new Request(
      'excalicast-media://project/recording_123/screen',
      { headers: { Range: 'bytes=2-4' } },
    ), mediaPath, 'video/mp4');

    expect(response.status).toBe(206);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-range')).toBe('bytes 2-4/6');
    expect(response.headers.get('content-length')).toBe('3');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([12, 13, 14]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

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

test('AI Camera starts native capture with independent system audio and recording microphone', async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const bridge: DesktopCaptureBridge = {
    async invoke(channel, payload) {
      calls.push({ channel, payload });
      if (channel === 'capture.permissions.v1') {
        return { screen: 'granted', microphone: 'granted', camera: 'granted', inputMonitoring: 'granted' };
      }
      if (channel === 'capture.devices.v1') {
        return {
          microphones: [{ id: 'mic-default', name: 'MacBook Microphone', isDefault: true }],
          cameras: [{ id: 'camera-default', name: 'FaceTime Camera', isDefault: true }],
        };
      }
      if (channel === 'capture.preflight.v1') {
        return {
          requested: { width: 2560, height: 1440, framesPerSecond: 30, codec: 'h264' },
          effective: { width: 2560, height: 1440, framesPerSecond: 30, codec: 'h264' },
          hardwareEncodingConfirmed: true,
          availableBytes: 100_000_000_000,
        };
      }
      if (channel === 'capture.start.v1') {
        return { state: 'recording', capability: {} };
      }
      if (channel === 'capture.stop.v1') return { state: 'idle' };
      throw new Error(`unexpected_channel:${channel}`);
    },
  };

  const session = await startDesktopAiCameraSession({
    bridge,
    recordingId: 'lesson-ai-camera',
    source: { kind: 'display', id: 8, width: 2560, height: 1440 },
    captureSystemAudio: true,
    captureMicrophone: true,
    camera: { enabled: true },
  });

  expect(calls.map((call) => call.channel)).toEqual([
    'capture.permissions.v1',
    'capture.devices.v1',
    'capture.preflight.v1',
    'capture.start.v1',
  ]);
  expect(calls.at(-1)?.payload).toMatchObject({
    recordingId: 'lesson-ai-camera',
    sourceKind: 'display',
    sourceID: 8,
    width: 2560,
    height: 1440,
    framesPerSecond: 30,
    codec: 'h264',
    captureSystemAudio: true,
    captureMicrophone: true,
    microphoneDeviceID: 'mic-default',
    captureCamera: true,
    cameraDeviceID: 'camera-default',
    cameraWidth: 1280,
    cameraHeight: 720,
    cameraFramesPerSecond: 24,
  });
  expect(session).toMatchObject({
    recordingId: 'lesson-ai-camera',
    state: 'recording',
    cameraDeviceID: 'camera-default',
    microphoneDeviceID: 'mic-default',
  });
  await session.stop();
  await session.stop();
  expect(calls.filter((call) => call.channel === 'capture.stop.v1')).toHaveLength(1);
});

test('AI Camera requests only the missing native permissions before device acquisition', async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const bridge: DesktopCaptureBridge = {
    async invoke(channel, payload) {
      calls.push({ channel, payload });
      if (channel === 'capture.permissions.v1') {
        return { screen: 'granted', microphone: 'not-determined', camera: 'not-determined', inputMonitoring: 'granted' };
      }
      if (channel === 'capture.request-permissions.v1') {
        return { screen: 'granted', microphone: 'granted', camera: 'granted', inputMonitoring: 'granted' };
      }
      if (channel === 'capture.devices.v1') {
        return {
          microphones: [{ id: 'mic-1', name: 'USB Mic', isDefault: true }],
          cameras: [{ id: 'cam-1', name: 'Studio Camera', isDefault: true }],
        };
      }
      if (channel === 'capture.preflight.v1') {
        return { hardwareEncodingConfirmed: true };
      }
      if (channel === 'capture.start.v1') return { state: 'recording' };
      if (channel === 'capture.stop.v1') return { state: 'idle' };
      throw new Error(`unexpected_channel:${channel}`);
    },
  };

  const session = await startDesktopAiCameraSession({
    bridge,
    recordingId: 'permission-retry',
    source: { kind: 'display', id: 1, width: 3024, height: 1964 },
    captureSystemAudio: true,
    captureMicrophone: true,
    camera: { enabled: true },
  });

  expect(calls[1]).toEqual({
    channel: 'capture.request-permissions.v1',
    payload: { captureMicrophone: true, captureCamera: true },
  });
  expect(calls.find((call) => call.channel === 'capture.start.v1')?.payload).toMatchObject({
    width: 2218,
    height: 1440,
    captureSystemAudio: true,
    captureMicrophone: true,
    captureCamera: true,
  });
  await session.stop();
});

test('AI Camera reports Input Monitoring preflight without trying to request it', async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const bridge: DesktopCaptureBridge = {
    async invoke(channel, payload) {
      calls.push({ channel, payload });
      if (channel === 'capture.permissions.v1') {
        return {
          screen: 'granted',
          microphone: 'granted',
          camera: 'granted',
          inputMonitoring: 'not-determined',
        };
      }
      throw new Error(`unexpected_channel:${channel}`);
    },
  };

  await expect(startDesktopAiCameraSession({
    bridge,
    recordingId: 'input-monitoring-denied',
    source: { kind: 'display', id: 1, width: 1920, height: 1080 },
    captureSystemAudio: true,
    captureMicrophone: false,
    camera: { enabled: false },
  })).rejects.toThrow('input_monitoring_permission_required');
  expect(calls).toEqual([{ channel: 'capture.permissions.v1', payload: undefined }]);
});

test('AI Camera rejects incomplete native permission reports', async () => {
  const bridge: DesktopCaptureBridge = {
    invoke: async () => ({ screen: 'granted', microphone: 'granted', camera: 'granted' }),
  };
  await expect(startDesktopAiCameraSession({
    bridge,
    recordingId: 'invalid-permissions',
    source: { kind: 'display', id: 1, width: 1920, height: 1080 },
    captureSystemAudio: false,
    captureMicrophone: false,
    camera: { enabled: false },
  })).rejects.toThrow('desktop_capture_permissions_invalid');
});

test('packaged desktop preload cannot navigate onto an untrusted web origin', () => {
  expect(isTrustedDesktopRendererUrl(
    'https://excalicast.cc/zh/app',
    'https://excalicast.cc/app',
  )).toBe(true);
  expect(isTrustedDesktopRendererUrl(
    'https://evil.example/app',
    'https://excalicast.cc/app',
  )).toBe(false);
  expect(isTrustedDesktopRendererUrl(
    'javascript:alert(1)',
    'https://excalicast.cc/app',
  )).toBe(false);
});

test('renderer bridge never exposes raw frames or unrestricted IPC', () => {
  expect(exposedDesktopBridgeChannels.some((channel) => /frame|pixel|blob/i.test(channel))).toBe(false);
  expect(exposedDesktopBridgeChannels).not.toContain('*');
  expect(exposedDesktopBridgeChannels).not.toContain('ink.settings-changed.v1');
  expect(exposedDesktopEventChannels).toEqual([
    'ink.settings-changed.v1',
    'ink.flush-requested.v1',
    'teleprompter.state-changed.v1',
  ]);
});

test('desktop ink window is a hardened transparent full-display overlay', () => {
  const options = createDesktopInkWindowOptions('/tmp/excalicast-preload.js', {
    x: -1728, y: 0, width: 1728, height: 1117,
  });

  expect(options).toMatchObject({
    x: -1728, y: 0, width: 1728, height: 1117,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: '/tmp/excalicast-preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  expect(parseDesktopWindowMediaSourceId('window:9087:0')).toBe(9087);
  expect(() => parseDesktopWindowMediaSourceId('screen:0:0')).toThrow('desktop_window_media_source_invalid');
});

test('desktop teleprompter docks to the active Mac notch and expands inside its safe work area', () => {
  const display = {
    bounds: { x: -1728, y: 0, width: 1728, height: 1117 },
    workArea: { x: -1728, y: 38, width: 1728, height: 1079 },
  };
  expect(resolveDesktopTeleprompterBounds(display, 'compact')).toEqual({
    x: -1274, y: 0, width: 820, height: 44,
  });
  expect(resolveDesktopTeleprompterBounds(display, 'expanded')).toEqual({
    x: -1124, y: 38, width: 520, height: 380,
  });
  expect(createDesktopTeleprompterWindowOptions('/tmp/preload.js', display)).toMatchObject({
    x: -1274, y: 0, width: 820, height: 44,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: '/tmp/preload.js', contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
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

test('electron capture parsing preserves unique native overlay exclusions', () => {
  const request = parseDesktopCapturePayload({
    recordingId: 'overlay-exclusion',
    sourceKind: 'display',
    sourceID: 42,
    width: 2560,
    height: 1440,
    framesPerSecond: 30,
    codec: 'h264',
    excludedWindowIDs: [9002, 9001, 9002],
  }, '/projects/overlay-exclusion');

  expect(request.excludedWindowIDs).toEqual([9002, 9001]);
  expect(() => parseDesktopCapturePayload({
    recordingId: 'invalid-overlay-exclusion',
    sourceKind: 'display',
    sourceID: 42,
    width: 2560,
    height: 1440,
    framesPerSecond: 30,
    codec: 'h264',
    excludedWindowIDs: [9001, -1],
  }, '/projects/invalid-overlay-exclusion')).toThrow('native_capture_request_invalid');
});

test('native capture automatically merges every visible private overlay exclusion', () => {
  expect(mergeDesktopCaptureExclusions({
    recordingId: 'auto-exclusion',
    excludedWindowIDs: [9001, 9002],
  }, [9002, 9087])).toEqual({
    recordingId: 'auto-exclusion',
    excludedWindowIDs: [9001, 9002, 9087],
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

test('native project validation returns per-track continuity and decodability evidence', async () => {
  let onLine: ((line: string) => void) | null = null;
  let command: Record<string, unknown> | null = null;
  const transport: HelperTransport = {
    write(line) {
      command = JSON.parse(line) as Record<string, unknown>;
      queueMicrotask(() => onLine?.(JSON.stringify({
        id: command?.id,
        ok: true,
        state: 'idle',
        validation: {
          isValid: true,
          manifestState: 'ready',
          continuity: {
            isValid: true,
            requiredTracks: ['camera', 'microphone', 'screen'],
            tracks: {
              screen: { track: 'screen', segmentCount: 1, maximumGapUs: 0, maximumOverlapUs: 0, issues: [] },
            },
          },
          segments: [{
            track: 'screen', index: 0, relativePath: 'segments/screen/000000.mp4',
            expectedCodec: 'h264', actualCodec: 'avc1', durationUs: 2_000_000,
            byteLength: 1024, isDecodable: true, issue: null,
          }],
        },
      })));
    },
    onLine(listener) { onLine = listener; },
    close() {},
  };
  const client = new NativeHelperClient(transport);
  const validation = await client.validateProject('/projects/validated');

  expect(command).toMatchObject({ channel: 'project.validate.v1', projectRoot: '/projects/validated' });
  expect(validation).toMatchObject({
    isValid: true,
    continuity: { isValid: true },
    segments: [expect.objectContaining({ actualCodec: 'avc1', isDecodable: true })],
  });
});

test('native helper materializes only a named project track for streaming playback', async () => {
  let onLine: ((line: string) => void) | null = null;
  let command: Record<string, unknown> | null = null;
  const transport: HelperTransport = {
    write(line) {
      command = JSON.parse(line) as Record<string, unknown>;
      queueMicrotask(() => onLine?.(JSON.stringify({
        id: command?.id,
        ok: true,
        materializedTrack: {
          track: 'screen',
          relativePath: 'materialized/screen.mp4',
          byteLength: 8_192,
          mimeType: 'video/mp4',
        },
      })));
    },
    onLine(listener) { onLine = listener; },
    close() {},
  };
  const client = new NativeHelperClient(transport);
  await expect(client.materializeProjectTrack('/projects/lesson', 'screen')).resolves.toEqual({
    track: 'screen',
    relativePath: 'materialized/screen.mp4',
    byteLength: 8_192,
    mimeType: 'video/mp4',
  });
  expect(command).toMatchObject({
    channel: 'project.materialize-track.v1',
    projectRoot: '/projects/lesson',
    mediaTrack: 'screen',
  });
});

test('desktop ink event batches are committed through the native recording helper', async () => {
  let onLine: ((line: string) => void) | null = null;
  let command: Record<string, unknown> | null = null;
  const transport: HelperTransport = {
    write(line) {
      command = JSON.parse(line) as Record<string, unknown>;
      queueMicrotask(() => onLine?.(JSON.stringify({
        id: command?.id,
        ok: true,
        state: 'recording',
      })));
    },
    onLine(listener) { onLine = listener; },
    close() {},
  };
  const client = new NativeHelperClient(transport);
  await client.appendInkEvents({
    index: 3,
    startUs: 2_000_000,
    durationUs: 120_000,
    payload: '{"events":[{"kind":"pointer"}]}',
  });

  expect(command).toMatchObject({
    channel: 'ink.append-events.v1',
    eventIndex: 3,
    eventStartUs: 2_000_000,
    eventDurationUs: 120_000,
    eventPayload: '{"events":[{"kind":"pointer"}]}',
  });
});

test('desktop ink batches use capture-relative microsecond timing and bounded payloads', () => {
  expect(createNativeInkEventBatch({
    events: [
      { kind: 'pointer', atUnixMs: 10_250, x: 1, y: 2 },
      { kind: 'viewport', atUnixMs: 10_375, zoom: 1.2 },
    ],
  }, 10_000, 4)).toEqual({
    index: 4,
    startUs: 250_000,
    durationUs: 125_001,
    payload: JSON.stringify({
      schemaVersion: 1,
      events: [
        { kind: 'pointer', atUnixMs: 10_250, x: 1, y: 2 },
        { kind: 'viewport', atUnixMs: 10_375, zoom: 1.2 },
      ],
    }),
  });
  expect(() => createNativeInkEventBatch({ events: [] }, 10_000, 0))
    .toThrow('desktop_ink_event_batch_invalid');
});

test('desktop reads recoverable native ink segments without allowing path escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'excalicast-ink-read-'));
  try {
    await mkdir(join(root, 'segments/excalidraw-events'), { recursive: true });
    await writeFile(join(root, 'segments/excalidraw-events/000000.segment'), '{"schemaVersion":1,"events":[]}');
    const manifest = {
      schemaVersion: 1 as const,
      recordingId: 'ink-read',
      state: 'ready' as const,
      tracks: {
        'excalidraw-events': [{
          index: 0,
          relativePath: 'segments/excalidraw-events/000000.segment',
          startUs: 250_000,
          durationUs: 100_000,
          byteLength: 31,
        }],
      },
    };
    await expect(readNativeInkEventSegments(root, manifest)).resolves.toEqual([{
      startUs: 250_000,
      durationUs: 100_000,
      payload: '{"schemaVersion":1,"events":[]}',
    }]);

    manifest.tracks['excalidraw-events'][0].relativePath = '../outside.segment';
    await expect(readNativeInkEventSegments(root, manifest))
      .rejects.toThrow('native_ink_event_path_invalid');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop reads a bounded byte range only from a manifest-owned native media segment', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'excalicast-native-media-'));
  try {
    await mkdir(join(projectRoot, 'segments/screen'), { recursive: true });
    await writeFile(join(projectRoot, 'segments/screen/000000.mp4'), Buffer.from([1, 2, 3, 4, 5, 6]));
    const manifest = {
      tracks: {
        screen: [{
          index: 0,
          relativePath: 'segments/screen/000000.mp4',
          startUs: 0,
          durationUs: 2_000_000,
          byteLength: 6,
        }],
      },
    };

    const range = await readNativeMediaSegmentRange(projectRoot, manifest, {
      track: 'screen', segmentIndex: 0, offset: 2, length: 3,
    });
    expect([...range.data]).toEqual([3, 4, 5]);
    expect(range).toMatchObject({ totalByteLength: 6, offset: 2, eof: false, mimeType: 'video/mp4' });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('native media reader rejects path escape, unknown tracks and oversized ranges', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'excalicast-native-media-invalid-'));
  try {
    await writeFile(join(projectRoot, 'outside.mp4'), Buffer.from([1, 2, 3]));
    const escaped = {
      tracks: {
        screen: [{ index: 0, relativePath: '../outside.mp4', startUs: 0, durationUs: 1, byteLength: 3 }],
      },
    };
    await expect(readNativeMediaSegmentRange(projectRoot, escaped, {
      track: 'screen', segmentIndex: 0, offset: 0, length: 3,
    })).rejects.toThrow('native_media_segment_path_invalid');
    await expect(readNativeMediaSegmentRange(projectRoot, escaped, {
      track: 'excalidraw-events' as 'screen', segmentIndex: 0, offset: 0, length: 3,
    })).rejects.toThrow('native_media_track_invalid');
    await expect(readNativeMediaSegmentRange(projectRoot, escaped, {
      track: 'screen', segmentIndex: 0, offset: 0, length: 8 * 1024 * 1024,
    })).rejects.toThrow('native_media_range_invalid');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('native soak summary rejects linear memory growth and sustained encoder backlog', () => {
  const stable = summarizeNativeCaptureSoak({
    durationMs: 60 * 60_000,
    validationPassed: true,
    samples: Array.from({ length: 13 }, (_, index) => ({
      elapsedMs: index * 5 * 60_000,
      residentBytes: 220 * 1024 * 1024 + (index % 2) * 2 * 1024 * 1024,
      pendingEncoderFrames: index % 3,
      pendingWriteBytes: 0,
      segmentWriteLatencyMs: 18,
      state: 'recording' as const,
    })),
  });
  expect(stable.passed).toBe(true);
  expect(stable.memorySlopeBytesPerMinute).toBeLessThan(2 * 1024 * 1024);

  const unstable = summarizeNativeCaptureSoak({
    durationMs: 10 * 60_000,
    validationPassed: true,
    samples: Array.from({ length: 11 }, (_, index) => ({
      elapsedMs: index * 60_000,
      residentBytes: (200 + index * 12) * 1024 * 1024,
      pendingEncoderFrames: index < 4 ? 0 : 5,
      pendingWriteBytes: index < 4 ? 0 : 80 * 1024 * 1024,
      segmentWriteLatencyMs: index < 4 ? 20 : 2_500,
      state: 'recording' as const,
    })),
  });
  expect(unstable.passed).toBe(false);
  expect(unstable.failures).toEqual(expect.arrayContaining([
    'memory_growth_linear',
    'encoder_backlog',
    'write_backlog',
    'write_latency',
  ]));
});

test('native soak runner records pressure, stops capture, and validates decoded media', async () => {
  const calls: string[] = [];
  let clock = 0;
  const client = {
    async startCapture() { calls.push('start'); },
    async captureStatus() {
      calls.push('status');
      return {
        state: 'recording' as const,
        pressure: {
          pendingEncoderFrames: 1,
          pendingWriteBytes: 1024,
          maximumSegmentWriteLatencyMs: 12,
        },
      };
    },
    async stopCapture() { calls.push('stop'); return 'idle' as const; },
    async validateProject() {
      calls.push('validate');
      return {
        isValid: true,
        manifestState: 'ready' as const,
        continuity: { isValid: true, requiredTracks: ['screen' as const], tracks: {} },
        segments: [],
      };
    },
  } as unknown as NativeHelperClient;

  const result = await runNativeCaptureSoak({
    client,
    request: {
      recordingId: 'soak-contract', projectRoot: '/tmp/soak-contract',
      sourceKind: 'display', sourceID: 1, width: 1920, height: 1080,
      framesPerSecond: 30, codec: 'h264',
    },
    durationMs: 1_000,
    sampleIntervalMs: 500,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    sampleResidentBytes: async () => 200 * 1024 * 1024,
  });

  expect(result.summary.passed).toBe(true);
  expect(result.samples).toHaveLength(2);
  expect(calls).toEqual(['start', 'status', 'status', 'stop', 'validate']);
});
