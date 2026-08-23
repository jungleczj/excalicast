import { expect, test } from '@playwright/test';
import {
  DESKTOP_FEATURE_MIGRATION_MATRIX,
  DESKTOP_IPC_CHANNELS,
  mergeDesktopInkSettings,
  normalizeDesktopInkSettings,
  type DesktopFeatureId,
} from '../../src/desktop/productContract';
import {
  createRecordingManifest,
  parseTeachingEditRecipe,
  type TeleprompterDesktopSession,
} from '../../src/desktop/projectSchema';
import { createDesktopInkSurfacePresentation } from '../../src/desktop/inkSurface';
import { DesktopInkEventCollector } from '../../src/desktop/inkEventJournal';
import {
  DesktopInkReplay,
  createReplayFrameTimes,
  parseNativeInkEventSegments,
} from '../../src/desktop/inkReplay';
import { loadDesktopInkReplay } from '../../src/desktop/loadInkReplay';
import {
  createDesktopInkRenderSource,
  projectDesktopInkPointer,
  resolveDesktopInkExportStyle,
} from '../../src/desktop/inkReplayFrameSource';
import {
  applyDesktopTeleprompterProgress,
  configureDesktopTeleprompter,
  createDesktopTeleprompterState,
  resolveDesktopTeleprompterAudioRole,
} from '../../src/desktop/teleprompterSession';
import { resolveDesktopDownloadUrl } from '../../src/desktop/downloadContract';
import packageJson from '../../package.json';

const REQUIRED_BROWSER_FEATURES: DesktopFeatureId[] = [
  'whiteboard.excalidraw-full',
  'recording.all-sources',
  'recording.camera-layouts',
  'recording.framing-backgrounds',
  'project.library-cloud-share',
  'editor.timeline-multirecording',
  'editor.autozoom-highlight-keypoints',
  'editor.captions-audio-repair-dubbing',
  'editor.ratios-export',
  'teleprompter.smart-readalong',
  'chatcut.assisted-editing',
];

test('desktop migration contract inherits every browser feature without omissions', () => {
  const ids = new Set(DESKTOP_FEATURE_MIGRATION_MATRIX.map((entry) => entry.id));

  for (const id of REQUIRED_BROWSER_FEATURES) expect(ids.has(id), id).toBe(true);
  expect(DESKTOP_FEATURE_MIGRATION_MATRIX.every((entry) => entry.desktop !== 'omitted')).toBe(true);
});

test('web navigation resolves a stable signed macOS installer release URL', () => {
  expect(resolveDesktopDownloadUrl('mac')).toBe(
    'https://github.com/jungleczj/excalicast/releases/latest/download/Excalicast-mac-arm64.dmg',
  );
  expect(resolveDesktopDownloadUrl('mac', 'https://cdn.example.com/Excalicast.dmg')).toBe(
    'https://cdn.example.com/Excalicast.dmg',
  );
  expect(() => resolveDesktopDownloadUrl('windows' as 'mac')).toThrow('desktop_platform_unsupported');

  expect(packageJson.scripts['desktop:package:mac']).toBeTruthy();
  expect(packageJson.build).toMatchObject({
    appId: 'cc.excalicast.desktop',
    productName: 'Excalicast',
    mac: {
      hardenedRuntime: true,
      target: [{ target: 'dmg', arch: ['arm64'] }],
    },
  });
});

test('desktop ink uses the full Excalidraw surface with independent opacity controls', () => {
  expect(normalizeDesktopInkSettings({
    mode: 'full-board',
    backgroundOpacity: 1.4,
    inkOpacity: -0.2,
    pointerPolicy: 'draw',
  })).toEqual({
    engine: 'excalidraw',
    toolSurface: 'full',
    mode: 'full-board',
    backgroundOpacity: 1,
    inkOpacity: 0,
    pointerPolicy: 'draw',
  });

  expect(mergeDesktopInkSettings({
    mode: 'ink',
    backgroundOpacity: 0,
    inkOpacity: 1,
    pointerPolicy: 'pass-through',
  }, {
    mode: 'full-board',
    backgroundOpacity: 0.45,
    inkOpacity: 0.72,
    pointerPolicy: 'draw',
  })).toEqual({
    engine: 'excalidraw',
    toolSurface: 'full',
    mode: 'full-board',
    backgroundOpacity: 0.45,
    inkOpacity: 0.72,
    pointerPolicy: 'draw',
  });

  expect(createDesktopInkSurfacePresentation({
    mode: 'full-board',
    backgroundOpacity: 0.45,
    inkOpacity: 0.72,
    pointerPolicy: 'draw',
  })).toEqual({
    className: 'desktop-ink-overlay desktop-ink-overlay--full-board',
    boardBackground: 'rgba(255, 255, 255, 0.45)',
    inkOpacity: 0.72,
    fullToolSurface: true,
  });
});

