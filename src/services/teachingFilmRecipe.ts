'use client';

import { getClientDb } from '@/lib/db-client';
import {
  buildTeachingTrackPlan,
  createTeachingAssetPreselection,
  DEFAULT_CURATED_TEACHING_ASSETS,
  DEFAULT_TEACHING_PACK_ID,
  type TeachingRecordingEvent,
} from '@/desktop/teachingRecipePlanner';
import type {
  LaserEvent,
  RecordingMetadata,
  RecordingTeachingEditRecipeV1,
  RecordingTeachingRecipeSelectionV1,
  WhiteboardSnapshot,
} from '@/types/recording';

export type TeachingRecipeCategory = 'motion' | 'charts' | 'sound';

const CATEGORY_ASSET_IDS: Record<TeachingRecipeCategory, string[]> = {
  motion: ['key-points-drawer-01'],
  charts: ['chart-bars-01'],
  sound: ['teaching-pop-01'],
};

export function createRecordingTeachingSelection(params: {
  enabled: boolean;
  categories: Record<TeachingRecipeCategory, boolean>;
}): RecordingTeachingRecipeSelectionV1 {
  return {
    schemaVersion: 1,
    enabled: params.enabled,
    teachingPackId: DEFAULT_TEACHING_PACK_ID,
    selectedAssetIds: (Object.keys(CATEGORY_ASSET_IDS) as TeachingRecipeCategory[])
      .filter((category) => params.categories[category])
      .flatMap((category) => CATEGORY_ASSET_IDS[category]),
  };
}

export function categoriesFromRecordingTeachingSelection(
  selection?: RecordingTeachingRecipeSelectionV1,
): Record<TeachingRecipeCategory, boolean> {
  const selected = new Set(selection?.selectedAssetIds ?? DEFAULT_CURATED_TEACHING_ASSETS.map((asset) => asset.assetId));
  return {
    motion: CATEGORY_ASSET_IDS.motion.some((id) => selected.has(id)),
    charts: CATEGORY_ASSET_IDS.charts.some((id) => selected.has(id)),
    sound: CATEGORY_ASSET_IDS.sound.some((id) => selected.has(id)),
  };
}

function elementCount(snapshot: WhiteboardSnapshot): number {
  return Array.isArray(snapshot.elements) ? snapshot.elements.length : 0;
}

/**
 * Converts recorded teaching gestures into semantic placement hints. The
 * planner uses real capture-relative timestamps; it does not manufacture
 * random timeline positions or consult assets the user did not select.
 */
export function deriveTeachingRecordingEvents(params: {
  durationMs: number;
  snapshots: WhiteboardSnapshot[];
  laserEvents: LaserEvent[];
}): TeachingRecordingEvent[] {
  if (!Number.isFinite(params.durationMs) || params.durationMs <= 0) return [];
  const events: TeachingRecordingEvent[] = [{ id: 'chapter-start-0', kind: 'chapter-start', atMs: 0 }];

  const snapshots = [...params.snapshots]
    .filter((snapshot) => Number.isFinite(snapshot.timestamp) && snapshot.timestamp >= 0 && snapshot.timestamp < params.durationMs)
    .sort((a, b) => a.timestamp - b.timestamp);
  let previousCount = snapshots[0] ? elementCount(snapshots[0]) : 0;
  let lastDataPointAt = -Infinity;
  for (const snapshot of snapshots.slice(1)) {
    const count = elementCount(snapshot);
    if (count > previousCount && snapshot.timestamp - lastDataPointAt >= 4_000) {
      events.push({ id: `data-point-${Math.round(snapshot.timestamp)}`, kind: 'data-point', atMs: snapshot.timestamp });
      lastDataPointAt = snapshot.timestamp;
    }
    previousCount = count;
  }

  let lastEmphasisAt = -Infinity;
  for (const event of [...params.laserEvents].sort((a, b) => a.timestamp - b.timestamp)) {
    if (event.button !== 'down' || event.timestamp < 0 || event.timestamp >= params.durationMs) continue;
    if (event.timestamp - lastEmphasisAt < 1_500) continue;
    events.push({ id: `emphasis-${Math.round(event.timestamp)}`, kind: 'emphasis', atMs: event.timestamp });
    lastEmphasisAt = event.timestamp;
  }

  return events.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
}

export function buildRecordingTeachingRecipe(params: {
  recordingId: string;
  durationMs: number;
  selection?: RecordingTeachingRecipeSelectionV1;
  snapshots: WhiteboardSnapshot[];
  laserEvents: LaserEvent[];
}): RecordingTeachingEditRecipeV1 | undefined {
  const selection = params.selection;
  if (!selection?.enabled || selection.selectedAssetIds.length === 0) return undefined;
  const preselection = createTeachingAssetPreselection({
    teachingPackId: selection.teachingPackId,
    catalog: [...DEFAULT_CURATED_TEACHING_ASSETS],
    selectedAssetIds: selection.selectedAssetIds,
  });
  const plan = buildTeachingTrackPlan({
    sourceRecordingId: params.recordingId,
    durationMs: params.durationMs,
    selection: preselection,
    events: deriveTeachingRecordingEvents(params),
  });
  return {
    ...plan,
    placements: plan.placements.map((placement) => {
      if (placement.track !== 'motion-graphics'
        && placement.track !== 'chart'
        && placement.track !== 'sound-effect') {
        throw new Error('recording_teaching_track_invalid');
      }
      return { ...placement, track: placement.track };
    }),
  };
}

export async function finalizeRecordingTeachingRecipe(
  metadata: RecordingMetadata,
): Promise<RecordingTeachingEditRecipeV1 | undefined> {
  const selection = metadata.setup?.teachingRecipe;
  if (!selection?.enabled) return undefined;
  const db = getClientDb();
  const [snapshots, laserEvents] = await Promise.all([
    db.snapshots.where('recordingId').equals(metadata.id).toArray(),
    db.laserEvents.where('recordingId').equals(metadata.id).toArray(),
  ]);
  const recipe = buildRecordingTeachingRecipe({
    recordingId: metadata.id,
    durationMs: metadata.durationMs,
    selection,
    snapshots,
    laserEvents,
  });
  if (recipe) await db.recordings.update(metadata.id, {
    teachingEditRecipe: recipe,
    teachingRecipeStatus: 'ready',
  });
  return recipe;
}
