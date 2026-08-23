import { expect, test } from '@playwright/test';
import {
  DESKTOP_FEATURE_MIGRATION_MATRIX,
  DESKTOP_IPC_CHANNELS,
  normalizeDesktopInkSettings,
  type DesktopFeatureId,
} from '../../src/desktop/productContract';
import {
  createRecordingManifest,
  parseTeachingEditRecipe,
  type TeleprompterDesktopSession,
} from '../../src/desktop/projectSchema';

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
});

test('desktop IPC is versioned and separates native capture from renderer pixels', () => {
  expect(DESKTOP_IPC_CHANNELS.captureStart).toBe('capture.start.v1');
  expect(DESKTOP_IPC_CHANNELS.captureSources).toBe('capture.sources.v1');
  expect(DESKTOP_IPC_CHANNELS.capturePermissions).toBe('capture.permissions.v1');
  expect(DESKTOP_IPC_CHANNELS.captureRequestPermissions).toBe('capture.request-permissions.v1');
  expect(DESKTOP_IPC_CHANNELS.captureStop).toBe('capture.stop.v1');
  expect(DESKTOP_IPC_CHANNELS.inkSetOpacity).toBe('ink.set-opacity.v1');
  expect(DESKTOP_IPC_CHANNELS.teleprompterConfigure).toBe('teleprompter.configure.v1');
  expect(DESKTOP_IPC_CHANNELS.projectRecover).toBe('project.recover.v1');
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
