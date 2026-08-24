import { expect, test } from '@playwright/test';

import {
  compileTeachingComposition,
  executeTeachingCompositionAtomically,
  type TeachingCompositionAdapter,
  type TeachingCompositionOperation,
} from '@/desktop/teachingCompositionExecutor';
import {
  createTeachingAssetCatalog,
  selectTeachingCatalogAssets,
  type TeachingAssetCatalogEntry,
} from '@/desktop/teachingAssetCatalog';

const CHECKSUMS = {
  motion: 'a'.repeat(64),
  chart: 'b'.repeat(64),
  sound: 'c'.repeat(64),
};

function entry(overrides: Partial<TeachingAssetCatalogEntry>): TeachingAssetCatalogEntry {
  const checksum = overrides.checksum?.value ?? CHECKSUMS.motion;
  return {
    assetId: 'motion-card',
    catalogVersion: 'catalog-1',
    assetVersion: '1.0.0',
    kind: 'motion-graphic',
    source: { provider: 'chatcut', uri: 'chatcut://motion-card' },
    license: { licenseId: 'commercial', status: 'valid' },
    checksum: { algorithm: 'sha256', value: checksum },
    cache: { status: 'verified', checksum, localUri: 'file:///cache/motion-card.json' },
    durationMs: 2_000,
    contentSlots: [{ slotId: 'title', type: 'title' }],
    ...overrides,
  };
}

function fixture() {
  const entries = [
    entry({}),
    entry({
      assetId: 'chart-bars',
      assetVersion: '2.0.0',
      kind: 'chart',
      source: { provider: 'chatcut', uri: 'chatcut://chart-bars' },
      checksum: { algorithm: 'sha256', value: CHECKSUMS.chart },
      cache: { status: 'verified', checksum: CHECKSUMS.chart, localUri: 'file:///cache/chart-bars.json' },
      durationMs: 3_000,
      contentSlots: [{ slotId: 'dataset', type: 'chart-data' }],
    }),
    entry({
      assetId: 'sfx-pop',
      kind: 'sound-effect',
      source: { provider: 'chatcut', uri: 'chatcut://sfx-pop' },
      checksum: { algorithm: 'sha256', value: CHECKSUMS.sound },
      cache: { status: 'verified', checksum: CHECKSUMS.sound, localUri: 'file:///cache/sfx-pop.wav' },
      durationMs: 300,
      contentSlots: [],
    }),
    entry({
      assetId: 'hidden-motion',
      source: { provider: 'chatcut', uri: 'chatcut://hidden-motion' },
      cache: { status: 'verified', checksum: CHECKSUMS.motion, localUri: 'file:///cache/hidden-motion.json' },
    }),
  ];
  const catalog = createTeachingAssetCatalog({ catalogVersion: 'catalog-1', entries });
  const selectedAssetIds = ['motion-card', 'chart-bars', 'sfx-pop'];
  const selection = selectTeachingCatalogAssets({
    teachingPackId: 'teaching-pack',
    catalog,
    selectedAssetIds,
    offline: true,
  });
  return {
    catalog,
    selection,
    selectedAssetIds,
    selectedCategories: ['motion-graphic', 'chart', 'sound-effect'] as const,
    sourceRecordingId: 'recording-1',
    durationMs: 10_000,
    sourceTracks: [
      { trackId: 'screen', kind: 'screen' as const },
      { trackId: 'mic', kind: 'microphone' as const },
      { trackId: 'system', kind: 'system-audio' as const },
    ],
    events: [
      { id: 'chapter', kind: 'chapter-start' as const, atMs: 500 },
      { id: 'data', kind: 'data-point' as const, atMs: 3_000 },
      { id: 'emphasis', kind: 'emphasis' as const, atMs: 7_000 },
    ],
    contentUpdates: {
      'motion-card': { title: 'Three key ideas' },
      'chart-bars': {
        dataset: { labels: ['A', 'B'], series: [{ name: 'Learners', values: [12, 19] }] },
      },
    },
  };
}

const supported = {
  'motion-graphic': true,
  chart: true,
  'sound-effect': true,
} as const;

