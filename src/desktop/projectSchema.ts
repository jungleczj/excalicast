export type NativeTrackKind =
  | 'screen'
  | 'camera'
  | 'microphone'
  | 'system-audio'
  | 'excalidraw-events'
  | 'input-telemetry';

export interface NativeMediaSegment {
  index: number;
  relativePath: string;
  startUs: number;
  durationUs: number;
  byteLength: number;
  finalized: boolean;
}

export interface NativeRecordingTrack {
  id: string;
  kind: NativeTrackKind;
  segments: NativeMediaSegment[];
}

export interface RecordingManifestV1 {
  schemaVersion: 1;
  recordingId: string;
  projectRoot: string;
  state: 'preparing' | 'recording' | 'finalizing' | 'ready' | 'interrupted' | 'error';
  tracks: NativeRecordingTrack[];
  qualityAdjustments: Array<{ atUs: number; reason: string; from: string; to: string }>;
}

const TRACK_KINDS: readonly NativeTrackKind[] = [
  'screen',
  'camera',
  'microphone',
  'system-audio',
  'excalidraw-events',
  'input-telemetry',
];

export function createRecordingManifest(recordingId: string, projectRoot: string): RecordingManifestV1 {
  if (!recordingId || !projectRoot) throw new Error('recording_manifest_identity_required');
  return {
    schemaVersion: 1,
    recordingId,
    projectRoot,
    state: 'preparing',
    tracks: TRACK_KINDS.map((kind) => ({ id: `${recordingId}:${kind}`, kind, segments: [] })),
    qualityAdjustments: [],
  };
}

export type TeachingRecipeTrack =
  | 'camera-direction'
  | 'captions'
  | 'chart'
  | 'motion-graphics'
  | 'sound-effect'
  | 'music'
  | 'transition';

export interface TeachingRecipePlacement {
  assetId: string;
  track: TeachingRecipeTrack;
  startMs: number;
  endMs: number;
}

export interface TeachingEditRecipeV1 {
  schemaVersion: 1;
  sourceRecordingId: string;
  teachingPackId: string;
  curatedAssetIds: string[];
  placements: TeachingRecipePlacement[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseTeachingEditRecipe(value: unknown): TeachingEditRecipeV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('recipe_schema_unsupported');
  if (typeof value.sourceRecordingId !== 'string' || typeof value.teachingPackId !== 'string') {
    throw new Error('recipe_identity_required');
  }
  if (!Array.isArray(value.curatedAssetIds) || !value.curatedAssetIds.every((id) => typeof id === 'string')) {
    throw new Error('recipe_curated_assets_invalid');
  }
  if (!Array.isArray(value.placements)) throw new Error('recipe_placements_invalid');

  const curated = new Set(value.curatedAssetIds);
  const placements = value.placements.map((placement) => {
    if (!isRecord(placement)
      || typeof placement.assetId !== 'string'
      || typeof placement.track !== 'string'
      || typeof placement.startMs !== 'number'
      || typeof placement.endMs !== 'number'
      || placement.startMs < 0
      || placement.endMs <= placement.startMs) {
      throw new Error('recipe_placement_invalid');
    }
    if (!curated.has(placement.assetId)) throw new Error('recipe_asset_not_curated');
    return placement as unknown as TeachingRecipePlacement;
  });

  return {
    schemaVersion: 1,
    sourceRecordingId: value.sourceRecordingId,
    teachingPackId: value.teachingPackId,
    curatedAssetIds: [...value.curatedAssetIds],
    placements,
  };
}

export interface TeleprompterDesktopSession {
  schemaVersion: 1;
  mode: 'smart-readalong' | 'constant-speed';
  dock: 'notch' | 'menu-bar-center' | 'floating';
  microphoneSource: 'recording-session-pcm';
  fallback: 'constant-speed';
  excludeFromCapture: true;
}
