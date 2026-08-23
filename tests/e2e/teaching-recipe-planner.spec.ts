import { expect, test } from '@playwright/test';
import {
  buildTeachingTrackPlan,
  createTeachingAssetPreselection,
} from '../../src/desktop/teachingRecipePlanner';
import { parseTeachingEditRecipe } from '../../src/desktop/projectSchema';

const catalog = [
  { assetId: 'motion-chapter-card', kind: 'motion-graphic' as const, durationMs: 2_400 },
  { assetId: 'chart-bars', kind: 'chart' as const, durationMs: 4_000 },
  { assetId: 'sfx-pop', kind: 'sound-effect' as const, durationMs: 420 },
  { assetId: 'sfx-chime', kind: 'sound-effect' as const, durationMs: 600 },
];

test('pre-record selection only accepts explicit assets from the curated ChatCut catalog', () => {
  const selection = createTeachingAssetPreselection({
    teachingPackId: 'data-teaching',
    catalog,
    selectedAssetIds: ['chart-bars', 'sfx-pop'],
  });
  expect(selection).toEqual({
    schemaVersion: 1,
    teachingPackId: 'data-teaching',
    assets: [catalog[1], catalog[2]],
  });
  expect(Object.isFrozen(selection)).toBe(true);
  expect(Object.isFrozen(selection.assets)).toBe(true);
  expect(() => selection.assets.push(catalog[0])).toThrow();

  expect(() => createTeachingAssetPreselection({
    teachingPackId: 'data-teaching',
    catalog,
    selectedAssetIds: ['chart-bars', 'hidden-swoosh'],
  })).toThrow('teaching_asset_not_in_catalog');
});

test('post-record planning deterministically maps teaching events onto selected asset tracks', () => {
  const selection = createTeachingAssetPreselection({
    teachingPackId: 'data-teaching',
    catalog,
    selectedAssetIds: ['motion-chapter-card', 'chart-bars', 'sfx-pop', 'sfx-chime'],
  });
  const input = {
    sourceRecordingId: 'recording-42',
    durationMs: 12_000,
    selection,
    events: [
      { id: 'emphasis-b', kind: 'emphasis' as const, atMs: 8_000 },
      { id: 'chapter-a', kind: 'chapter-start' as const, atMs: 1_000 },
      { id: 'data-a', kind: 'data-point' as const, atMs: 4_000, holdMs: 5_000 },
      { id: 'emphasis-a', kind: 'emphasis' as const, atMs: 2_000 },
    ],
  };

  const first = buildTeachingTrackPlan(input);
  const second = buildTeachingTrackPlan({ ...input, events: [...input.events].reverse() });

  expect(first).toEqual(second);
  expect(first).toEqual({
    schemaVersion: 1,
    sourceRecordingId: 'recording-42',
    teachingPackId: 'data-teaching',
    curatedAssetIds: ['motion-chapter-card', 'chart-bars', 'sfx-pop', 'sfx-chime'],
    placements: [
      { assetId: 'motion-chapter-card', track: 'motion-graphics', startMs: 1_000, endMs: 3_400 },
      { assetId: 'sfx-pop', track: 'sound-effect', startMs: 2_000, endMs: 2_420 },
      { assetId: 'chart-bars', track: 'chart', startMs: 4_000, endMs: 9_000 },
      { assetId: 'sfx-chime', track: 'sound-effect', startMs: 8_000, endMs: 8_600 },
    ],
  });
});

test('planning skips event categories the user did not select instead of injecting hidden defaults', () => {
  const selection = createTeachingAssetPreselection({
    teachingPackId: 'minimal-teaching',
    catalog,
    selectedAssetIds: ['chart-bars'],
  });

  expect(buildTeachingTrackPlan({
    sourceRecordingId: 'recording-minimal',
    durationMs: 6_000,
    selection,
    events: [
      { id: 'chapter', kind: 'chapter-start', atMs: 0 },
      { id: 'data', kind: 'data-point', atMs: 1_500 },
      { id: 'emphasis', kind: 'emphasis', atMs: 3_000 },
    ],
  }).placements).toEqual([
    { assetId: 'chart-bars', track: 'chart', startMs: 1_500, endMs: 5_500 },
  ]);
});

test('recipe parsing rejects unsupported track injection even when the asset id was selected', () => {
  expect(() => parseTeachingEditRecipe({
    schemaVersion: 1,
    sourceRecordingId: 'recording-42',
    teachingPackId: 'data-teaching',
    curatedAssetIds: ['chart-bars'],
    placements: [{ assetId: 'chart-bars', track: 'hidden-overlay', startMs: 1_000, endMs: 2_000 }],
  })).toThrow('recipe_placement_invalid');
});
