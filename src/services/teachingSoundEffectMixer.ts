'use client';

const FINAL_TARGET_PEAK = 10 ** (-1 / 20);

export interface TeachingSoundEffectAssetRef {
  readonly assetId: string;
  readonly assetVersion: string;
  readonly checksum: string;
  readonly localUri: string;
}

export interface DecodedTeachingSoundEffectChunk {
  readonly channels: readonly Float32Array[];
}

export interface DecodedTeachingSoundEffect {
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly totalFrames: number;
  readonly chunks: Iterable<DecodedTeachingSoundEffectChunk> | AsyncIterable<DecodedTeachingSoundEffectChunk>;
}

export interface TeachingSoundEffectAssetProvider {
  /** Implementations must resolve verified local assets only; the mixer never fetches media. */
  loadLocalPcm(
    asset: TeachingSoundEffectAssetRef,
    options: { signal?: AbortSignal },
  ): Promise<DecodedTeachingSoundEffect>;
}

export interface TeachingSoundEffectDucking {
  /** Negative attenuation applied to the already canonical base timeline. */
  readonly attenuationDb: number;
  readonly attackMs: number;
  readonly releaseMs: number;
}

export interface TeachingSoundEffectCue {
  readonly cueId: string;
  readonly asset: TeachingSoundEffectAssetRef;
  readonly startMs: number;
  readonly endMs: number;
  readonly gainDb: number;
  readonly gainCeilingDb: number;
  readonly fadeInMs: number;
  readonly fadeOutMs: number;
  readonly ducking?: TeachingSoundEffectDucking;
}

export interface TeachingPcmTimeline {
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly durationMs: number;
  readonly channels: readonly Float32Array[];
}

export interface TeachingSoundEffectMixLimits {
  readonly maxCues: number;
  readonly maxOutputBytes: number;
  readonly maxAssetBytes: number;
  readonly maxTotalAssetBytes: number;
  readonly maxTotalSamples: number;
  readonly maxCueGainDb: number;
}

export interface TeachingSoundEffectCueDiagnostics {
  cueId: string;
  assetId: string;
  placedFrames: number;
  trimmedHeadFrames: number;
  trimmedTailFrames: number;
  appliedGainDb: number;
}

export interface TeachingSoundEffectMixResult extends TeachingPcmTimeline {
  channels: Float32Array[];
  diagnostics: {
    cueCount: number;
    baseMixPasses: 1;
    normalizationPasses: 1;
    originalPeak: number;
    peak: number;
    finalGain: number;
    appliedGainDb: number;
    cues: TeachingSoundEffectCueDiagnostics[];
  };
}

const DEFAULT_LIMITS: TeachingSoundEffectMixLimits = {
  maxCues: 256,
  maxOutputBytes: 512 * 1024 * 1024,
  maxAssetBytes: 64 * 1024 * 1024,
  maxTotalAssetBytes: 256 * 1024 * 1024,
  // Combined scalar samples across the output timeline and unique decoded SFX.
  maxTotalSamples: 192 * 1024 * 1024,
  maxCueGainDb: 0,
};

interface MaterializedAsset {
  channels: Float32Array[];
  totalFrames: number;
  byteLength: number;
}

interface CueFramePlan {
  cue: TeachingSoundEffectCue;
  rawStart: number;
  rawEnd: number;
  cueFrames: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  attackFrames: number;
  releaseFrames: number;
}

const finite = (value: number): boolean => Number.isFinite(value);
const dbToGain = (db: number): number => 10 ** (db / 20);

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Teaching sound-effect mix cancelled', 'AbortError');
}

function validateLocalAssetRef(asset: TeachingSoundEffectAssetRef): void {
  if (!asset.assetId.trim() || !asset.assetVersion.trim()) throw new Error('teaching_sfx_invalid_asset_ref');
  if (!/^[a-f\d]{64}$/i.test(asset.checksum)) throw new Error('teaching_sfx_invalid_asset_checksum');
  let url: URL;
  try {
    url = new URL(asset.localUri);
  } catch {
    throw new Error('teaching_sfx_invalid_local_uri');
  }
  if (url.protocol !== 'file:' || url.hostname !== '') throw new Error('teaching_sfx_non_local_asset');
}

