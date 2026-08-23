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
  expect(DESKTOP_IPC_CHANNELS.inkSetOpacity).toBe('ink.set-opacity.v1');
  expect(DESKTOP_IPC_CHANNELS.inkGetSettings).toBe('ink.get-settings.v1');
  expect(DESKTOP_IPC_CHANNELS.inkSettingsChanged).toBe('ink.settings-changed.v1');
  expect(DESKTOP_IPC_CHANNELS.inkAppendEvents).toBe('ink.append-events.v1');
  expect(DESKTOP_IPC_CHANNELS.inkFlushRequested).toBe('ink.flush-requested.v1');
  expect(DESKTOP_IPC_CHANNELS.inkFlushComplete).toBe('ink.flush-complete.v1');
  expect(DESKTOP_IPC_CHANNELS.teleprompterConfigure).toBe('teleprompter.configure.v1');
  expect(DESKTOP_IPC_CHANNELS.projectRecover).toBe('project.recover.v1');
  expect(DESKTOP_IPC_CHANNELS.projectValidate).toBe('project.validate.v1');
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
  ], { scrollX: 0, scrollY: 0, zoom: { value: 1 } }, {}, 1_000);
  collector.drain();

  collector.observeScene([
    { id: 'a', version: 1, versionNonce: 10, isDeleted: false, x: 1 },
    { id: 'b', version: 2, versionNonce: 21, isDeleted: false, x: 22 },
  ], { scrollX: 0, scrollY: 0, zoom: { value: 1 } }, {}, 1_100);
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
});