test('compiles only explicitly selected cached assets into deterministic concrete operations', () => {
  const input = fixture();
  const first = compileTeachingComposition({ ...input, renderCapabilities: supported });
  const second = compileTeachingComposition({
    ...input,
    events: [...input.events].reverse(),
    renderCapabilities: supported,
  });

  expect(first).toEqual(second);
  expect(first.status).toBe('ready');
  if (first.status !== 'ready') return;
  expect(first.plan.operations).toHaveLength(3);
  expect(first.plan.operations.map((operation) => operation.track)).toEqual([
    'motion-graphics', 'chart', 'sound-effect',
  ]);
  expect(first.plan.operations.map((operation) => operation.asset.assetId)).toEqual([
    'motion-card', 'chart-bars', 'sfx-pop',
  ]);
  expect(first.plan.operations.every((operation) => operation.asset.localUri.startsWith('file:///cache/'))).toBe(true);
  expect(first.plan.operations[0].content).toEqual([{ slotId: 'title', type: 'title', value: 'Three key ideas' }]);
  expect(first.plan.operations[1].content[0]).toMatchObject({ slotId: 'dataset', type: 'chart-data' });
  expect(first.plan.operations[2]).toMatchObject({
    operation: 'mix-sound-effect',
    audio: {
      gainDb: -10,
      gainCeilingDb: -6,
      ducking: { targetSourceTracks: ['mic', 'system'] },
    },
  });
  expect(JSON.stringify(first.plan)).not.toContain('hidden-motion');
  expect(first.plan.sourceTracks).toEqual(input.sourceTracks);
});

test('rejects hidden selection and unselected content replacement', () => {
  const input = fixture();
  expect(() => compileTeachingComposition({
    ...input,
    selectedAssetIds: [...input.selectedAssetIds, 'hidden-motion'],
    renderCapabilities: supported,
  })).toThrow('teaching_composition_selection_mismatch');
  expect(() => compileTeachingComposition({
    ...input,
    contentUpdates: { ...input.contentUpdates, 'hidden-motion': { title: 'injected' } },
    renderCapabilities: supported,
  })).toThrow('teaching_composition_content_asset_unselected');
});

test('fails closed for invalid license, cache, checksum, local reference, and asset version', () => {
  for (const mutation of [
    (asset: TeachingAssetCatalogEntry) => ({ ...asset, license: { ...asset.license, status: 'revoked' as const } }),
    (asset: TeachingAssetCatalogEntry) => ({ ...asset, cache: { ...asset.cache, status: 'missing' as const } }),
    (asset: TeachingAssetCatalogEntry) => ({ ...asset, cache: { ...asset.cache, checksum: 'd'.repeat(64) } }),
    (asset: TeachingAssetCatalogEntry) => ({ ...asset, cache: { ...asset.cache, localUri: undefined } }),
    (asset: TeachingAssetCatalogEntry) => ({ ...asset, assetVersion: '9.9.9' }),
  ]) {
    const input = fixture();
    input.selection.assets[0] = mutation(input.selection.assets[0]);
    expect(() => compileTeachingComposition({ ...input, renderCapabilities: supported })).toThrow();
  }
});

test('rejects every selected snapshot mutation and emits only authoritative catalog identity', () => {
  const mutations: Array<(asset: TeachingAssetCatalogEntry) => TeachingAssetCatalogEntry> = [
    (asset) => ({ ...asset, source: { ...asset.source, provider: 'bundled' } }),
    (asset) => ({ ...asset, source: { ...asset.source, uri: 'chatcut://forged-source' } }),
    (asset) => ({ ...asset, license: { ...asset.license, licenseId: 'forged-license' } }),
    (asset) => ({ ...asset, durationMs: asset.durationMs + 1_000 }),
    (asset) => ({ ...asset, contentSlots: [{ slotId: 'forged-slot', type: 'title' }] }),
    (asset) => ({
      ...asset,
      checksum: { ...asset.checksum, algorithm: 'sha512' as 'sha256' },
    }),
    (asset) => ({ ...asset, cache: { ...asset.cache, localUri: 'file:///cache/forged.json' } }),
  ];

  for (const mutate of mutations) {
    const input = fixture();
    input.selection.assets[0] = mutate(input.selection.assets[0]);
    expect(() => compileTeachingComposition({ ...input, renderCapabilities: supported }))
      .toThrow('teaching_composition_asset_snapshot_mismatch');
  }

  const canonical = compileTeachingComposition({ ...fixture(), renderCapabilities: supported });
  expect(canonical.status).toBe('ready');
  if (canonical.status !== 'ready') return;
  expect(canonical.plan.operations[0].asset).toMatchObject({
    localUri: 'file:///cache/motion-card.json',
    checksumAlgorithm: 'sha256',
    checksum: CHECKSUMS.motion,
  });
});

test('returns an explicit unsupported capability instead of pretending the asset rendered', () => {
  const result = compileTeachingComposition({
    ...fixture(),
    renderCapabilities: { ...supported, chart: false },
  });
  expect(result).toEqual({
    status: 'unsupported-capability',
    unsupported: [{ assetId: 'chart-bars', kind: 'chart', capability: 'render-chart' }],
  });
});

interface TestProject {
  sourceTracks: Array<{ trackId: string; kind: string }>;
  operations: TeachingCompositionOperation[];
}

