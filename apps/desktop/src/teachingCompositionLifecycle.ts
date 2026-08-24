import path from 'node:path';

import { compileTeachingComposition } from '../../../src/desktop/teachingCompositionExecutor';
import {
  deriveNativeDirectorDuration,
  type NativeDirectorDurationEvidence,
} from './directorJobService';
import { loadNativeTeachingRecordingEvents } from './nativeDirectorPipeline';
import type {
  NativeRecordingManifest,
  NativeRecordingValidationReport,
} from './nativeHelperClient';
import { writeReadyTeachingCompositionManifest } from './teachingCompositionManifest';
import { readDesktopTeachingPreselection } from './teachingPreselectionManifest';

export type DesktopTeachingCompositionFinalizeResult =
  | { state: 'ready'; operationCount: number; duration: NativeDirectorDurationEvidence }
  | { state: 'unsupported'; code: string }
  | { state: 'absent' };

function sourceTracks(manifest: NativeRecordingManifest) {
  return [
    { trackId: 'screen', kind: 'screen' as const },
    ...(manifest.tracks.camera.length ? [{ trackId: 'camera', kind: 'camera' as const }] : []),
    ...(manifest.tracks.microphone.length ? [{ trackId: 'microphone', kind: 'microphone' as const }] : []),
    ...(manifest.tracks['system-audio'].length ? [{ trackId: 'system-audio', kind: 'system-audio' as const }] : []),
  ];
}

/**
 * Main-only post-stop transaction. It compiles exclusively from the immutable
 * pre-capture selection and durable native telemetry; no renderer asset path,
 * default catalog or invented timing enters this path.
 */
export async function finalizeDesktopTeachingComposition(input: {
  projectRoot: string;
  cacheRoot: string;
  recordingId: string;
  manifest: NativeRecordingManifest;
  validation: NativeRecordingValidationReport;
  signal?: AbortSignal;
}): Promise<DesktopTeachingCompositionFinalizeResult> {
  if (input.signal?.aborted) throw new Error('teaching_composition_cancelled');
  const preselection = await readDesktopTeachingPreselection({
    projectRoot: input.projectRoot,
    recordingId: input.recordingId,
  });
  if (!preselection) return { state: 'absent' };
  if (preselection.state !== 'ready') return { state: 'unsupported', code: preselection.code };
  const duration = deriveNativeDirectorDuration(input.manifest, input.validation);
  if (!duration) return { state: 'unsupported', code: 'teaching_composition_duration_unavailable' };
  const events = await loadNativeTeachingRecordingEvents({
    projectRoot: input.projectRoot,
    recordingId: input.recordingId,
    durationUs: duration.durationUs,
    signal: input.signal,
  });
  if (input.signal?.aborted) throw new Error('teaching_composition_cancelled');
  const result = compileTeachingComposition({
    catalog: preselection.catalog,
    selection: preselection.selection,
    selectedAssetIds: preselection.selection.assets.map((asset) => asset.assetId),
    selectedCategories: [...new Set(preselection.selection.assets.map((asset) => asset.kind))],
    sourceRecordingId: input.recordingId,
    durationMs: duration.durationUs / 1_000,
    sourceTracks: sourceTracks(input.manifest),
    events,
    contentUpdates: {},
    // Visual operations are deliberately fail-closed until native compositor
    // support is connected. SFX has a real decoded/mixed export path.
    renderCapabilities: { 'motion-graphic': false, chart: false, 'sound-effect': true },
  });
  if (result.status !== 'ready') return { state: 'unsupported', code: 'teaching_composition_unsupported_capability' };
  await writeReadyTeachingCompositionManifest({
    projectRoot: input.projectRoot,
    cacheRoot: path.resolve(input.cacheRoot),
    recordingId: input.recordingId,
    catalog: preselection.catalog,
    selection: preselection.selection,
    plan: result.plan,
    signal: input.signal,
  });
  return { state: 'ready', operationCount: result.plan.operations.length, duration };
}