test('desktop IPC is versioned and separates native capture from renderer pixels', () => {
  expect(DESKTOP_IPC_CHANNELS.captureStart).toBe('capture.start.v1');
  expect(DESKTOP_IPC_CHANNELS.captureSources).toBe('capture.sources.v1');
  expect(DESKTOP_IPC_CHANNELS.captureDevices).toBe('capture.devices.v1');
  expect(DESKTOP_IPC_CHANNELS.capturePermissions).toBe('capture.permissions.v1');
  expect(DESKTOP_IPC_CHANNELS.captureRequestPermissions).toBe('capture.request-permissions.v1');
  expect(DESKTOP_IPC_CHANNELS.captureStop).toBe('capture.stop.v1');
  expect(DESKTOP_IPC_CHANNELS.capturePause).toBe('capture.pause.v1');
  expect(DESKTOP_IPC_CHANNELS.captureResume).toBe('capture.resume.v1');
  expect(DESKTOP_IPC_CHANNELS.captureSetMicrophoneMuted).toBe('capture.microphone-muted.v1');
  expect(DESKTOP_IPC_CHANNELS.captureSetSystemAudioMuted).toBe('capture.system-audio-muted.v1');
  expect(DESKTOP_IPC_CHANNELS.captureSetCameraVisibility).toBe('capture.camera-visibility.v1');
  expect(DESKTOP_IPC_CHANNELS.captureSetCameraHardware).toBe('capture.camera-hardware.v1');
  expect(DESKTOP_IPC_CHANNELS.inkSetOpacity).toBe('ink.set-opacity.v1');
  expect(DESKTOP_IPC_CHANNELS.inkGetSettings).toBe('ink.get-settings.v1');
  expect(DESKTOP_IPC_CHANNELS.inkSettingsChanged).toBe('ink.settings-changed.v1');
  expect(DESKTOP_IPC_CHANNELS.inkAppendEvents).toBe('ink.append-events.v1');
  expect(DESKTOP_IPC_CHANNELS.inkFlushRequested).toBe('ink.flush-requested.v1');
  expect(DESKTOP_IPC_CHANNELS.inkFlushComplete).toBe('ink.flush-complete.v1');
  expect(DESKTOP_IPC_CHANNELS.teleprompterConfigure).toBe('teleprompter.configure.v1');
  expect(DESKTOP_IPC_CHANNELS.teleprompterGetState).toBe('teleprompter.get-state.v1');
  expect(DESKTOP_IPC_CHANNELS.teleprompterStateChanged).toBe('teleprompter.state-changed.v1');
  expect(DESKTOP_IPC_CHANNELS.projectRecover).toBe('project.recover.v1');
  expect(DESKTOP_IPC_CHANNELS.projectValidate).toBe('project.validate.v1');
  expect(DESKTOP_IPC_CHANNELS.projectReadMediaSegment).toBe('project.read-media-segment.v1');
  expect(DESKTOP_IPC_CHANNELS.projectReadInkEvents).toBe('project.read-ink-events.v1');
  expect(Object.values(DESKTOP_IPC_CHANNELS).every((channel) => channel.endsWith('.v1'))).toBe(true);
});

test('native recording manifest keeps independent recoverable media and Excalidraw event tracks', () => {
  const manifest = createRecordingManifest('rec-1', '/projects/rec-1');

  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.state).toBe('preparing');
  expect(manifest.tracks.map((track) => track.kind)).toEqual([
    'screen', 'camera', 'microphone', 'system-audio', 'excalidraw-events', 'input-telemetry',
  ]);
  expect(manifest.tracks.every((track) => track.segments.length === 0)).toBe(true);
});

