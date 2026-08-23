import type {
  NativeProjectSegmentReference,
  NativeRecordingProjectReference,
  RecordingMetadata,
  RecordingSetupConfig,
} from '@/types/recording';

interface CreateNativeRecordingMetadataInput {
  recordingId: string;
  startedAt: number;
  ownerKey: string;
  setup: RecordingSetupConfig;
}

interface FinalizeNativeRecordingMetadataInput {
  manifest: unknown;
  validation: unknown;
  durationMs: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function captureState(value: unknown): NativeRecordingProjectReference['captureState'] {
  if (value === 'ready' || value === 'interrupted' || value === 'error' || value === 'recording') return value;
  return 'error';
}

function segment(value: unknown): NativeProjectSegmentReference | null {
  if (!isObject(value)
    || !Number.isSafeInteger(value.index)
    || typeof value.relativePath !== 'string'
    || typeof value.startUs !== 'number'
    || typeof value.durationUs !== 'number'
    || typeof value.byteLength !== 'number') return null;
  return {
    index: value.index as number,
    relativePath: value.relativePath,
    startUs: value.startUs,
    durationUs: value.durationUs,
    byteLength: value.byteLength,
  };
}

function manifestTracks(manifest: unknown): Record<string, NativeProjectSegmentReference[]> | undefined {
  if (!isObject(manifest) || !isObject(manifest.tracks)) return undefined;
  const tracks: Record<string, NativeProjectSegmentReference[]> = {};
  for (const [track, values] of Object.entries(manifest.tracks)) {
    if (!Array.isArray(values)) continue;
    tracks[track] = values.map(segment).filter((value): value is NativeProjectSegmentReference => value !== null);
  }
  return tracks;
}

export function createNativeRecordingMetadata(
  input: CreateNativeRecordingMetadataInput,
): RecordingMetadata {
  const source = input.setup.source ?? { kind: 'whiteboard' as const };
  return {
    id: input.recordingId,
    startedAt: input.startedAt,
    durationMs: 0,
    hasAudio: true,
    hasSystemAudio: source.captureSystemAudio === true,
    hasCamera: input.setup.camera.enabled,
    status: 'recording',
    ownerKey: input.ownerKey,
    setup: input.setup,
    source,
    mediaChunkIntervalMs: 2_000,
    ...(input.setup.teachingRecipe?.enabled ? { teachingRecipeStatus: 'pending' as const } : {}),
    nativeProject: {
      schemaVersion: 1,
      storage: 'macos-videos',
      recordingId: input.recordingId,
      captureState: 'recording',
      exportStatus: 'adapter-required',
    },
  };
}

export function finalizeNativeRecordingMetadata(
  recording: RecordingMetadata,
  input: FinalizeNativeRecordingMetadataInput,
): RecordingMetadata {
  const manifest = isObject(input.manifest) ? input.manifest : {};
  const validation = isObject(input.validation) ? input.validation : {};
  const recoveredState = captureState(manifest.state);
  const validationState: NativeRecordingProjectReference['validationState'] = validation.isValid === true
    ? 'valid'
    : validation.isValid === false
      ? 'invalid'
      : 'unavailable';
  const warnings = new Set(recording.warnings ?? []);

  if (recoveredState !== 'ready') warnings.add('native_capture_interrupted');
  if (validationState === 'invalid') warnings.add('native_validation_failed');
  if (validationState === 'unavailable') warnings.add('native_validation_unavailable');

  const editorReady = recoveredState === 'ready' && validationState === 'valid';
  if (!editorReady) warnings.add('native_media_adapter_required');

  return {
    ...recording,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    status: editorReady ? 'done' : 'interrupted',
    warnings: warnings.size > 0 ? [...warnings] : undefined,
    nativeProject: {
      schemaVersion: 1,
      storage: 'macos-videos',
      recordingId: recording.id,
      captureState: recoveredState,
      validationState,
      exportStatus: editorReady ? 'ready' : 'adapter-required',
      tracks: manifestTracks(manifest),
    },
  };
}

export function failNativeRecordingMetadata(
  recording: RecordingMetadata,
  durationMs: number,
  warning: string,
): RecordingMetadata {
  return {
    ...recording,
    durationMs: Math.max(0, Math.round(durationMs)),
    status: 'interrupted',
    warnings: Array.from(new Set([...(recording.warnings ?? []), warning, 'native_media_adapter_required'])),
    nativeProject: recording.nativeProject
      ? {
          ...recording.nativeProject,
          captureState: 'interrupted',
          validationState: 'unavailable',
        }
      : undefined,
  };
}

export function nativeProjectRequiresExportAdapter(
  recording: RecordingMetadata,
  adapterAvailable = true,
): boolean {
  return Boolean(recording.nativeProject)
    && (!adapterAvailable || recording.nativeProject?.exportStatus === 'adapter-required');
}
