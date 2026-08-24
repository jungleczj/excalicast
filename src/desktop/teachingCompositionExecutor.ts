import {
  createTeachingAssetCatalog,
  materializeTeachingAssetContent,
  type MaterializedTeachingAssetContentV1,
  type TeachingAssetCatalogEntry,
  type TeachingAssetCatalogV1,
  type TeachingAssetContentValue,
  type TeachingCatalogSelectionV1,
} from './teachingAssetCatalog';
import {
  buildTeachingTrackPlan,
  type TeachingAssetKind,
  type TeachingRecordingEvent,
} from './teachingRecipePlanner';

export const MAX_TEACHING_COMPOSITION_OPERATIONS = 1_024;
export const MAX_TEACHING_COMPOSITION_BYTES = 1_048_576;

export type TeachingCompositionTrack = 'motion-graphics' | 'chart' | 'sound-effect';
export type TeachingCompositionOperationKind =
  | 'place-motion-graphic'
  | 'render-chart'
  | 'mix-sound-effect';

export type TeachingSourceTrackKind = 'screen' | 'camera' | 'microphone' | 'system-audio';

export interface TeachingCompositionSourceTrack {
  trackId: string;
  kind: TeachingSourceTrackKind;
}

export interface ImmutableTeachingAssetReference {
  assetId: string;
  kind: TeachingAssetKind;
  catalogVersion: string;
  assetVersion: string;
  checksumAlgorithm: 'sha256';
  checksum: string;
  localUri: string;
}

export interface TeachingCompositionContentSubstitution {
  slotId: string;
  type: 'title' | 'number' | 'chart-data';
  value: TeachingAssetContentValue;
}

export interface TeachingCompositionOperation {
  operationId: string;
  operation: TeachingCompositionOperationKind;
  track: TeachingCompositionTrack;
  asset: ImmutableTeachingAssetReference;
  startMs: number;
  endMs: number;
  trim: {
    sourceStartMs: 0;
    sourceEndMs: number;
    playbackMode: 'once' | 'hold-last-frame';
  };
  zOrder: number;
  transition: {
    enterMs: number;
    exitMs: number;
    easing: 'easeInOutCubic';
  };
  content: TeachingCompositionContentSubstitution[];
  audio?: {
    gainDb: number;
    gainCeilingDb: number;
    ducking: {
      targetSourceTracks: string[];
      attenuationDb: number;
      attackMs: number;
      releaseMs: number;
    };
    mixesAsIndependentEffect: true;
  };
}

export interface TeachingCompositionPlanV1 {
  schemaVersion: 1;
  sourceRecordingId: string;
  durationMs: number;
  teachingPackId: string;
  catalogVersion: string;
  selectedAssetIds: string[];
  sourceTracks: TeachingCompositionSourceTrack[];
  operations: TeachingCompositionOperation[];
}

export type TeachingRenderCapabilities = Readonly<Record<TeachingAssetKind, boolean>>;

export interface TeachingCompositionInput {
  catalog: TeachingAssetCatalogV1;
  selection: TeachingCatalogSelectionV1;
  selectedAssetIds: ReadonlyArray<string>;
  selectedCategories: ReadonlyArray<TeachingAssetKind>;
  sourceRecordingId: string;
  durationMs: number;
  sourceTracks: ReadonlyArray<TeachingCompositionSourceTrack>;
  events: ReadonlyArray<TeachingRecordingEvent>;
  contentUpdates: Readonly<Record<string, Record<string, unknown>>>;
}

export type TeachingCompositionCompileResult =
  | { status: 'ready'; plan: TeachingCompositionPlanV1 }
  | {
    status: 'unsupported-capability';
    unsupported: Array<{
      assetId: string;
      kind: TeachingAssetKind;
      capability: TeachingCompositionOperationKind;
    }>;
  };

export interface TeachingCompositionAdapter<Project> {
  /** These must describe real render/mix support, not merely timeline metadata support. */
  capabilities: TeachingRenderCapabilities;
  /** Must return a detached copy. The original project is never passed to mutation hooks. */
  cloneProject: (project: Project) => Project;
  applyOperation: (projectCopy: Project, operation: TeachingCompositionOperation) => void;
  validateProject: (projectCopy: Project, plan: TeachingCompositionPlanV1) => void;
}

export type TeachingCompositionExecutionResult<Project> =
  | {
    status: 'applied';
    project: Project;
    plan: TeachingCompositionPlanV1;
    manualEditRequired: false;
  }
  | Extract<TeachingCompositionCompileResult, { status: 'unsupported-capability' }>
  | { status: 'failed'; code: 'teaching_composition_apply_failed' };

const CAPABILITY_BY_KIND: Record<TeachingAssetKind, TeachingCompositionOperationKind> = {
  'motion-graphic': 'place-motion-graphic',
  chart: 'render-chart',
  'sound-effect': 'mix-sound-effect',
};

