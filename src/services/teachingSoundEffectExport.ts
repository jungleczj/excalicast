'use client';

import type {
  TeachingAssetKind,
} from '@/desktop/teachingRecipePlanner';
import type {
  TeachingCompositionOperation,
  TeachingCompositionOperationKind,
  TeachingRenderCapabilities,
} from '@/desktop/teachingCompositionExecutor';
import {
  assembleRawCanonicalExportAudio,
  createRawSilentExportAudio,
  TEACHING_SFX_RAW_CANONICAL_FALLBACK_LIMITS,
  encodeFloat32Wav,
  EXPORT_AUDIO_SAMPLE_RATE,
  type PreparedExportAudio,
  type RawCanonicalExportAudio,
} from '@/services/exportAudio';
import {
  mixTeachingSoundEffects,
  type TeachingSoundEffectAssetProvider,
  type TeachingSoundEffectCue,
  type TeachingSoundEffectMixLimits,
  type TeachingSoundEffectMixResult,
} from '@/services/teachingSoundEffectMixer';

/** Internal injected bounded fallback only; this is not product/60-minute readiness. */
export const TEACHING_AUDIO_EXPORT_CAPABILITIES: TeachingRenderCapabilities = Object.freeze({
  'motion-graphic': false,
  chart: false,
  'sound-effect': true,
});

export interface TeachingBaseExportAudioTrack {
  readonly trackId: string;
  readonly kind: 'microphone' | 'system-audio';
  readonly audio: RawCanonicalExportAudio;
}

export type TeachingSoundEffectExportResult =
  | {
    status: 'ready';
    audio: PreparedExportAudio;
    mixDiagnostics: TeachingSoundEffectMixResult['diagnostics'];
  }
  | {
    status: 'unsupported-capability';
    unsupported: Array<{
      operationId: string;
      kind: Exclude<TeachingAssetKind, 'sound-effect'>;
      capability: Exclude<TeachingCompositionOperationKind, 'mix-sound-effect'>;
    }>;
  };

const VISUAL_CAPABILITY = {
  'place-motion-graphic': { kind: 'motion-graphic', capability: 'place-motion-graphic' },
  'render-chart': { kind: 'chart', capability: 'render-chart' },
} as const;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Teaching sound-effect export cancelled', 'AbortError');
}

