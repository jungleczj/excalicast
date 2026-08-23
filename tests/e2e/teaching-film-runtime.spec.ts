import { expect, test } from '@playwright/test';
import {
  buildRecordingTeachingRecipe,
  createRecordingTeachingSelection,
  deriveTeachingRecordingEvents,
} from '../../src/services/teachingFilmRecipe';

test('recording setup freezes the exact visible teaching assets before capture', () => {
  expect(createRecordingTeachingSelection({
    enabled: true,
    categories: { motion: true, charts: false, sound: true },
  })).toEqual({
    schemaVersion: 1,
    enabled: true,
    teachingPackId: 'chatcut-teaching-core-v1',
    selectedAssetIds: ['key-points-drawer-01', 'teaching-pop-01'],
  });
});

test('recorded whiteboard changes and laser gestures become capture-relative teaching events', () => {
  expect(deriveTeachingRecordingEvents({
    durationMs: 20_000,
    snapshots: [
      { timestamp: 0, elements: [{ id: 'a' }], appState: {} },
      { timestamp: 2_000, elements: [{ id: 'a' }, { id: 'b' }], appState: {} },
      { timestamp: 4_000, elements: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], appState: {} },
      { timestamp: 7_000, elements: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], appState: {} },
    ],
    laserEvents: [
      { recordingId: 'rec-1', timestamp: 8_000, x: 10, y: 10, button: 'down' },
      { recordingId: 'rec-1', timestamp: 8_200, x: 11, y: 11, button: 'down' },
      { recordingId: 'rec-1', timestamp: 11_000, x: 12, y: 12, button: 'down' },
    ],
  })).toEqual([
    { id: 'chapter-start-0', kind: 'chapter-start', atMs: 0 },
    { id: 'data-point-2000', kind: 'data-point', atMs: 2_000 },
    { id: 'data-point-7000', kind: 'data-point', atMs: 7_000 },
    { id: 'emphasis-8000', kind: 'emphasis', atMs: 8_000 },
    { id: 'emphasis-11000', kind: 'emphasis', atMs: 11_000 },
  ]);
});

test('post-record plan uses only the preselected assets and real telemetry timestamps', () => {
  const recipe = buildRecordingTeachingRecipe({
    recordingId: 'rec-1',
    durationMs: 12_000,
    selection: createRecordingTeachingSelection({
      enabled: true,
      categories: { motion: true, charts: false, sound: true },
    }),
    snapshots: [
      { timestamp: 0, elements: [], appState: {} },
      { timestamp: 5_000, elements: [{ id: 'chart-like-drawing' }], appState: {} },
    ],
    laserEvents: [{ recordingId: 'rec-1', timestamp: 7_000, x: 1, y: 1, button: 'down' }],
  });

  expect(recipe?.curatedAssetIds).toEqual(['key-points-drawer-01', 'teaching-pop-01']);
  expect(recipe?.placements).toEqual([
    { assetId: 'key-points-drawer-01', track: 'motion-graphics', startMs: 0, endMs: 3_200 },
    { assetId: 'teaching-pop-01', track: 'sound-effect', startMs: 7_000, endMs: 7_420 },
  ]);
});

test('disabled one-click film leaves the source recording untouched', () => {
  expect(buildRecordingTeachingRecipe({
    recordingId: 'rec-1',
    durationMs: 10_000,
    selection: createRecordingTeachingSelection({
      enabled: false,
      categories: { motion: true, charts: true, sound: true },
    }),
    snapshots: [],
    laserEvents: [],
  })).toBeUndefined();
});