const TRACK_BY_KIND: Record<TeachingAssetKind, TeachingCompositionTrack> = {
  'motion-graphic': 'motion-graphics',
  chart: 'chart',
  'sound-effect': 'sound-effect',
};

const Z_ORDER_BY_KIND: Record<TeachingAssetKind, number> = {
  'motion-graphic': 30,
  chart: 20,
  'sound-effect': 0,
};

const LOCAL_URI_PATTERN = /^(?:file:\/\/\/|excalicast-asset:\/\/)[\S]+$/;

function fail(code: string): never {
  throw new Error(code);
}

function sameOrderedValues(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortedUnique<T extends string>(values: ReadonlyArray<T>, errorCode: string): T[] {
  const unique = new Set(values);
  if (unique.size !== values.length) fail(errorCode);
  return [...unique].sort();
}

function assertSourceTracks(tracks: ReadonlyArray<TeachingCompositionSourceTrack>): TeachingCompositionSourceTrack[] {
  const allowed: ReadonlyArray<TeachingSourceTrackKind> = ['screen', 'camera', 'microphone', 'system-audio'];
  const ids = new Set<string>();
  return tracks.map((track) => {
    if (!track || !track.trackId || !allowed.includes(track.kind) || ids.has(track.trackId)) {
      fail('teaching_composition_source_tracks_invalid');
    }
    ids.add(track.trackId);
    return { trackId: track.trackId, kind: track.kind };
  });
}

function assertEvents(
  events: ReadonlyArray<TeachingRecordingEvent>,
  durationMs: number,
): TeachingRecordingEvent[] {
  if (events.length > MAX_TEACHING_COMPOSITION_OPERATIONS) {
    fail('teaching_composition_operation_limit');
  }
  const kinds = new Set(['chapter-start', 'data-point', 'emphasis']);
  const ids = new Set<string>();
  return events.map((event) => {
    if (!event
      || !event.id
      || ids.has(event.id)
      || !kinds.has(event.kind)
      || !Number.isFinite(event.atMs)
      || event.atMs < 0
      || event.atMs >= durationMs
      || (event.holdMs !== undefined && (!Number.isFinite(event.holdMs) || event.holdMs <= 0))) {
      fail('teaching_composition_event_invalid');
    }
    ids.add(event.id);
    return { ...event };
  });
}

function sameOptionalChecksum(left?: string, right?: string): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.toLowerCase() === right.toLowerCase();
}

function sameAssetSnapshot(
  selected: TeachingAssetCatalogEntry,
  authoritative: TeachingAssetCatalogEntry,
): boolean {
  return selected.assetId === authoritative.assetId
    && selected.catalogVersion === authoritative.catalogVersion
    && selected.assetVersion === authoritative.assetVersion
    && selected.kind === authoritative.kind
    && selected.source.provider === authoritative.source.provider
    && selected.source.uri === authoritative.source.uri
    && selected.license.licenseId === authoritative.license.licenseId
    && selected.license.status === authoritative.license.status
    && selected.checksum.algorithm === authoritative.checksum.algorithm
    && selected.checksum.value.toLowerCase() === authoritative.checksum.value.toLowerCase()
    && selected.cache.status === authoritative.cache.status
    && sameOptionalChecksum(selected.cache.checksum, authoritative.cache.checksum)
    && selected.cache.localUri === authoritative.cache.localUri
    && selected.durationMs === authoritative.durationMs
    && selected.contentSlots.length === authoritative.contentSlots.length
    && selected.contentSlots.every((slot, index) => (
      slot.slotId === authoritative.contentSlots[index].slotId
      && slot.type === authoritative.contentSlots[index].type
    ));
}