test('desktop ink journal records element deltas instead of cloning the complete scene', () => {
  const collector = new DesktopInkEventCollector();
  collector.observeScene([
    { id: 'a', version: 1, versionNonce: 10, isDeleted: false, x: 1 },
    { id: 'b', version: 1, versionNonce: 20, isDeleted: false, x: 2 },
  ], {
    scrollX: 0, scrollY: 0, zoom: { value: 1 },
    width: 1440, height: 900, viewBackgroundColor: '#ffffff',
  }, {}, 1_000);
  expect(collector.drain()[1]).toEqual({
    kind: 'viewport', atUnixMs: 1_000,
    scrollX: 0, scrollY: 0, zoom: 1,
    width: 1440, height: 900, viewBackgroundColor: '#ffffff',
  });

  collector.observeScene([
    { id: 'a', version: 1, versionNonce: 10, isDeleted: false, x: 1 },
    { id: 'b', version: 2, versionNonce: 21, isDeleted: false, x: 22 },
  ], {
    scrollX: 0, scrollY: 0, zoom: { value: 1 },
    width: 1440, height: 900, viewBackgroundColor: '#ffffff',
  }, {}, 1_100);
  collector.recordPointer({ x: 80, y: 120, tool: 'laser', phase: 'move' }, 1_120);

  expect(collector.drain()).toEqual([
    {
      kind: 'scene-delta',
      atUnixMs: 1_100,
      upserts: [{ id: 'b', version: 2, versionNonce: 21, isDeleted: false, x: 22 }],
      deletedIds: [],
      fileUpserts: {},
    },
    {
      kind: 'pointer',
      atUnixMs: 1_120,
      x: 80,
      y: 120,
      tool: 'laser',
      phase: 'move',
    },
  ]);

  const retryable = [{
    kind: 'pointer' as const,
    atUnixMs: 1_200,
    x: 90,
    y: 130,
    tool: 'freedraw',
    phase: 'move' as const,
  }];
  collector.restore(retryable);
  expect(collector.drain()).toEqual(retryable);
});

test('native ink segments round-trip into seekable 60fps Excalidraw scenes', () => {
  const events = parseNativeInkEventSegments([
    {
      startUs: 0,
      payload: JSON.stringify({
        schemaVersion: 1,
        events: [
          { kind: 'scene-delta', atUnixMs: 10_000, upserts: [
            { id: 'a', version: 1, x: 10 }, { id: 'b', version: 1, x: 20 },
          ], deletedIds: [], fileUpserts: {} },
          { kind: 'pointer', atUnixMs: 10_000, x: 0, y: 10, tool: 'laser', phase: 'move' },
          { kind: 'pointer', atUnixMs: 10_100, x: 100, y: 30, tool: 'laser', phase: 'move' },
        ],
      }),
    },
    {
      startUs: 500_000,
      payload: JSON.stringify({
        schemaVersion: 1,
        events: [
          { kind: 'scene-delta', atUnixMs: 20_000, upserts: [
            { id: 'b', version: 2, x: 25 },
          ], deletedIds: [], fileUpserts: {} },
          { kind: 'viewport', atUnixMs: 20_100, scrollX: -40, scrollY: -20, zoom: 1.5 },
        ],
      }),
    },
    {
      startUs: 1_000_000,
      payload: JSON.stringify({
        schemaVersion: 1,
        events: [
          { kind: 'scene-delta', atUnixMs: 30_000, upserts: [], deletedIds: ['a'], fileUpserts: {} },
        ],
      }),
    },
  ]);
  const replay = new DesktopInkReplay(events);

  expect(replay.frameAt(50_000)).toMatchObject({
    revisionUs: 0,
    elements: [{ id: 'a' }, { id: 'b' }],
    pointer: { x: 50, y: 20, tool: 'laser' },
  });
  expect(replay.frameAt(750_000)).toMatchObject({
    revisionUs: 600_000,
    elements: [{ id: 'a', version: 1 }, { id: 'b', version: 2, x: 25 }],
    appState: { scrollX: -40, scrollY: -20, zoom: { value: 1.5 } },
  });
  expect(replay.frameAt(1_100_000).elements).toEqual([{ id: 'b', version: 2, x: 25 }]);
  expect(replay.frameAt(100_000).elements).toEqual([
    { id: 'a', version: 1, x: 10 }, { id: 'b', version: 1, x: 20 },
  ]);
  expect(createReplayFrameTimes(50_000, 60)).toEqual([0, 16_667, 33_333, 50_000]);
  expect(replay.hasPointerEvents).toBe(true);
  expect(replay.hasEvents).toBe(true);
  expect(replay.contentElements()).toEqual([
    { id: 'a', version: 1, x: 10 },
    { id: 'b', version: 1, x: 20 },
    { id: 'b', version: 2, x: 25 },
  ]);

  const renderSource = createDesktopInkRenderSource(replay, 1_100);
  expect(renderSource.contentSnapshots[0].elements).toHaveLength(3);
  expect(renderSource.frameAt(50)).toMatchObject({
    signature: '0|laser:50:20:move',
    snapshot: { timestamp: 0, elements: [{ id: 'a' }, { id: 'b' }] },
    pointer: { x: 50, y: 20, tool: 'laser' },
  });
  expect(renderSource.frameAt(750)).toMatchObject({
    signature: '600000|none',
    snapshot: { timestamp: 600, appState: { scrollX: -40, scrollY: -20 } },
  });
  expect(projectDesktopInkPointer(
    { x: 50, y: 20, tool: 'laser', phase: 'move' },
    { x: 0, y: 0, width: 100, height: 40 },
    { x: 10, y: 20, width: 200, height: 80 },
  )).toEqual({ x: 110, y: 60 });
  expect(resolveDesktopInkExportStyle(
    { backgroundOpacity: 1.2, inkOpacity: -0.2 },
    0,
  )).toEqual({ backgroundOpacity: 1, inkOpacity: 0 });
  expect(resolveDesktopInkExportStyle(undefined, 0)).toEqual({
    backgroundOpacity: 0,
    inkOpacity: 1,
  });
});