function fail(code: string): never {
  throw new Error(code);
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateBaseTracks(tracks: readonly TeachingBaseExportAudioTrack[], allowEmpty: boolean): string[] {
  if ((!allowEmpty && tracks.length === 0) || tracks.length > 2) fail('teaching_sfx_export_base_tracks_invalid');
  const ids = new Set<string>();
  const kinds = new Set<TeachingBaseExportAudioTrack['kind']>();
  for (const track of tracks) {
    if (!track.trackId.trim()
      || (track.kind !== 'microphone' && track.kind !== 'system-audio')
      || ids.has(track.trackId) || kinds.has(track.kind)
      || track.audio.diagnostics.normalizationPasses !== 0) {
      fail('teaching_sfx_export_base_tracks_invalid');
    }
    ids.add(track.trackId);
    kinds.add(track.kind);
  }
  return [...ids].sort();
}

function assertSoundEffectOperationShape(
  candidate: unknown,
): asserts candidate is TeachingCompositionOperation {
  if (!isRecord(candidate)
    || typeof candidate.operationId !== 'string'
    || !candidate.operationId.trim()
    || candidate.operation !== 'mix-sound-effect'
    || candidate.track !== 'sound-effect'
    || !isRecord(candidate.asset)
    || candidate.asset.kind !== 'sound-effect'
    || typeof candidate.asset.assetId !== 'string'
    || !candidate.asset.assetId.trim()
    || typeof candidate.asset.catalogVersion !== 'string'
    || !candidate.asset.catalogVersion.trim()
    || typeof candidate.asset.assetVersion !== 'string'
    || !candidate.asset.assetVersion.trim()
    || candidate.asset.checksumAlgorithm !== 'sha256'
    || typeof candidate.asset.checksum !== 'string'
    || typeof candidate.asset.localUri !== 'string'
    || typeof candidate.startMs !== 'number'
    || typeof candidate.endMs !== 'number'
    || !finite(candidate.startMs)
    || !finite(candidate.endMs)
    || candidate.startMs < 0
    || candidate.endMs <= candidate.startMs
    || !isRecord(candidate.trim)
    || candidate.trim.sourceStartMs !== 0
    || typeof candidate.trim.sourceEndMs !== 'number'
    || !finite(candidate.trim.sourceEndMs)
    || Math.abs(candidate.trim.sourceEndMs - (candidate.endMs - candidate.startMs)) > 1e-7
    || candidate.trim.playbackMode !== 'once'
    || candidate.zOrder !== 0
    || !isRecord(candidate.transition)
    || candidate.transition.easing !== 'easeInOutCubic'
    || typeof candidate.transition.enterMs !== 'number'
    || typeof candidate.transition.exitMs !== 'number'
    || !finite(candidate.transition.enterMs)
    || !finite(candidate.transition.exitMs)
    || candidate.transition.enterMs !== 0
    || candidate.transition.exitMs !== 0
    || !Array.isArray(candidate.content)
    || candidate.content.length !== 0
    || !isRecord(candidate.audio)
    || candidate.audio.mixesAsIndependentEffect !== true
    || typeof candidate.audio.gainDb !== 'number'
    || typeof candidate.audio.gainCeilingDb !== 'number'
    || !finite(candidate.audio.gainDb)
    || !finite(candidate.audio.gainCeilingDb)
    || !isRecord(candidate.audio.ducking)
    || !Array.isArray(candidate.audio.ducking.targetSourceTracks)
    || candidate.audio.ducking.targetSourceTracks.some((trackId) => typeof trackId !== 'string')
    || typeof candidate.audio.ducking.attenuationDb !== 'number'
    || typeof candidate.audio.ducking.attackMs !== 'number'
    || typeof candidate.audio.ducking.releaseMs !== 'number'
    || !finite(candidate.audio.ducking.attenuationDb)
    || !finite(candidate.audio.ducking.attackMs)
    || !finite(candidate.audio.ducking.releaseMs)) {
    fail('teaching_sfx_export_operation_invalid');
  }
}

function cueFromOperation(
  operation: TeachingCompositionOperation,
  baseTrackIds: readonly string[],
  baseDurationMs: number,
): TeachingSoundEffectCue {
  assertSoundEffectOperationShape(operation);
  if (operation.endMs > baseDurationMs + 1e-7) fail('teaching_sfx_export_operation_invalid');
  const targetIds = [...operation.audio!.ducking.targetSourceTracks];
  if (new Set(targetIds).size !== targetIds.length
    || targetIds.sort().join('\u0000') !== baseTrackIds.join('\u0000')) {
    fail('teaching_sfx_export_duck_targets_invalid');
  }
  return {
    cueId: operation.operationId,
    asset: {
      assetId: operation.asset.assetId,
      assetVersion: operation.asset.assetVersion,
      checksum: operation.asset.checksum,
      localUri: operation.asset.localUri,
    },
    startMs: operation.startMs,
    endMs: operation.endMs,
    gainDb: operation.audio!.gainDb,
    gainCeilingDb: operation.audio!.gainCeilingDb,
    fadeInMs: operation.transition.enterMs,
    fadeOutMs: operation.transition.exitMs,
    ducking: {
      attenuationDb: operation.audio!.ducking.attenuationDb,
      attackMs: operation.audio!.ducking.attackMs,
      releaseMs: operation.audio!.ducking.releaseMs,
    },
  };
}

export function createEncoderCompatibleTeachingAudio(
  raw: RawCanonicalExportAudio,
  mixed: TeachingSoundEffectMixResult,
): PreparedExportAudio {
  if (mixed.sampleRate !== EXPORT_AUDIO_SAMPLE_RATE || mixed.channelCount !== 1
    || mixed.channels.length !== 1 || mixed.channels[0].length !== raw.totalFrames) {
    fail('teaching_sfx_export_output_invalid');
  }
  // mixTeachingSoundEffects returns a newly allocated, exclusively owned output.
  const samples = mixed.channels[0];
  let cachedWav: Blob | null = null;
  return {
    samples,
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    channels: 1,
    totalFrames: samples.length,
    durationMs: samples.length / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    diagnostics: {
      sourceFrames: raw.diagnostics.sourceFrames,
      outputFrames: samples.length,
      nonFiniteSamples: 0,
      clippedSamples: 0,
      peak: mixed.diagnostics.peak,
      originalPeak: mixed.diagnostics.originalPeak,
      appliedGainDb: mixed.diagnostics.appliedGainDb,
      normalizationPasses: 1,
    },
    getWavBlob: () => {
      cachedWav ??= encodeFloat32Wav(samples, EXPORT_AUDIO_SAMPLE_RATE);
      return cachedWav;
    },
    sourceKind: raw.sourceKind,
    sourceTrackId: raw.sourceTrackId,
  };
}

/**
 * The supported teaching export boundary: raw mic/system assembly, then one SFX
 * mix whose final pass owns all anti-clipping normalization. Visual operations
 * fail closed as unsupported and are never represented as rendered output.
 */
export async function prepareTeachingSoundEffectExportAudio(input: {
  baseTracks: readonly TeachingBaseExportAudioTrack[];
  baseDurationMs?: number;
  operations: readonly TeachingCompositionOperation[];
  assetProvider: TeachingSoundEffectAssetProvider;
  limits?: Partial<TeachingSoundEffectMixLimits>;
  signal?: AbortSignal;
}): Promise<TeachingSoundEffectExportResult> {
  throwIfAborted(input.signal);
  if (!Array.isArray(input.operations)) fail('teaching_sfx_export_operation_invalid');
  const unsupported = (input.operations as readonly unknown[]).flatMap((candidate) => {
    if (!isRecord(candidate)
      || typeof candidate.operationId !== 'string'
      || !candidate.operationId.trim()
      || typeof candidate.operation !== 'string') {
      fail('teaching_sfx_export_operation_invalid');
    }
    if (candidate.operation === 'mix-sound-effect') {
      assertSoundEffectOperationShape(candidate);
      return [];
    }
    if (candidate.operation !== 'place-motion-graphic' && candidate.operation !== 'render-chart') {
      fail('teaching_sfx_export_operation_invalid');
    }
    const visual = VISUAL_CAPABILITY[candidate.operation];
    return [{ operationId: candidate.operationId, ...visual }];
  });
  if (unsupported.length > 0) return { status: 'unsupported-capability', unsupported };

  const hasBaseTracks = input.baseTracks.length > 0;
  const baseTrackIds = validateBaseTracks(input.baseTracks, !hasBaseTracks);
  if (!hasBaseTracks && (!finite(input.baseDurationMs ?? Number.NaN) || (input.baseDurationMs ?? 0) <= 0)) {
    fail('teaching_sfx_export_base_duration_invalid');
  }
  const operationIds = new Set<string>();
  for (const operation of input.operations) {
    if (operationIds.has(operation.operationId)) fail('teaching_sfx_export_duplicate_operation_id');
    operationIds.add(operation.operationId);
    assertSoundEffectOperationShape(operation);
  }
  const rawLimits = {
    maxFrames: Math.min(
      TEACHING_SFX_RAW_CANONICAL_FALLBACK_LIMITS.maxFrames,
      input.limits?.maxTotalSamples ?? Number.POSITIVE_INFINITY,
    ),
    maxBytes: Math.min(
      TEACHING_SFX_RAW_CANONICAL_FALLBACK_LIMITS.maxBytes,
      input.limits?.maxOutputBytes ?? Number.POSITIVE_INFINITY,
    ),
  };
  const raw = hasBaseTracks
    ? assembleRawCanonicalExportAudio(
      input.baseTracks.map((track) => track.audio),
      input.signal,
      rawLimits,
    )
    : createRawSilentExportAudio(input.baseDurationMs as number, rawLimits);
  const cues = input.operations.map((operation) => cueFromOperation(
    operation,
    baseTrackIds,
    raw.durationMs,
  ));
  const mixed = await mixTeachingSoundEffects({
    base: {
      sampleRate: raw.sampleRate,
      channelCount: raw.channels,
      durationMs: raw.durationMs,
      channels: [raw.samples],
    },
    cues,
    assetProvider: input.assetProvider,
    limits: input.limits,
    signal: input.signal,
  });
  throwIfAborted(input.signal);
  return {
    status: 'ready',
    audio: createEncoderCompatibleTeachingAudio(raw, mixed),
    mixDiagnostics: mixed.diagnostics,
  };
}