function adapter(failAt = -1): TeachingCompositionAdapter<TestProject> {
  let applied = 0;
  return {
    capabilities: supported,
    cloneProject: (project) => structuredClone(project),
    applyOperation: (project, operation) => {
      if (applied++ === failAt) throw new Error('renderer_failed');
      project.operations.push(structuredClone(operation));
    },
    validateProject: () => undefined,
  };
}

test('applies all three categories atomically with no manual timeline edit in the supported fixture', () => {
  const source: TestProject = { sourceTracks: fixture().sourceTracks, operations: [] };
  const result = executeTeachingCompositionAtomically({
    project: source,
    adapter: adapter(),
    input: fixture(),
  });
  expect(result.status).toBe('applied');
  if (result.status !== 'applied') return;
  expect(result.project.operations).toHaveLength(3);
  expect(result.manualEditRequired).toBe(false);
  expect(result.project.sourceTracks).toEqual(source.sourceTracks);
  expect(source.operations).toEqual([]);
});

test('adapter failure is atomic and never exposes a partially mutated project', () => {
  const source: TestProject = { sourceTracks: fixture().sourceTracks, operations: [] };
  const before = structuredClone(source);
  const result = executeTeachingCompositionAtomically({
    project: source,
    adapter: adapter(1),
    input: fixture(),
  });
  expect(result).toEqual({ status: 'failed', code: 'teaching_composition_apply_failed' });
  expect(source).toEqual(before);
});

test('malicious adapter cannot mutate the canonical validated plan or nested asset/content identity', () => {
  const source: TestProject = { sourceTracks: fixture().sourceTracks, operations: [] };
  const malicious: TeachingCompositionAdapter<TestProject> = {
    capabilities: supported,
    cloneProject: (project) => structuredClone(project),
    applyOperation: (project, operation) => {
      try { operation.startMs = 9_999; } catch { /* canonical operation is frozen */ }
      try { operation.asset.localUri = 'file:///cache/forged.json'; } catch { /* frozen */ }
      try { operation.asset.checksum = 'f'.repeat(64); } catch { /* frozen */ }
      try { operation.content[0].value = 'forged content'; } catch { /* frozen */ }
      project.operations.push(structuredClone(operation));
    },
    validateProject: (_project, plan) => {
      try { plan.operations[0].endMs = 1; } catch { /* frozen */ }
      try { plan.operations[0].asset.assetVersion = 'forged'; } catch { /* frozen */ }
    },
  };

  const result = executeTeachingCompositionAtomically({
    project: source,
    adapter: malicious,
    input: fixture(),
  });
  expect(result.status).toBe('applied');
  if (result.status !== 'applied') return;
  expect(result.plan.operations[0]).toMatchObject({
    startMs: 500,
    endMs: 2_500,
    asset: {
      localUri: 'file:///cache/motion-card.json',
      checksum: CHECKSUMS.motion,
      assetVersion: '1.0.0',
    },
    content: [{ slotId: 'title', value: 'Three key ideas' }],
  });
  expect(result.project.operations[0]).toEqual(result.plan.operations[0]);
  expect(Object.isFrozen(result.plan)).toBe(true);
  expect(Object.isFrozen(result.plan.operations[0].asset)).toBe(true);
  expect(Object.isFrozen(result.plan.operations[0].content)).toBe(true);
});

test('enforces bounded operation count and serialized byte size', () => {
  const input = fixture();
  const manyEvents = Array.from({ length: 1_025 }, (_, index) => ({
    id: `chapter-${index}`,
    kind: 'chapter-start' as const,
    atMs: index * 3_000,
  }));
  expect(() => compileTeachingComposition({
    ...input,
    durationMs: 3_100_000,
    events: manyEvents,
    renderCapabilities: supported,
  })).toThrow('teaching_composition_operation_limit');

  expect(() => compileTeachingComposition({
    ...input,
    contentUpdates: { 'motion-card': { title: 'x'.repeat(1_100_000) } },
    renderCapabilities: supported,
  })).toThrow('teaching_composition_byte_limit');
});

test('rejects same-track overlaps while clamping operations to recording duration', () => {
  const input = fixture();
  expect(() => compileTeachingComposition({
    ...input,
    events: [
      { id: 'a', kind: 'chapter-start', atMs: 100 },
      { id: 'b', kind: 'chapter-start', atMs: 200 },
    ],
    renderCapabilities: supported,
  })).toThrow('teaching_composition_track_overlap');

  const result = compileTeachingComposition({
    ...input,
    events: [{ id: 'end', kind: 'chapter-start', atMs: 9_500 }],
    renderCapabilities: supported,
  });
  expect(result.status).toBe('ready');
  if (result.status === 'ready') expect(result.plan.operations[0].endMs).toBe(10_000);
});