test('desktop replay loader uses native event references while browser mode remains unchanged', async () => {
  await expect(loadDesktopInkReplay('rec-native', {
    async invoke(channel, payload) {
      expect(channel).toBe('project.read-ink-events.v1');
      expect(payload).toEqual({ recordingId: 'rec-native' });
      return {
        segments: [{
          startUs: 0,
          durationUs: 1,
          payload: JSON.stringify({
            schemaVersion: 1,
            events: [{
              kind: 'scene-delta', atUnixMs: 1_000,
              upserts: [{ id: 'native-element', version: 1 }],
              deletedIds: [], fileUpserts: {},
            }],
          }),
        }],
      };
    },
  })).resolves.toMatchObject({
    frameAt: expect.any(Function),
  });
  await expect(loadDesktopInkReplay('rec-browser', undefined)).resolves.toBeNull();
});

test('teaching recipe accepts curated ChatCut assets and rejects hidden catalog injection', () => {
  expect(parseTeachingEditRecipe({
    schemaVersion: 1,
    sourceRecordingId: 'rec-1',
    teachingPackId: 'data-teaching',
    curatedAssetIds: ['chart-bars-01', 'pop-01'],
    placements: [{ assetId: 'chart-bars-01', track: 'motion-graphics', startMs: 1200, endMs: 4200 }],
  }).placements).toHaveLength(1);

  expect(() => parseTeachingEditRecipe({
    schemaVersion: 1,
    sourceRecordingId: 'rec-1',
    teachingPackId: 'data-teaching',
    curatedAssetIds: ['chart-bars-01'],
    placements: [{ assetId: 'uncurated-transition', track: 'transition', startMs: 1200, endMs: 1500 }],
  })).toThrow('recipe_asset_not_curated');
});

test('desktop teleprompter session reuses the recording microphone', () => {
  const session: TeleprompterDesktopSession = {
    schemaVersion: 1,
    mode: 'smart-readalong',
    dock: 'notch',
    microphoneSource: 'recording-session-pcm',
    fallback: 'constant-speed',
    excludeFromCapture: true,
  };

  expect(session.microphoneSource).toBe('recording-session-pcm');
  expect(session.excludeFromCapture).toBe(true);

  const configured = configureDesktopTeleprompter(createDesktopTeleprompterState(), {
    schemaVersion: 1,
    visible: true,
    script: 'First idea. Second idea.',
    language: 'en',
    mode: 'smart-readalong',
    dock: 'notch',
    microphoneSource: 'recording-session-pcm',
    fallback: 'constant-speed',
    excludeFromCapture: true,
    speed: 4,
    fontSize: 30,
    opacity: 0.9,
  });
  expect(configured).toMatchObject({
    visible: true,
    recognitionStatus: 'idle',
    currentWord: -1,
    microphoneSource: 'recording-session-pcm',
    excludeFromCapture: true,
  });
  expect(applyDesktopTeleprompterProgress(configured, {
    currentWord: 3,
    recognitionStatus: 'listening',
    heard: 'second idea',
  })).toMatchObject({ currentWord: 3, recognitionStatus: 'listening', heard: 'second idea' });
  const invalidMicrophoneConfiguration = JSON.parse(JSON.stringify({
    ...configured,
    microphoneSource: 'new-device-request',
  }));
  expect(() => configureDesktopTeleprompter(configured, invalidMicrophoneConfiguration))
    .toThrow('desktop_teleprompter_microphone_invalid');
  expect(resolveDesktopTeleprompterAudioRole({
    embedded: false, desktopBridge: true, hasRecordingStream: true,
  })).toBe('publisher-shared-stream');
  expect(resolveDesktopTeleprompterAudioRole({
    embedded: true, desktopBridge: true, hasRecordingStream: false,
  })).toBe('subscriber-display-only');
  expect(resolveDesktopTeleprompterAudioRole({
    embedded: false, desktopBridge: false, hasRecordingStream: false,
  })).toBe('browser-own-stream');
});
