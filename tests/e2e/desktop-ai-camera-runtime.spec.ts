import { expect, test } from '@playwright/test';
import { DESKTOP_IPC_CHANNELS } from '../../src/desktop/productContract';
import {
  startDesktopRecordingFromSetup,
  type DesktopCaptureSources,
} from '../../src/desktop/aiCameraRenderer';
import type { DesktopCaptureBridge } from '../../src/desktop/aiCameraSession';
import type { RecordingSetupConfig } from '../../src/types/recording';
import {
  createNativeRecordingMetadata,
  finalizeNativeRecordingMetadata,
  nativeProjectRequiresExportAdapter,
} from '../../src/desktop/nativeRecordingProject';

function setup(source: RecordingSetupConfig['source'], cameraEnabled = true): RecordingSetupConfig {
  return {
    framing: 'default',
    croppingMode: 'fit_all_content',
    includeWorkspaceShell: false,
    source,
    camera: {
      enabled: cameraEnabled,
      sizePx: 160,
      shape: 'circle',
      position: 'bottom-right',
      backgroundRemoval: false,
    },
  };
}

function previewStream(
  kind: 'audio' | 'video',
  label: string,
  stopped: string[],
): MediaStream {
  const track = {
    kind,
    label,
    stop: () => stopped.push(label),
    getSettings: () => ({ width: 2560, height: 1440, frameRate: 30 }),
  } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
    getVideoTracks: () => kind === 'video' ? [track] : [],
    getAudioTracks: () => kind === 'audio' ? [track] : [],
  } as unknown as MediaStream;
}

function nativeBridge(
  calls: Array<{ channel: string; payload?: unknown }>,
  sources: DesktopCaptureSources,
): DesktopCaptureBridge {
  return {
    async invoke(channel, payload) {
      calls.push({ channel, payload });
      if (channel === DESKTOP_IPC_CHANNELS.captureSources) return sources;
      if (channel === DESKTOP_IPC_CHANNELS.capturePermissions) {
        return { screen: 'granted', microphone: 'granted', camera: 'granted' };
      }
      if (channel === DESKTOP_IPC_CHANNELS.captureDevices) {
        return {
          microphones: [{ id: 'native-mic', name: 'MacBook Microphone', isDefault: true }],
          cameras: [{ id: 'native-camera', name: 'FaceTime Camera', isDefault: true }],
        };
      }
      if (channel === DESKTOP_IPC_CHANNELS.capturePreflight) {
        return { hardwareEncodingConfirmed: true };
      }
      if (channel === DESKTOP_IPC_CHANNELS.captureStart) return { state: 'recording' };
      if (channel === DESKTOP_IPC_CHANNELS.captureStop) return { state: 'idle' };
      throw new Error(`unexpected_channel:${channel}`);
    },
  };
}

test('desktop renderer starts one native AI Camera session from RecordingSetup and never starts browser recording', async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const stopped: string[] = [];
  let browserStarts = 0;
  const bridge = nativeBridge(calls, {
    displays: [{ displayID: 91, width: 5120, height: 2880 }],
    windows: [],
  });

  const result = await startDesktopRecordingFromSetup({
    bridge,
    recordingId: 'desktop-runtime',
    setup: setup({ kind: 'desktop', displaySurface: 'monitor', captureSystemAudio: true }),
    displayStream: previewStream('video', 'screen:91:0', stopped),
    microphoneStream: previewStream('audio', 'browser-mic-preview', stopped),
    cameraStream: previewStream('video', 'browser-camera-preview', stopped),
    startBrowser: async () => {
      browserStarts += 1;
      return { browser: true };
    },
  });

  expect(result.pipeline).toBe('native');
  expect(browserStarts).toBe(0);
  expect(stopped).toEqual([
    'screen:91:0',
    'browser-mic-preview',
    'browser-camera-preview',
  ]);
  expect(calls.find((call) => call.channel === DESKTOP_IPC_CHANNELS.captureStart)?.payload).toMatchObject({
    recordingId: 'desktop-runtime',
    sourceKind: 'display',
    sourceID: 91,
    width: 2560,
    height: 1440,
    captureSystemAudio: true,
    captureMicrophone: true,
    captureCamera: true,
  });
  if (result.pipeline === 'native') await result.session.stop();
  expect(calls.filter((call) => call.channel === DESKTOP_IPC_CHANNELS.captureStop)).toHaveLength(1);
});

