import type {
  TeachingEditRecipeV1,
  TeachingRecipeTrack,
} from './projectSchema';

export type TeachingAssetKind = 'motion-graphic' | 'chart' | 'sound-effect';

export interface CuratedTeachingAsset {
  assetId: string;
  kind: TeachingAssetKind;
  durationMs: number;
}

export const DEFAULT_TEACHING_PACK_ID = 'chatcut-teaching-core-v1';

/**
 * The starter pack is intentionally explicit and versioned. The UI never gets
 * access to an unbounded ChatCut catalog during recording; future catalog sync
 * replaces this list before the user confirms the setup.
 */
export const DEFAULT_CURATED_TEACHING_ASSETS: readonly CuratedTeachingAsset[] = Object.freeze([
  Object.freeze({ assetId: 'key-points-drawer-01', kind: 'motion-graphic' as const, durationMs: 3_200 }),
  Object.freeze({ assetId: 'chart-bars-01', kind: 'chart' as const, durationMs: 4_000 }),
  Object.freeze({ assetId: 'teaching-pop-01', kind: 'sound-effect' as const, durationMs: 420 }),
]);

export interface TeachingAssetPreselectionV1 {
  schemaVersion: 1;
  teachingPackId: string;
  assets: CuratedTeachingAsset[];
}

export type TeachingRecordingEventKind = 'chapter-start' | 'data-point' | 'emphasis';

export interface TeachingRecordingEvent {
  id: string;
  kind: TeachingRecordingEventKind;
  atMs: number;
  holdMs?: number;
}

const ASSET_KINDS: readonly TeachingAssetKind[] = ['motion-graphic', 'chart', 'sound-effect'];

const EVENT_ASSET_KIND: Record<TeachingRecordingEventKind, TeachingAssetKind> = {
  'chapter-start': 'motion-graphic',
  'data-point': 'chart',
  emphasis: 'sound-effect',
};

const ASSET_TRACK: Record<TeachingAssetKind, TeachingRecipeTrack> = {
  'motion-graphic': 'motion-graphics',
  chart: 'chart',
  'sound-effect': 'sound-effect',
};

function validAsset(asset: CuratedTeachingAsset): boolean {
  return typeof asset.assetId === 'string'
    && asset.assetId.length > 0
    && ASSET_KINDS.includes(asset.kind)
    && Number.isFinite(asset.durationMs)
    && asset.durationMs > 0;
}

/**
 * Freezes the user's pre-record choice against the visible ChatCut teaching pack.
 * The selected list is the only asset authority passed to post-record planning.
 */
export function createTeachingAssetPreselection(params: {
  teachingPackId: string;
  catalog: CuratedTeachingAsset[];
  selectedAssetIds: string[];
}): TeachingAssetPreselectionV1 {
  if (!params.teachingPackId) throw new Error('teaching_pack_identity_required');
  if (!params.catalog.every(validAsset)) throw new Error('teaching_asset_catalog_invalid');

  const catalogById = new Map<string, CuratedTeachingAsset>();
  for (const asset of params.catalog) {
    if (catalogById.has(asset.assetId)) throw new Error('teaching_asset_catalog_invalid');
    catalogById.set(asset.assetId, asset);
  }

  const selected = new Set<string>();
  const assets = params.selectedAssetIds.map((assetId) => {
    if (selected.has(assetId)) throw new Error('teaching_asset_selection_invalid');
    selected.add(assetId);
    const asset = catalogById.get(assetId);
    if (!asset) throw new Error('teaching_asset_not_in_catalog');
    return Object.freeze({ ...asset });
  });

  Object.freeze(assets);
  return Object.freeze({
    schemaVersion: 1,
    teachingPackId: params.teachingPackId,
    assets,
  });
}

function normalizedEvents(events: TeachingRecordingEvent[], durationMs: number): TeachingRecordingEvent[] {
  return events
    .filter((event) => (
      typeof event.id === 'string'
      && event.id.length > 0
      && event.kind in EVENT_ASSET_KIND
      && Number.isFinite(event.atMs)
      && event.atMs >= 0
      && event.atMs < durationMs
      && (event.holdMs === undefined || (Number.isFinite(event.holdMs) && event.holdMs > 0))
    ))
    .sort((a, b) => a.atMs - b.atMs || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

/** Builds a reproducible one-click timeline without consulting any hidden asset catalog. */
export function buildTeachingTrackPlan(params: {
  sourceRecordingId: string;
  durationMs: number;
  selection: TeachingAssetPreselectionV1;
  events: TeachingRecordingEvent[];
}): TeachingEditRecipeV1 {
  if (!params.sourceRecordingId || !Number.isFinite(params.durationMs) || params.durationMs <= 0) {
    throw new Error('teaching_track_plan_identity_invalid');
  }

  const assetsByKind = new Map<TeachingAssetKind, CuratedTeachingAsset[]>();
  for (const asset of params.selection.assets) {
    if (!validAsset(asset)) throw new Error('teaching_asset_selection_invalid');
    const group = assetsByKind.get(asset.kind) ?? [];
    group.push(asset);
    assetsByKind.set(asset.kind, group);
  }

  const nextAssetIndex = new Map<TeachingAssetKind, number>();
  const placements = normalizedEvents(params.events, params.durationMs).flatMap((event) => {
    const assetKind = EVENT_ASSET_KIND[event.kind];
    const assets = assetsByKind.get(assetKind) ?? [];
    if (assets.length === 0) return [];

    const index = nextAssetIndex.get(assetKind) ?? 0;
    const asset = assets[index % assets.length];
    nextAssetIndex.set(assetKind, index + 1);
    const duration = event.holdMs ?? asset.durationMs;

    return [{
      assetId: asset.assetId,
      track: ASSET_TRACK[asset.kind],
      startMs: event.atMs,
      endMs: Math.min(params.durationMs, event.atMs + duration),
    }];
  });

  return {
    schemaVersion: 1,
    sourceRecordingId: params.sourceRecordingId,
    teachingPackId: params.selection.teachingPackId,
    curatedAssetIds: params.selection.assets.map((asset) => asset.assetId),
    placements,
  };
}