function validateSelection(params: TeachingCompositionInput): {
  catalog: TeachingAssetCatalogV1;
  assetsById: Map<string, TeachingAssetCatalogEntry>;
  authoritativeSelection: TeachingCatalogSelectionV1;
} {
  if (params.catalog.schemaVersion !== 1
    || params.selection.schemaVersion !== 1
    || !params.selection.teachingPackId) {
    fail('teaching_composition_catalog_or_selection_invalid');
  }
  const catalog = createTeachingAssetCatalog({
    catalogVersion: params.catalog.catalogVersion,
    entries: params.catalog.entries,
  });
  if (params.selection.catalogVersion !== catalog.catalogVersion) {
    fail('teaching_composition_catalog_version_mismatch');
  }

  const explicitIds = [...params.selectedAssetIds];
  if (sortedUnique(explicitIds, 'teaching_composition_selection_mismatch').length !== explicitIds.length
    || !sameOrderedValues(explicitIds, params.selection.assets.map((asset) => asset.assetId))) {
    fail('teaching_composition_selection_mismatch');
  }
  const categories = sortedUnique(params.selectedCategories, 'teaching_composition_category_selection_invalid');
  const selectedKinds = [...new Set(params.selection.assets.map((asset) => asset.kind))].sort();
  if (!sameOrderedValues(categories, selectedKinds)) {
    fail('teaching_composition_category_selection_invalid');
  }

  const catalogById = new Map(catalog.entries.map((entry) => [entry.assetId, entry]));
  const assetsById = new Map<string, TeachingAssetCatalogEntry>();
  for (const selected of params.selection.assets) {
    const authoritative = catalogById.get(selected.assetId);
    if (!authoritative) fail('teaching_composition_asset_not_in_catalog');
    if (authoritative.license.status !== 'valid') {
      fail('teaching_composition_license_invalid');
    }
    if (authoritative.cache.status !== 'verified'
      || authoritative.cache.checksum?.toLowerCase() !== authoritative.checksum.value.toLowerCase()) {
      fail('teaching_composition_cache_unverified');
    }
    if (!authoritative.cache.localUri || !LOCAL_URI_PATTERN.test(authoritative.cache.localUri)) {
      fail('teaching_composition_local_asset_missing');
    }
    if (!sameAssetSnapshot(selected, authoritative)) {
      fail('teaching_composition_asset_snapshot_mismatch');
    }
    assetsById.set(authoritative.assetId, authoritative);
  }

  for (const assetId of Object.keys(params.contentUpdates)) {
    if (!assetsById.has(assetId)) fail('teaching_composition_content_asset_unselected');
  }
  const authoritativeSelection: TeachingCatalogSelectionV1 = {
    schemaVersion: 1,
    teachingPackId: params.selection.teachingPackId,
    catalogVersion: catalog.catalogVersion,
    assets: params.selectedAssetIds.map((assetId) => {
      const asset = assetsById.get(assetId);
      if (!asset) fail('teaching_composition_asset_not_in_catalog');
      return asset;
    }),
  };
  return { catalog, assetsById, authoritativeSelection };
}

function immutableReference(asset: TeachingAssetCatalogEntry): ImmutableTeachingAssetReference {
  return {
    assetId: asset.assetId,
    kind: asset.kind,
    catalogVersion: asset.catalogVersion,
    assetVersion: asset.assetVersion,
    checksumAlgorithm: 'sha256',
    checksum: asset.checksum.value.toLowerCase(),
    localUri: asset.cache.localUri as string,
  };
}

function transitionFor(durationMs: number, kind: TeachingAssetKind): TeachingCompositionOperation['transition'] {
  if (kind === 'sound-effect') return { enterMs: 0, exitMs: 0, easing: 'easeInOutCubic' };
  return {
    enterMs: Math.min(250, Math.floor(durationMs / 3)),
    exitMs: Math.min(200, Math.floor(durationMs / 3)),
    easing: 'easeInOutCubic',
  };
}

function cloneContent(
  materialized: MaterializedTeachingAssetContentV1,
): TeachingCompositionContentSubstitution[] {
  return materialized.content.map((entry) => structuredClone(entry));
}

function audioMetadata(
  kind: TeachingAssetKind,
  sourceTracks: TeachingCompositionSourceTrack[],
): TeachingCompositionOperation['audio'] {
  if (kind !== 'sound-effect') return undefined;
  return {
    gainDb: -10,
    gainCeilingDb: -6,
    ducking: {
      targetSourceTracks: sourceTracks
        .filter((track) => track.kind === 'microphone' || track.kind === 'system-audio')
        .map((track) => track.trackId),
      attenuationDb: -4,
      attackMs: 30,
      releaseMs: 180,
    },
    mixesAsIndependentEffect: true,
  };
}