test('native startup failure is explicit and cannot silently fall back to a second browser recorder', async () => {
  let browserStarts = 0;
  const stopped: string[] = [];
  const bridge: DesktopCaptureBridge = {
    async invoke(channel) {
      if (channel === DESKTOP_IPC_CHANNELS.captureSources) {
        return { displays: [], windows: [{ windowID: 42, title: 'Lesson', applicationName: 'Slides', width: 1920, height: 1080 }] };
      }
      if (channel === DESKTOP_IPC_CHANNELS.capturePermissions) throw new Error('native_media_helper_unavailable');
      throw new Error(`unexpected_channel:${channel}`);
    },
  };

  await expect(startDesktopRecordingFromSetup({
    bridge,
    recordingId: 'native-failure',
    setup: setup({ kind: 'window', displaySurface: 'window', captureSystemAudio: false }),
    displayStream: previewStream('video', 'window:42:0', stopped),
    microphoneStream: null,
    cameraStream: null,
    startBrowser: async () => {
      browserStarts += 1;
      return { browser: true };
    },
  })).rejects.toThrow('native_media_helper_unavailable');

  expect(browserStarts).toBe(0);
  expect(stopped).toEqual(['window:42:0']);
});

test('browser and unsupported desktop sources keep the original browser start path and preview streams', async () => {
  const browserSession = { browser: true };
  const stopped: string[] = [];
  let bridgeCalls = 0;
  const result = await startDesktopRecordingFromSetup({
    bridge: { invoke: async () => { bridgeCalls += 1; throw new Error('must_not_call_native'); } },
    recordingId: 'browser-current-tab',
    setup: setup({ kind: 'current_tab', displaySurface: 'browser', captureSystemAudio: true }, false),
    displayStream: previewStream('video', 'current-tab', stopped),
    microphoneStream: null,
    cameraStream: null,
    startBrowser: async () => browserSession,
  });

  expect(result).toEqual({ pipeline: 'browser', session: browserSession });
  expect(bridgeCalls).toBe(0);
  expect(stopped).toEqual([]);
});

test('ambiguous native source selection fails before stopping previews or starting either recorder', async () => {
  const stopped: string[] = [];
  let browserStarts = 0;
  const bridge = nativeBridge([], {
    displays: [
      { displayID: 1, width: 2560, height: 1440 },
      { displayID: 2, width: 2560, height: 1440 },
    ],
    windows: [],
  });

  await expect(startDesktopRecordingFromSetup({
    bridge,
    recordingId: 'ambiguous-display',
    setup: setup({ kind: 'desktop', displaySurface: 'monitor', captureSystemAudio: true }),
    displayStream: previewStream('video', 'Entire Screen', stopped),
    microphoneStream: null,
    cameraStream: null,
    startBrowser: async () => { browserStarts += 1; return {}; },
  })).rejects.toThrow('desktop_native_source_ambiguous');

  expect(browserStarts).toBe(0);
  expect(stopped).toEqual([]);
});

