import { expect, test } from '@playwright/test';

import {
  createTeachingAssetCatalog,
  materializeTeachingAssetContent,
  selectTeachingCatalogAssets,
  type TeachingAssetCatalogEntry,
} from '@/desktop/teachingAssetCatalog';
import { buildTeachingTrackPlan } from '@/desktop/teachingRecipePlanner';

const MOTION_CHECKSUM = 'a'.repeat(64);
const CHART_CHECKSUM = 'b'.repeat(64);
const SOUND_CHECKSUM = 'c'.repeat(64);

function entry(overrides: Partial<TeachingAssetCatalogEntry> = {}): TeachingAssetCatalogEntry {
  return {
    assetId: 'motion-key-points-v1',
    catalogVersion: 'chatcut-teaching-2026.08',
    assetVersion: '1.4.0',
    kind: 'motion-graphic',
    source: { provider: 'chatcut', uri: 'chatcut://teaching/motion-key-points-v1' },
    license: { licenseId: 'chatcut-commercial-v1', status: 'valid' },
    checksum: { algorithm: 'sha256', value: MOTION_CHECKSUM },
    cache: { status: 'verified', checksum: MOTION_CHECKSUM },
    durationMs: 3_200,
    contentSlots: [
      { slotId: 'title', type: 'title' },
      { slotId: 'score', type: 'number' },
    ],
    ...overrides,
  };
}

function catalogEntries(): TeachingAssetCatalogEntry[] {
  return [
    entry(),
    entry({
      assetId: 'chart-bars-v2',
      assetVersion: '2.1.0',
      kind: 'chart',
      source: { provider: 'chatcut', uri: 'chatcut://teaching/chart-bars-v2' },
      checksum: { algorithm: 'sha256', value: CHART_CHECKSUM },
      cache: { status: 'verified', checksum: CHART_CHECKSUM },
      durationMs: 4_000,
      contentSlots: [
        { slotId: 'title', type: 'title' },
        { slotId: 'dataset', type: 'chart-data' },
      ],
    }),
    entry({
      assetId: 'sound-section-pop-v1',
      assetVersion: '1.0.2',
      kind: 'sound-effect',
      source: { provider: 'chatcut', uri: 'chatcut://teaching/sound-section-pop-v1' },
      checksum: { algorithm: 'sha256', value: SOUND_CHECKSUM },
      cache: { status: 'missing' },
      durationMs: 420,
      contentSlots: [],
    }),
  ];
}

test('catalog requires versioned source, license, checksum, cache, duration, and content-slot metadata', () => {
  const catalog = createTeachingAssetCatalog({
    catalogVersion: 'chatcut-teaching-2026.08',
    entries: catalogEntries(),
  });

  expect(catalog).toMatchObject({ schemaVersion: 1, catalogVersion: 'chatcut-teaching-2026.08' });
  expect(catalog.entries[0]).toMatchObject({
    assetVersion: '1.4.0',
    kind: 'motion-graphic',
    source: { provider: 'chatcut' },
    license: { status: 'valid' },
    checksum: { algorithm: 'sha256' },
    cache: { status: 'verified' },
    durationMs: 3_200,
    contentSlots: [{ slotId: 'title', type: 'title' }, { slotId: 'score', type: 'number' }],
  });

  const missingLicense = { ...entry(), license: undefined } as unknown as TeachingAssetCatalogEntry;
  expect(() => createTeachingAssetCatalog({ catalogVersion: 'chatcut-teaching-2026.08', entries: [missingLicense] }))
    .toThrow('teaching_asset_catalog_entry_invalid');
});

test('pre-record selection contains only explicit IDs and rejects duplicates or unknown assets', () => {
  const catalog = createTeachingAssetCatalog({ catalogVersion: 'chatcut-teaching-2026.08', entries: catalogEntries() });
  const selection = selectTeachingCatalogAssets({
    teachingPackId: 'chatcut-teaching-core-v1',
    catalog,
    selectedAssetIds: ['chart-bars-v2'],
    offline: false,
  });

  expect(selection.assets.map((asset) => asset.assetId)).toEqual(['chart-bars-v2']);
  expect(() => selectTeachingCatalogAssets({ teachingPackId: 'pack', catalog, selectedAssetIds: ['chart-bars-v2', 'chart-bars-v2'], offline: false }))
    .toThrow('teaching_asset_selection_invalid');
  expect(() => selectTeachingCatalogAssets({ teachingPackId: 'pack', catalog, selectedAssetIds: ['not-visible'], offline: false }))
    .toThrow('teaching_asset_not_in_catalog');
});