function assertNoTrackOverlap(operations: TeachingCompositionOperation[]): void {
  const byTrack = new Map<TeachingCompositionTrack, TeachingCompositionOperation[]>();
  for (const operation of operations) {
    const track = byTrack.get(operation.track) ?? [];
    track.push(operation);
    byTrack.set(operation.track, track);
  }
  for (const track of byTrack.values()) {
    track.sort((a, b) => a.startMs - b.startMs || a.operationId.localeCompare(b.operationId));
    for (let index = 1; index < track.length; index += 1) {
      if (track[index].startMs < track[index - 1].endMs) {
        fail('teaching_composition_track_overlap');
      }
    }
  }
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * Converts an explicit, offline-ready ChatCut selection into concrete local
 * render/mix operations. It performs no network, upload, transcription or ASR.
 */
export function compileTeachingComposition(
  params: TeachingCompositionInput & { renderCapabilities: TeachingRenderCapabilities },
): TeachingCompositionCompileResult {
  if (!params.sourceRecordingId || !Number.isFinite(params.durationMs) || params.durationMs <= 0) {
    fail('teaching_composition_identity_invalid');
  }
  const sourceTracks = assertSourceTracks(params.sourceTracks);
  const events = assertEvents(params.events, params.durationMs);
  const { catalog, assetsById, authoritativeSelection } = validateSelection(params);

  const recipe = buildTeachingTrackPlan({
    sourceRecordingId: params.sourceRecordingId,
    durationMs: params.durationMs,
    selection: authoritativeSelection,
    events,
  });
  if (recipe.placements.length > MAX_TEACHING_COMPOSITION_OPERATIONS) {
    fail('teaching_composition_operation_limit');
  }

  const unsupported = authoritativeSelection.assets
    .filter((asset) => !params.renderCapabilities[asset.kind])
    .map((asset) => ({
      assetId: asset.assetId,
      kind: asset.kind,
      capability: CAPABILITY_BY_KIND[asset.kind],
    }));
  if (unsupported.length > 0) return { status: 'unsupported-capability', unsupported };

  const materialized = new Map<string, MaterializedTeachingAssetContentV1>();
  for (const asset of authoritativeSelection.assets) {
    materialized.set(asset.assetId, materializeTeachingAssetContent({
      selection: authoritativeSelection,
      assetId: asset.assetId,
      replacements: params.contentUpdates[asset.assetId] ?? {},
    }));
  }

  const operations = recipe.placements.map((placement, index): TeachingCompositionOperation => {
    const asset = assetsById.get(placement.assetId);
    const content = materialized.get(placement.assetId);
    if (!asset || !content || TRACK_BY_KIND[asset.kind] !== placement.track) {
      fail('teaching_composition_placement_invalid');
    }
    const startMs = Math.max(0, Math.min(params.durationMs, placement.startMs));
    const clampedPlacementEndMs = Math.max(startMs, Math.min(params.durationMs, placement.endMs));
    const endMs = asset.kind === 'sound-effect'
      ? Math.min(clampedPlacementEndMs, startMs + asset.durationMs)
      : clampedPlacementEndMs;
    if (endMs <= startMs) fail('teaching_composition_placement_invalid');
    const timelineDurationMs = endMs - startMs;
    const operation: TeachingCompositionOperation = {
      operationId: `teaching:${placement.track}:${String(index).padStart(4, '0')}:${asset.assetId}`,
      operation: CAPABILITY_BY_KIND[asset.kind],
      track: TRACK_BY_KIND[asset.kind],
      asset: immutableReference(asset),
      startMs,
      endMs,
      trim: {
        sourceStartMs: 0,
        sourceEndMs: Math.min(asset.durationMs, timelineDurationMs),
        playbackMode: asset.kind === 'sound-effect' ? 'once' : 'hold-last-frame',
      },
      zOrder: Z_ORDER_BY_KIND[asset.kind],
      transition: transitionFor(timelineDurationMs, asset.kind),
      content: cloneContent(content),
    };
    const audio = audioMetadata(asset.kind, sourceTracks);
    if (audio) operation.audio = audio;
    return operation;
  });
  assertNoTrackOverlap(operations);

  const plan: TeachingCompositionPlanV1 = {
    schemaVersion: 1,
    sourceRecordingId: params.sourceRecordingId,
    durationMs: params.durationMs,
    teachingPackId: authoritativeSelection.teachingPackId,
    catalogVersion: catalog.catalogVersion,
    selectedAssetIds: [...params.selectedAssetIds],
    sourceTracks,
    operations,
  };
  if (serializedBytes(plan) > MAX_TEACHING_COMPOSITION_BYTES) {
    fail('teaching_composition_byte_limit');
  }
  return { status: 'ready', plan: deepFreeze(structuredClone(plan)) };
}

/** Applies a compiled plan to a detached project copy or returns no project at all. */
export function executeTeachingCompositionAtomically<Project>(params: {
  project: Project;
  adapter: TeachingCompositionAdapter<Project>;
  input: TeachingCompositionInput;
}): TeachingCompositionExecutionResult<Project> {
  const compiled = compileTeachingComposition({
    ...params.input,
    renderCapabilities: params.adapter.capabilities,
  });
  if (compiled.status !== 'ready') return compiled;

  try {
    const projectCopy = params.adapter.cloneProject(params.project);
    if (projectCopy === params.project) throw new Error('teaching_composition_copy_not_detached');
    for (const operation of compiled.plan.operations) {
      params.adapter.applyOperation(projectCopy, operation);
    }
    params.adapter.validateProject(projectCopy, compiled.plan);
    return {
      status: 'applied',
      project: projectCopy,
      plan: compiled.plan,
      manualEditRequired: false,
    };
  } catch {
    return { status: 'failed', code: 'teaching_composition_apply_failed' };
  }
}