function validateBase(base: TeachingPcmTimeline, limits: TeachingSoundEffectMixLimits): number {
  if (!Number.isInteger(base.sampleRate) || base.sampleRate <= 0 || base.sampleRate > 384_000) {
    throw new Error('teaching_sfx_invalid_sample_rate');
  }
  if ((base.channelCount !== 1 && base.channelCount !== 2) || base.channels.length !== base.channelCount) {
    throw new Error('teaching_sfx_unsupported_channel_layout');
  }
  if (!finite(base.durationMs) || base.durationMs < 0) throw new Error('teaching_sfx_invalid_duration');
  const totalFrames = Math.round(base.durationMs / 1_000 * base.sampleRate);
  if (!Number.isSafeInteger(totalFrames)) throw new Error('teaching_sfx_invalid_duration_frames');
  if (totalFrames <= 0) throw new Error('teaching_sfx_empty_base');
  const outputBytes = totalFrames * base.channelCount * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(outputBytes) || outputBytes > limits.maxOutputBytes) {
    throw new Error('teaching_sfx_output_limit_exceeded');
  }
  if (totalFrames * base.channelCount > limits.maxTotalSamples) {
    throw new Error('teaching_sfx_sample_limit_exceeded');
  }
  for (const channel of base.channels) {
    if (channel.length !== totalFrames) throw new Error('teaching_sfx_base_duration_mismatch');
    for (const sample of channel) {
      if (!finite(sample)) throw new Error('teaching_sfx_non_finite_sample');
    }
  }
  return totalFrames;
}

function validateCue(cue: TeachingSoundEffectCue): void {
  validateLocalAssetRef(cue.asset);
  if (!cue.cueId.trim()) throw new Error('teaching_sfx_invalid_cue');
  for (const value of [cue.startMs, cue.endMs, cue.gainDb, cue.gainCeilingDb, cue.fadeInMs, cue.fadeOutMs]) {
    if (!finite(value)) throw new Error('teaching_sfx_invalid_cue');
  }
  if (cue.endMs <= cue.startMs || cue.fadeInMs < 0 || cue.fadeOutMs < 0
    || cue.gainDb < -96 || cue.gainDb > 24 || cue.gainCeilingDb < -96 || cue.gainCeilingDb > 0) {
    throw new Error('teaching_sfx_invalid_cue');
  }
  if (cue.ducking) {
    const { attenuationDb, attackMs, releaseMs } = cue.ducking;
    if (![attenuationDb, attackMs, releaseMs].every(finite)
      || attenuationDb > 0 || attenuationDb < -18 || attackMs < 0 || releaseMs < 0) {
      throw new Error('teaching_sfx_invalid_ducking');
    }
  }
}