test('offline mode accepts only checksum-verified cache entries', () => {
  const catalog = createTeachingAssetCatalog({ catalogVersion: 'chatcut-teaching-2026.08', entries: catalogEntries() });

  expect(selectTeachingCatalogAssets({ teachingPackId: 'pack', catalog, selectedAssetIds: ['motion-key-points-v1'], offline: true }).assets)
    .toHaveLength(1);
  expect(() => selectTeachingCatalogAssets({ teachingPackId: 'pack', catalog, selectedAssetIds: ['sound-section-pop-v1'], offline: true }))
    .toThrow('teaching_asset_offline_cache_unverified');

  const mismatched = createTeachingAssetCatalog({
    catalogVersion: 'chatcut-teaching-2026.08',
    entries: [entry({ cache: { status: 'verified', checksum: 'd'.repeat(64) } })],
  });
  expect(() => selectTeachingCatalogAssets({ teachingPackId: 'pack', catalog: mismatched, selectedAssetIds: ['motion-key-points-v1'], offline: true }))
    .toThrow('teaching_asset_offline_cache_unverified');
});

test('expired, revoked, or missing licenses are rejected before use', () => {
  for (const status of ['expired', 'revoked'] as const) {
    const catalog = createTeachingAssetCatalog({
      catalogVersion: 'chatcut-teaching-2026.08',
      entries: [entry({ license: { licenseId: 'chatcut-commercial-v1', status } })],
    });
    expect(() => selectTeachingCatalogAssets({ teachingPackId: 'pack', catalog, selectedAssetIds: ['motion-key-points-v1'], offline: false }))
      .toThrow('teaching_asset_license_invalid');
  }
});

test('unselected asset categories cannot be injected by post-record events', () => {
  const catalog = createTeachingAssetCatalog({ catalogVersion: 'chatcut-teaching-2026.08', entries: catalogEntries() });
  const selection = selectTeachingCatalogAssets({
    teachingPackId: 'chatcut-teaching-core-v1',
    catalog,
    selectedAssetIds: ['motion-key-points-v1'],
    offline: true,
  });
  const plan = buildTeachingTrackPlan({
    sourceRecordingId: 'lesson-1',
    durationMs: 10_000,
    selection,
    events: [
      { id: 'chapter', kind: 'chapter-start', atMs: 1_000 },
      { id: 'chart', kind: 'data-point', atMs: 3_000 },
      { id: 'sound', kind: 'emphasis', atMs: 5_000 },
    ],
  });

  expect(plan.placements).toEqual([{ assetId: 'motion-key-points-v1', track: 'motion-graphics', startMs: 1_000, endMs: 4_200 }]);
});

test('post-record content replaces declared slots while preserving the original asset version', () => {
  const catalog = createTeachingAssetCatalog({ catalogVersion: 'chatcut-teaching-2026.08', entries: catalogEntries() });
  const selection = selectTeachingCatalogAssets({ teachingPackId: 'pack', catalog, selectedAssetIds: ['chart-bars-v2'], offline: true });
  const replacements = {
    title: 'Weekly active learners',
    dataset: {
      labels: ['Mon', 'Tue'],
      series: [{ name: 'Learners', values: [120, 168] }],
    },
  };

  const materialized = materializeTeachingAssetContent({ selection, assetId: 'chart-bars-v2', replacements });
  expect(materialized).toMatchObject({
    schemaVersion: 1,
    assetId: 'chart-bars-v2',
    catalogVersion: 'chatcut-teaching-2026.08',
    assetVersion: '2.1.0',
    originalAssetVersion: '2.1.0',
    content: [
      { slotId: 'title', type: 'title', value: 'Weekly active learners' },
      { slotId: 'dataset', type: 'chart-data', value: replacements.dataset },
    ],
  });
  expect(() => materializeTeachingAssetContent({ selection, assetId: 'chart-bars-v2', replacements: { subtitle: 'not declared' } }))
    .toThrow('teaching_asset_content_slot_invalid');
  expect(JSON.stringify(materialized)).toBe(JSON.stringify(materializeTeachingAssetContent({ selection, assetId: 'chart-bars-v2', replacements: structuredClone(replacements) })));

  const motionSelection = selectTeachingCatalogAssets({ teachingPackId: 'pack', catalog, selectedAssetIds: ['motion-key-points-v1'], offline: true });
  expect(materializeTeachingAssetContent({
    selection: motionSelection,
    assetId: 'motion-key-points-v1',
    replacements: { title: 'Three takeaways', score: 92 },
  }).content).toEqual([
    { slotId: 'title', type: 'title', value: 'Three takeaways' },
    { slotId: 'score', type: 'number', value: 92 },
  ]);
});