test('a failed native stop remains retryable instead of reporting a false stopped state', async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const stopped: string[] = [];
  const base = nativeBridge(calls, {
    displays: [{ displayID: 7, width: 2560, height: 1440 }],
    windows: [],
  });
  let stopAttempts = 0;
  const bridge: DesktopCaptureBridge = {
    invoke(channel, payload) {
      if (channel === DESKTOP_IPC_CHANNELS.captureStop && stopAttempts++ === 0) {
        return Promise.reject(new Error('native_stop_io_failed'));
      }
      return base.invoke(channel, payload);
    },
  };
  const result = await startDesktopRecordingFromSetup({
    bridge,
    recordingId: 'retry-native-stop',
    setup: setup({ kind: 'desktop', captureSystemAudio: true }, false),
    displayStream: previewStream('video', 'screen:7:0', stopped),
    microphoneStream: null,
    cameraStream: null,
    startBrowser: async () => ({}),
  });
  expect(result.pipeline).toBe('native');
  if (result.pipeline !== 'native') return;

  await expect(result.session.stop()).rejects.toThrow('native_stop_io_failed');
  await expect(result.session.stop()).resolves.toBeUndefined();
  expect(stopAttempts).toBe(2);
});

test('native renderer persists a recoverable project reference before capture can outlive the page', () => {
  const recording = createNativeRecordingMetadata({
    recordingId: 'native-metadata',
    startedAt: 1_000,
    ownerKey: 'owner-1',
    setup: setup({ kind: 'desktop', captureSystemAudio: true }),
  });

  expect(recording).toMatchObject({
    id: 'native-metadata',
    startedAt: 1_000,
    durationMs: 0,
    status: 'recording',
    hasAudio: true,
    hasSystemAudio: true,
    hasCamera: true,
    ownerKey: 'owner-1',
    nativeProject: {
      schemaVersion: 1,
      storage: 'macos-videos',
      recordingId: 'native-metadata',
      captureState: 'recording',
      exportStatus: 'adapter-required',
    },
  });
});

test('validated native media stays explicitly interrupted until the web export adapter can read its segments', () => {
  const recording = createNativeRecordingMetadata({
    recordingId: 'native-ready',
    startedAt: 1_000,
    ownerKey: 'owner-1',
    setup: setup({ kind: 'window', captureSystemAudio: false }, false),
  });
  const finalized = finalizeNativeRecordingMetadata(recording, {
    manifest: {
      schemaVersion: 1,
      recordingId: 'native-ready',
      state: 'ready',
      tracks: { screen: [{ index: 0, relativePath: 'segments/screen/000000.mp4', startUs: 0, durationUs: 4_000_000, byteLength: 4096 }] },
    },
    validation: { isValid: true, manifestState: 'ready' },
    durationMs: 4_100,
  });

  expect(finalized).toMatchObject({
    durationMs: 4_100,
    status: 'interrupted',
    nativeProject: {
      captureState: 'ready',
      validationState: 'valid',
      exportStatus: 'adapter-required',
    },
  });
  expect(finalized.warnings).toContain('native_media_adapter_required');
});

test('invalid native recovery is marked interrupted with validation evidence', () => {
  const recording = createNativeRecordingMetadata({
    recordingId: 'native-invalid',
    startedAt: 1_000,
    ownerKey: 'owner-1',
    setup: setup({ kind: 'desktop', captureSystemAudio: true }, false),
  });
  const finalized = finalizeNativeRecordingMetadata(recording, {
    manifest: { schemaVersion: 1, recordingId: 'native-invalid', state: 'interrupted', tracks: {} },
    validation: { isValid: false, manifestState: 'interrupted' },
    durationMs: 2_000,
  });

  expect(finalized.status).toBe('interrupted');
  expect(finalized.nativeProject?.validationState).toBe('invalid');
  expect(finalized.warnings).toEqual(expect.arrayContaining([
    'native_capture_interrupted',
    'native_validation_failed',
  ]));
});

test('export route can distinguish a safely recovered native project from browser-ready media', () => {
  const recording = createNativeRecordingMetadata({
    recordingId: 'native-export-gate',
    startedAt: 1_000,
    ownerKey: 'owner-1',
    setup: setup({ kind: 'desktop', captureSystemAudio: true }, false),
  });
  expect(nativeProjectRequiresExportAdapter(recording)).toBe(true);
  expect(nativeProjectRequiresExportAdapter({ ...recording, nativeProject: { ...recording.nativeProject!, exportStatus: 'ready' } })).toBe(false);
});