function assetKey(asset: TeachingSoundEffectAssetRef): string {
  return `${asset.assetId}\u0000${asset.assetVersion}\u0000${asset.checksum}\u0000${asset.localUri}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedFrames(valueMs: number, sampleRate: number, maxFrames: number): number {
  const frames = Math.round(valueMs / 1_000 * sampleRate);
  if (!Number.isSafeInteger(frames) || Math.abs(frames) > maxFrames) {
    throw new Error('teaching_sfx_invalid_cue_frames');
  }
  return frames;
}

function createCueFramePlan(
  cue: TeachingSoundEffectCue,
  sampleRate: number,
  maxFrames: number,
): CueFramePlan {
  const rawStart = boundedFrames(cue.startMs, sampleRate, maxFrames);
  const rawEnd = boundedFrames(cue.endMs, sampleRate, maxFrames);
  const cueFrames = rawEnd - rawStart;
  if (!Number.isSafeInteger(cueFrames) || cueFrames <= 0 || cueFrames > maxFrames) {
    throw new Error('teaching_sfx_invalid_cue_frames');
  }
  const fadeInFrames = boundedFrames(cue.fadeInMs, sampleRate, maxFrames);
  const fadeOutFrames = boundedFrames(cue.fadeOutMs, sampleRate, maxFrames);
  const attackFrames = cue.ducking ? boundedFrames(cue.ducking.attackMs, sampleRate, maxFrames) : 0;
  const releaseFrames = cue.ducking ? boundedFrames(cue.ducking.releaseMs, sampleRate, maxFrames) : 0;
  return { cue, rawStart, rawEnd, cueFrames, fadeInFrames, fadeOutFrames, attackFrames, releaseFrames };
}

async function materializeAsset(input: {
  decoded: DecodedTeachingSoundEffect;
  base: TeachingPcmTimeline;
  limits: TeachingSoundEffectMixLimits;
  remainingAssetBytes: number;
  remainingSamples: number;
  signal?: AbortSignal;
}): Promise<MaterializedAsset> {
  const { decoded, base, limits, signal, remainingAssetBytes, remainingSamples } = input;
  if (decoded.sampleRate !== base.sampleRate) throw new Error('teaching_sfx_unsupported_sample_rate');
  if (decoded.channelCount !== base.channelCount || (decoded.channelCount !== 1 && decoded.channelCount !== 2)) {
    throw new Error('teaching_sfx_unsupported_channel_layout');
  }
  if (!Number.isSafeInteger(decoded.totalFrames) || decoded.totalFrames <= 0) {
    throw new Error('teaching_sfx_invalid_asset_frames');
  }
  const byteLength = decoded.totalFrames * decoded.channelCount * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(byteLength) || byteLength > limits.maxAssetBytes) {
    throw new Error('teaching_sfx_asset_limit_exceeded');
  }
  if (byteLength > remainingAssetBytes) throw new Error('teaching_sfx_total_asset_limit_exceeded');
  if (decoded.totalFrames * decoded.channelCount > remainingSamples) {
    throw new Error('teaching_sfx_sample_limit_exceeded');
  }
  const channels = Array.from({ length: decoded.channelCount }, () => new Float32Array(decoded.totalFrames));
  let offset = 0;
  for await (const chunk of decoded.chunks) {
    throwIfAborted(signal);
    if (chunk.channels.length !== decoded.channelCount) throw new Error('teaching_sfx_invalid_asset_chunk');
    const frames = chunk.channels[0]?.length ?? 0;
    if (frames <= 0 || chunk.channels.some((channel) => channel.length !== frames)
      || offset + frames > decoded.totalFrames) {
      throw new Error('teaching_sfx_invalid_asset_chunk');
    }
    for (let channelIndex = 0; channelIndex < decoded.channelCount; channelIndex += 1) {
      const source = chunk.channels[channelIndex];
      for (const sample of source) {
        if (!finite(sample)) throw new Error('teaching_sfx_non_finite_sample');
      }
      channels[channelIndex].set(source, offset);
    }
    offset += frames;
  }
  if (offset !== decoded.totalFrames) throw new Error('teaching_sfx_asset_frame_count_mismatch');
  return { channels, totalFrames: decoded.totalFrames, byteLength };
}

function cueFade(
  sourceFrame: number,
  audibleEndSourceFrame: number,
  fadeInFrames: number,
  fadeOutFrames: number,
): number {
  const fadeIn = fadeInFrames > 0 ? Math.min(1, (sourceFrame + 1) / fadeInFrames) : 1;
  const fadeOut = fadeOutFrames > 0 ? Math.min(1, (audibleEndSourceFrame - sourceFrame) / fadeOutFrames) : 1;
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

function applyDuckingEnvelope(
  envelope: Float32Array,
  plan: CueFramePlan,
  startFrame: number,
  endFrame: number,
  sourceOffset: number,
): void {
  const { cue, attackFrames, releaseFrames } = plan;
  if (!cue.ducking || startFrame >= endFrame) return;
  const duckGain = dbToGain(cue.ducking.attenuationDb);
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const elapsedCueFrame = sourceOffset + frame - startFrame;
    const attack = attackFrames > 0 ? Math.min(1, (elapsedCueFrame + 1) / attackFrames) : 1;
    envelope[frame] = Math.min(envelope[frame], 1 - (1 - duckGain) * attack);
  }
  const finalElapsedCueFrame = sourceOffset + endFrame - startFrame - 1;
  const reachedAttack = attackFrames > 0
    ? Math.min(1, (finalElapsedCueFrame + 1) / attackFrames)
    : 1;
  const reachedGain = 1 - (1 - duckGain) * reachedAttack;
  for (let offset = 0; offset < releaseFrames && endFrame + offset < envelope.length; offset += 1) {
    const release = (offset + 1) / releaseFrames;
    envelope[endFrame + offset] = Math.min(
      envelope[endFrame + offset],
      reachedGain + (1 - reachedGain) * release,
    );
  }
}

/**
 * Deterministically adds verified local SFX to one already assembled base PCM
 * timeline. The base is copied exactly once; normalization happens exactly once,
 * after ducking and every overlapping cue have been summed.
 */
export async function mixTeachingSoundEffects(input: {
  base: TeachingPcmTimeline;
  cues: readonly TeachingSoundEffectCue[];
  assetProvider: TeachingSoundEffectAssetProvider;
  limits?: Partial<TeachingSoundEffectMixLimits>;
  signal?: AbortSignal;
}): Promise<TeachingSoundEffectMixResult> {
  throwIfAborted(input.signal);
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  if (!Number.isSafeInteger(limits.maxCues) || limits.maxCues < 0
    || !Number.isSafeInteger(limits.maxOutputBytes) || limits.maxOutputBytes <= 0
    || !Number.isSafeInteger(limits.maxAssetBytes) || limits.maxAssetBytes <= 0
    || !Number.isSafeInteger(limits.maxTotalAssetBytes) || limits.maxTotalAssetBytes <= 0
    || !Number.isSafeInteger(limits.maxTotalSamples) || limits.maxTotalSamples <= 0
    || !finite(limits.maxCueGainDb) || limits.maxCueGainDb > 0) {
    throw new Error('teaching_sfx_invalid_limits');
  }
  if (input.cues.length > limits.maxCues) throw new Error('teaching_sfx_cue_limit_exceeded');
  const totalFrames = validateBase(input.base, limits);
  const cueIds = new Set<string>();
  for (const cue of input.cues) {
    validateCue(cue);
    if (cueIds.has(cue.cueId)) throw new Error('teaching_sfx_duplicate_cue_id');
    cueIds.add(cue.cueId);
  }
  const cues = [...input.cues].sort((left, right) => (
    left.startMs - right.startMs
    || left.endMs - right.endMs
    || compareText(left.cueId, right.cueId)
    || compareText(assetKey(left.asset), assetKey(right.asset))
  ));
  const cuePlans = cues.map((cue) => createCueFramePlan(
    cue,
    input.base.sampleRate,
    limits.maxTotalSamples,
  ));

  const assets = new Map<string, MaterializedAsset>();
  let totalAssetBytes = 0;
  let totalSamples = totalFrames * input.base.channelCount;
  for (const plan of cuePlans) {
    const { cue } = plan;
    throwIfAborted(input.signal);
    const key = assetKey(cue.asset);
    if (assets.has(key)) continue;
    const decoded = await input.assetProvider.loadLocalPcm(cue.asset, { signal: input.signal });
    throwIfAborted(input.signal);
    const materialized = await materializeAsset({
      decoded,
      base: input.base,
      limits,
      remainingAssetBytes: limits.maxTotalAssetBytes - totalAssetBytes,
      remainingSamples: limits.maxTotalSamples - totalSamples,
      signal: input.signal,
    });
    totalAssetBytes += materialized.byteLength;
    if (totalAssetBytes > limits.maxTotalAssetBytes) throw new Error('teaching_sfx_total_asset_limit_exceeded');
    totalSamples += materialized.totalFrames * input.base.channelCount;
    if (totalSamples > limits.maxTotalSamples) throw new Error('teaching_sfx_sample_limit_exceeded');
    assets.set(key, materialized);
  }

  // Nothing becomes observable until all assets and cues have validated.
  const duckEnvelope = new Float32Array(totalFrames);
  duckEnvelope.fill(1);
  const placements = cuePlans.map((plan) => {
    const { cue, rawStart, rawEnd, cueFrames } = plan;
    const start = Math.max(0, Math.min(totalFrames, rawStart));
    const requestedEnd = Math.max(start, Math.min(totalFrames, rawEnd));
    const sourceOffset = Math.max(0, start - rawStart);
    const asset = assets.get(assetKey(cue.asset));
    if (!asset) throw new Error('teaching_sfx_asset_missing_after_validation');
    const placedFrames = Math.max(0, Math.min(requestedEnd - start, asset.totalFrames - sourceOffset));
    const end = start + placedFrames;
    applyDuckingEnvelope(duckEnvelope, plan, start, end, sourceOffset);
    return { plan, cue, asset, rawStart, rawEnd, cueFrames, start, end, sourceOffset, placedFrames };
  });

  const channels = input.base.channels.map((baseChannel) => {
    const output = new Float32Array(totalFrames);
    for (let frame = 0; frame < totalFrames; frame += 1) output[frame] = baseChannel[frame] * duckEnvelope[frame];
    return output;
  });
  const cueDiagnostics: TeachingSoundEffectCueDiagnostics[] = [];
  for (const placement of placements) {
    throwIfAborted(input.signal);
    const { plan, cue, asset, cueFrames, start, sourceOffset, placedFrames, rawStart, rawEnd } = placement;
    const appliedGainDb = Math.min(cue.gainDb, cue.gainCeilingDb, limits.maxCueGainDb);
    const gain = dbToGain(appliedGainDb);
    const audibleEndSourceFrame = Math.min(cueFrames, asset.totalFrames);
    for (let offset = 0; offset < placedFrames; offset += 1) {
      const sourceFrame = sourceOffset + offset;
      const frameGain = gain * cueFade(
        sourceFrame,
        audibleEndSourceFrame,
        plan.fadeInFrames,
        plan.fadeOutFrames,
      );
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        channels[channelIndex][start + offset] += asset.channels[channelIndex][sourceFrame] * frameGain;
      }
    }
    cueDiagnostics.push({
      cueId: cue.cueId,
      assetId: cue.asset.assetId,
      placedFrames,
      trimmedHeadFrames: Math.max(0, -rawStart),
      trimmedTailFrames: Math.max(0, rawEnd - totalFrames),
      appliedGainDb,
    });
  }

  throwIfAborted(input.signal);
  let originalPeak = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      if (!finite(sample)) throw new Error('teaching_sfx_non_finite_mix');
      originalPeak = Math.max(originalPeak, Math.abs(sample));
    }
  }
  const finalGain = originalPeak > 1 ? FINAL_TARGET_PEAK / originalPeak : 1;
  let peak = 0;
  for (const channel of channels) {
    for (let frame = 0; frame < channel.length; frame += 1) {
      channel[frame] *= finalGain;
      peak = Math.max(peak, Math.abs(channel[frame]));
    }
  }

  return {
    sampleRate: input.base.sampleRate,
    channelCount: input.base.channelCount,
    durationMs: input.base.durationMs,
    channels,
    diagnostics: {
      cueCount: input.cues.length,
      baseMixPasses: 1,
      normalizationPasses: 1,
      originalPeak,
      peak,
      finalGain,
      appliedGainDb: finalGain < 1 ? 20 * Math.log10(finalGain) : 0,
      cues: cueDiagnostics,
    },
  };
}
