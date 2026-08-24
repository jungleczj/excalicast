'use client';

import type { TimeSegment } from '@/types/recording';
import { StreamingCubicResampler } from '@/services/audioResample';

export const EXPORT_AUDIO_SAMPLE_RATE = 48_000;
export const EXPORT_AUDIO_BITRATE = 160_000;
export const AAC_FRAME_SAMPLES = 1_024;

export interface RawCanonicalExportLimits {
  readonly maxFrames: number;
  readonly maxBytes: number;
}

export const RAW_CANONICAL_FALLBACK_MAX_DURATION_MS = 30 * 60 * 1_000;

export const TEACHING_SFX_RAW_CANONICAL_FALLBACK_LIMITS: RawCanonicalExportLimits = Object.freeze({
  maxFrames: RAW_CANONICAL_FALLBACK_MAX_DURATION_MS / 1_000 * EXPORT_AUDIO_SAMPLE_RATE,
  maxBytes: RAW_CANONICAL_FALLBACK_MAX_DURATION_MS / 1_000
    * EXPORT_AUDIO_SAMPLE_RATE * Float32Array.BYTES_PER_ELEMENT,
});

export interface EncodedAudioTiming {
  timestamp: number;
  duration: number;
}

export interface AacTimelineDiagnostics {
  duplicateFrames: number;
  missingFrames: number;
  overlappingFrames: number;
  maxTimestampErrorUs: number;
}

export interface ContinuousAacTimeline {
  order: number[];
  timestamps: number[];
  diagnostics: AacTimelineDiagnostics;
}

export interface PreparedExportAudioDiagnostics {
  sourceFrames: number;
  outputFrames: number;
  nonFiniteSamples: number;
  clippedSamples: number;
  peak: number;
  originalPeak: number;
  appliedGainDb: number;
  normalizationPasses: 0 | 1;
}

export interface RawCanonicalExportAudio {
  samples: Float32Array;
  sampleRate: typeof EXPORT_AUDIO_SAMPLE_RATE;
  channels: 1;
  totalFrames: number;
  durationMs: number;
  diagnostics: PreparedExportAudioDiagnostics & { normalizationPasses: 0 };
  sourceKind: PreparedExportAudio['sourceKind'];
  sourceTrackId?: string;
}

export interface PreparedExportAudio {
  samples: Float32Array;
  sampleRate: typeof EXPORT_AUDIO_SAMPLE_RATE;
  channels: 1;
  totalFrames: number;
  durationMs: number;
  diagnostics: PreparedExportAudioDiagnostics;
  getWavBlob: () => Blob;
  sourceKind: 'original' | 'enhanced' | 'repair' | 'dubbing';
  sourceTrackId?: string;
}

export function createSilentExportAudio(durationMs: number): PreparedExportAudio {
  return normalizeRawCanonicalExportAudio(createRawSilentExportAudio(durationMs));
}

/** Joins independently recorded clips before the single final audio encode. */
export function concatenatePreparedExportAudio(
  tracks: readonly PreparedExportAudio[],
  crossfadeMs = 5,
): PreparedExportAudio {
  return normalizeRawCanonicalExportAudio(concatenateCanonicalExportAudio(tracks, crossfadeMs, undefined, false));
}

export function concatenateRawCanonicalExportAudio(
  tracks: readonly RawCanonicalExportAudio[],
  crossfadeMs = 5,
  signal?: AbortSignal,
  limits?: Partial<RawCanonicalExportLimits>,
): RawCanonicalExportAudio {
  return concatenateCanonicalExportAudio(tracks, crossfadeMs, signal, true, limits);
}

function concatenateCanonicalExportAudio(
  tracks: readonly (RawCanonicalExportAudio | PreparedExportAudio)[],
  crossfadeMs: number,
  signal: AbortSignal | undefined,
  requireRaw: boolean,
  configuredLimits?: Partial<RawCanonicalExportLimits>,
): RawCanonicalExportAudio {
  throwIfExportAborted(signal);
  if (tracks.length === 0) return createRawSilentExportAudio(0, configuredLimits);
  for (const track of tracks) validateCanonicalTrack(track, requireRaw);
  const totalFrames = tracks.reduce((sum, track) => sum + track.totalFrames, 0);
  if (!Number.isSafeInteger(totalFrames) || totalFrames <= 0) throw new Error('export_audio_raw_track_invalid');
  validateRawOutputBudget(totalFrames, configuredLimits);
  const samples = new Float32Array(Math.max(1, totalFrames));
  const boundaries: number[] = [];
  let offset = 0;
  for (const track of tracks) {
    throwIfExportAborted(signal);
    if (offset > 0) boundaries.push(offset);
    samples.set(track.samples, offset);
    offset += track.totalFrames;
  }

  const radius = Math.max(0, Math.round(crossfadeMs / 1_000 * EXPORT_AUDIO_SAMPLE_RATE));
  for (const boundary of boundaries) {
    throwIfExportAborted(signal);
    const count = Math.min(radius, boundary, samples.length - boundary);
    if (count <= 0) continue;
    const left = samples[boundary - count];
    const right = samples[boundary + count - 1];
    for (let index = -count; index < count; index += 1) {
      if ((index & 0x3fff) === 0) throwIfExportAborted(signal);
      const ratio = (index + count) / Math.max(1, count * 2 - 1);
      samples[boundary + index] = left * Math.cos(ratio * Math.PI / 2) ** 2
        + right * Math.sin(ratio * Math.PI / 2) ** 2;
    }
  }
  const level = analyzeExportPeak(samples);
  return {
    samples,
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    channels: 1,
    totalFrames: samples.length,
    durationMs: samples.length / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    diagnostics: {
      sourceFrames: tracks.reduce((sum, track) => sum + track.diagnostics.sourceFrames, 0),
      outputFrames: samples.length,
      nonFiniteSamples: level.nonFiniteSamples,
      clippedSamples: level.clippedSamples,
      peak: level.peak,
      originalPeak: level.originalPeak,
      appliedGainDb: 0,
      normalizationPasses: 0,
    },
    sourceKind: tracks.every((track) => track.sourceKind === tracks[0].sourceKind)
      ? tracks[0].sourceKind
      : 'original',
    sourceTrackId: tracks.every((track) => track.sourceTrackId === tracks[0].sourceTrackId)
      ? tracks[0].sourceTrackId
      : undefined,
  };
}

/**
 * Mixes simultaneous recording sources (normally microphone + system audio).
 * Tracks stay time-aligned at frame zero; a single post-mix gain is applied only
 * when their sum would clip, preserving the relative level and full duration.
 */
export function mixPreparedExportAudio(tracks: readonly PreparedExportAudio[]): PreparedExportAudio {
  return normalizeRawCanonicalExportAudio(assembleCanonicalExportAudio(tracks, undefined, false));
}

/**
 * Sums independently addressable, frame-zero-aligned canonical sources exactly
 * once. Shorter inputs are zero-padded and no anti-clipping gain is applied.
 */
export function assembleRawCanonicalExportAudio(
  tracks: readonly RawCanonicalExportAudio[],
  signal?: AbortSignal,
  limits?: Partial<RawCanonicalExportLimits>,
): RawCanonicalExportAudio {
  return assembleCanonicalExportAudio(tracks, signal, true, limits);
}

function assembleCanonicalExportAudio(
  tracks: readonly (RawCanonicalExportAudio | PreparedExportAudio)[],
  signal: AbortSignal | undefined,
  requireRaw: boolean,
  configuredLimits?: Partial<RawCanonicalExportLimits>,
): RawCanonicalExportAudio {
  throwIfExportAborted(signal);
  if (tracks.length === 0) return createRawSilentExportAudio(0, configuredLimits);
  for (const track of tracks) validateCanonicalTrack(track, requireRaw);
  const totalFrames = Math.max(...tracks.map((track) => track.totalFrames));
  validateRawOutputBudget(totalFrames, configuredLimits);
  const samples = new Float32Array(Math.max(1, totalFrames));
  for (const track of tracks) {
    throwIfExportAborted(signal);
    for (let index = 0; index < track.totalFrames; index += 1) {
      if ((index & 0x3fff) === 0) throwIfExportAborted(signal);
      samples[index] += track.samples[index];
    }
  }
  const level = analyzeExportPeak(samples);
  return {
    samples,
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    channels: 1,
    totalFrames: samples.length,
    durationMs: samples.length / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    diagnostics: {
      sourceFrames: tracks.reduce((sum, track) => sum + track.diagnostics.sourceFrames, 0),
      outputFrames: samples.length,
      nonFiniteSamples: level.nonFiniteSamples,
      clippedSamples: level.clippedSamples,
      peak: level.peak,
      originalPeak: level.originalPeak,
      appliedGainDb: 0,
      normalizationPasses: 0,
    },
    sourceKind: tracks.every((track) => track.sourceKind === tracks[0].sourceKind)
      ? tracks[0].sourceKind
      : 'original',
    sourceTrackId: tracks.every((track) => track.sourceTrackId === tracks[0].sourceTrackId)
      ? tracks[0].sourceTrackId
      : undefined,
  };
}

const aacTimestampAt = (index: number): number => (
  Math.round(index * AAC_FRAME_SAMPLES / EXPORT_AUDIO_SAMPLE_RATE * 1_000_000)
);

/**
 * AudioEncoder callbacks are not a reliable MP4 clock. Sort by the source PTS,
 * validate that no AAC access unit vanished, then build DTS from sample count.
 */
export function createContinuousAacTimeline(chunks: EncodedAudioTiming[]): ContinuousAacTimeline {
  const sorted = chunks
    .map((chunk, order) => ({ ...chunk, order }))
    .sort((a, b) => a.timestamp - b.timestamp || a.order - b.order);
  const diagnostics: AacTimelineDiagnostics = {
    duplicateFrames: 0,
    missingFrames: 0,
    overlappingFrames: 0,
    maxTimestampErrorUs: 0,
  };
  const toleranceUs = 2;
  for (let index = 0; index < sorted.length; index += 1) {
    const expected = aacTimestampAt(index);
    const error = Math.round(sorted[index].timestamp) - expected;
    diagnostics.maxTimestampErrorUs = Math.max(diagnostics.maxTimestampErrorUs, Math.abs(error));
    if (index > 0 && sorted[index].timestamp === sorted[index - 1].timestamp) {
      diagnostics.duplicateFrames += 1;
      continue;
    }
    if (error > toleranceUs) diagnostics.missingFrames += 1;
    if (error < -toleranceUs) diagnostics.overlappingFrames += 1;
  }
  if (diagnostics.duplicateFrames || diagnostics.missingFrames || diagnostics.overlappingFrames) {
    throw new Error('aac_audio_timeline_discontinuous');
  }
  return {
    order: sorted.map((chunk) => chunk.order),
    timestamps: sorted.map((_chunk, index) => aacTimestampAt(index)),
    diagnostics,
  };
}

export function validateProcessedAudioFrameCount(
  inputFrames: number,
  outputFrames: number,
  toleranceFrames: number,
): void {
  if (!Number.isFinite(inputFrames) || !Number.isFinite(outputFrames)
    || inputFrames <= 0 || outputFrames <= 0
    || Math.abs(Math.round(inputFrames) - Math.round(outputFrames)) > Math.max(0, toleranceFrames)) {
    throw new Error('processed_audio_frame_count_mismatch');
  }
}

const EXPORT_AUDIO_TARGET_PEAK = 10 ** (-1 / 20);

function analyzeExportPeak(samples: Float32Array): Pick<PreparedExportAudioDiagnostics,
  'nonFiniteSamples' | 'clippedSamples' | 'peak' | 'originalPeak'> {
  let nonFiniteSamples = 0;
  let originalPeak = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) {
      nonFiniteSamples += 1;
      continue;
    }
    originalPeak = Math.max(originalPeak, Math.abs(sample));
  }
  if (nonFiniteSamples > 0) throw new Error('export_audio_non_finite_samples');

  let peak = 0;
  let clippedSamples = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    if (magnitude > 1) clippedSamples += 1;
  }
  return {
    nonFiniteSamples,
    clippedSamples,
    peak,
    originalPeak,
  };
}

function normalizeExportPeak(samples: Float32Array): Pick<PreparedExportAudioDiagnostics,
  'nonFiniteSamples' | 'clippedSamples' | 'peak' | 'originalPeak' | 'appliedGainDb'> {
  const original = analyzeExportPeak(samples);
  const gain = original.originalPeak > 1 ? EXPORT_AUDIO_TARGET_PEAK / original.originalPeak : 1;
  if (gain < 1) {
    for (let index = 0; index < samples.length; index += 1) samples[index] *= gain;
  }
  const normalized = analyzeExportPeak(samples);
  return {
    ...normalized,
    originalPeak: original.originalPeak,
    appliedGainDb: gain < 1 ? 20 * Math.log10(gain) : 0,
  };
}

function throwIfExportAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

function validateCanonicalTrack(
  track: RawCanonicalExportAudio | PreparedExportAudio,
  requireRaw: boolean,
): void {
  const expectedDurationMs = track.samples.length / EXPORT_AUDIO_SAMPLE_RATE * 1_000;
  if (track.sampleRate !== EXPORT_AUDIO_SAMPLE_RATE || track.channels !== 1
    || !Number.isSafeInteger(track.totalFrames) || track.totalFrames <= 0
    || track.totalFrames !== track.samples.length
    || !Number.isFinite(track.durationMs)
    || Math.abs(track.durationMs - expectedDurationMs) > 1e-7
    || (requireRaw && track.diagnostics.normalizationPasses !== 0)) {
    throw new Error('export_audio_raw_track_invalid');
  }
}

function validateRawOutputBudget(
  totalFrames: number,
  configured?: Partial<RawCanonicalExportLimits>,
): void {
  const outputBytes = totalFrames * Float32Array.BYTES_PER_ELEMENT;
  // A missing limit preserves the legacy export duration contract. The public
  // raw primitives still reject values outside JavaScript/typed-array addressable
  // bounds; bounded teaching fallback callers must opt in with explicit limits.
  const typedArrayMaxFrames = 0xffff_ffff;
  const requested = {
    maxFrames: configured?.maxFrames ?? typedArrayMaxFrames,
    maxBytes: configured?.maxBytes ?? typedArrayMaxFrames * Float32Array.BYTES_PER_ELEMENT,
  };
  if (!Number.isSafeInteger(requested.maxFrames) || requested.maxFrames <= 0
    || !Number.isSafeInteger(requested.maxBytes) || requested.maxBytes <= 0) {
    throw new Error('export_audio_raw_limits_invalid');
  }
  const limits = {
    maxFrames: Math.min(requested.maxFrames, typedArrayMaxFrames),
    maxBytes: Math.min(
      requested.maxBytes,
      typedArrayMaxFrames * Float32Array.BYTES_PER_ELEMENT,
    ),
  };
  if (!Number.isSafeInteger(totalFrames) || totalFrames <= 0
    || !Number.isSafeInteger(outputBytes)
    || totalFrames > limits.maxFrames
    || outputBytes > limits.maxBytes) {
    throw new Error('export_audio_raw_output_limit_exceeded');
  }
}

/** Shared no-allocation preflight used for media duration metadata. */
export function validateRawExportDurationBudget(
  durationSeconds: number,
  limits?: Partial<RawCanonicalExportLimits>,
): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('export_audio_raw_duration_invalid');
  }
  validateRawOutputBudget(
    Math.ceil(durationSeconds * EXPORT_AUDIO_SAMPLE_RATE),
    limits,
  );
}

export function createRawSilentExportAudio(
  durationMs: number,
  limits?: Partial<RawCanonicalExportLimits>,
): RawCanonicalExportAudio {
  const totalFrames = Math.max(1, Math.round(Math.max(0, durationMs) / 1_000 * EXPORT_AUDIO_SAMPLE_RATE));
  validateRawOutputBudget(totalFrames, limits);
  return {
    samples: new Float32Array(totalFrames),
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    channels: 1,
    totalFrames,
    durationMs: totalFrames / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    diagnostics: {
      sourceFrames: totalFrames,
      outputFrames: totalFrames,
      nonFiniteSamples: 0,
      clippedSamples: 0,
      peak: 0,
      originalPeak: 0,
      appliedGainDb: 0,
      normalizationPasses: 0,
    },
    sourceKind: 'original',
  };
}

export function normalizeRawCanonicalExportAudio(raw: RawCanonicalExportAudio): PreparedExportAudio {
  validateCanonicalTrack(raw, true);
  const samples = raw.samples.slice();
  const level = normalizeExportPeak(samples);
  return {
    samples,
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    channels: 1,
    totalFrames: samples.length,
    durationMs: samples.length / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    diagnostics: {
      sourceFrames: raw.diagnostics.sourceFrames,
      outputFrames: samples.length,
      nonFiniteSamples: level.nonFiniteSamples,
      clippedSamples: level.clippedSamples,
      peak: level.peak,
      originalPeak: level.originalPeak,
      appliedGainDb: level.appliedGainDb,
      normalizationPasses: 1,
    },
    getWavBlob: lazyWavBlob(samples),
    sourceKind: raw.sourceKind,
    sourceTrackId: raw.sourceTrackId,
  };
}

function lazyWavBlob(samples: Float32Array): () => Blob {
  let cached: Blob | null = null;
  return () => {
    cached ??= encodeFloat32Wav(samples, EXPORT_AUDIO_SAMPLE_RATE);
    return cached;
  };
}

function downmixMono(channels: Float32Array[]): Float32Array {
  const frames = commonChannelFrames(channels);
  if (channels.length === 1) return channels[0].slice(0, frames);
  const mono = new Float32Array(frames);
  for (const channel of channels) {
    for (let index = 0; index < frames; index += 1) mono[index] += channel[index] / channels.length;
  }
  return mono;
}

function commonChannelFrames(channels: readonly { length: number }[]): number {
  if (channels.length === 0) throw new Error('export_audio_missing_channels');
  const frames = Math.min(...channels.map((channel) => channel.length));
  if (!Number.isSafeInteger(frames) || frames <= 0) throw new Error('export_audio_empty');
  return frames;
}

function spliceRanges(
  sourceFrames: number,
  segments: TimeSegment[] | undefined,
  sampleRate: number,
): Array<{ start: number; end: number }> {
  if (!segments?.length) return [{ start: 0, end: sourceFrames }];
  return segments.map((segment) => {
    const start = Math.max(0, Math.min(sourceFrames, Math.round(segment.start / 1_000 * sampleRate)));
    const end = Math.max(start, Math.min(sourceFrames, Math.round(segment.end / 1_000 * sampleRate)));
    return { start, end };
  });
}

function splicePcm(source: Float32Array, ranges: readonly { start: number; end: number }[]): Float32Array {
  if (ranges.length === 1 && ranges[0].start === 0 && ranges[0].end === source.length) return source;
  const output = new Float32Array(ranges.reduce((sum, range) => sum + range.end - range.start, 0));
  let offset = 0;
  for (const range of ranges) {
    output.set(source.subarray(range.start, range.end), offset);
    offset += range.end - range.start;
  }
  return output;
}

function smoothCutBoundaries(
  samples: Float32Array,
  segments: TimeSegment[] | undefined,
  sampleRate: number,
  crossfadeMs: number,
): void {
  if (!segments || segments.length < 2 || crossfadeMs <= 0) return;
  const radius = Math.max(1, Math.round(crossfadeMs / 1_000 * sampleRate));
  let boundary = 0;
  for (let segmentIndex = 0; segmentIndex < segments.length - 1; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    boundary += Math.max(0, Math.round((segment.end - segment.start) / 1_000 * sampleRate));
    const count = Math.min(radius, boundary, samples.length - boundary);
    if (count <= 0) continue;
    const left = samples[boundary - count];
    const right = samples[boundary + count - 1];
    for (let index = -count; index < count; index += 1) {
      const ratio = (index + count) / Math.max(1, count * 2 - 1);
      samples[boundary + index] = left * Math.cos(ratio * Math.PI / 2) ** 2
        + right * Math.sin(ratio * Math.PI / 2) ** 2;
    }
  }
}

export interface BuildExportMonoPcmInput {
  channels: Float32Array[];
  sampleRate: number;
  durationMs: number;
  segments?: TimeSegment[];
  crossfadeMs?: number;
  sourceKind?: PreparedExportAudio['sourceKind'];
  sourceTrackId?: string;
  limits?: Partial<RawCanonicalExportLimits>;
}

/** Builds canonical export PCM without applying anti-clipping gain. */
export function buildRawExportMonoPcm(input: BuildExportMonoPcmInput): RawCanonicalExportAudio {
  if (input.sampleRate !== EXPORT_AUDIO_SAMPLE_RATE) {
    throw new Error(`export_audio_requires_48000hz:${input.sampleRate}`);
  }
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
    throw new Error('export_audio_raw_duration_invalid');
  }
  if (input.durationMs > 0) {
    validateRawOutputBudget(
      Math.ceil(input.durationMs / 1_000 * input.sampleRate),
      input.limits,
    );
  }
  const sourceFrames = commonChannelFrames(input.channels);
  validateRawOutputBudget(sourceFrames, input.limits);
  const ranges = spliceRanges(sourceFrames, input.segments, input.sampleRate);
  const outputFrames = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
  validateRawOutputBudget(outputFrames, input.limits);
  const source = downmixMono(input.channels);
  const samples = splicePcm(source, ranges);
  smoothCutBoundaries(samples, input.segments, input.sampleRate, input.crossfadeMs ?? 5);
  const level = analyzeExportPeak(samples);
  return {
    samples,
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    channels: 1,
    totalFrames: samples.length,
    durationMs: samples.length / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    diagnostics: {
      sourceFrames: source.length,
      outputFrames: samples.length,
      nonFiniteSamples: level.nonFiniteSamples,
      clippedSamples: level.clippedSamples,
      peak: level.peak,
      originalPeak: level.originalPeak,
      appliedGainDb: 0,
      normalizationPasses: 0,
    },
    sourceKind: input.sourceKind ?? 'original',
    sourceTrackId: input.sourceTrackId,
  };
}

/** Builds the single normalized canonical PCM timeline consumed by export encoders. */
export function buildExportMonoPcm(input: BuildExportMonoPcmInput): PreparedExportAudio {
  return normalizeRawCanonicalExportAudio(buildRawExportMonoPcm(input));
}

/** Float WAV avoids a second lossy/16-bit quantization before ffmpeg AAC. */
export function encodeFloat32Wav(samples: Float32Array, sampleRate = EXPORT_AUDIO_SAMPLE_RATE): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.byteLength, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  writeText(36, 'data');
  view.setUint32(40, samples.byteLength, true);
  const pcm = new Uint8Array(samples.byteLength);
  pcm.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
  return new Blob([header, pcm.buffer], { type: 'audio/wav' });
}

interface DecodedExportMono {
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
}

/** 用 Mediabunny 解码音频并重采样到统一的 48kHz 单声道 PCM。
 *  与降噪/修复/波形生成同源，避免 decodeAudioData 对 MediaRecorder 分片录制的
 *  Opus WebM 解码时在 pre-skip / Cluster 边界产生可闻间隙。 */
async function decodeExportMono(
  source: Blob | string,
  signal?: AbortSignal,
  limits?: Partial<RawCanonicalExportLimits>,
): Promise<DecodedExportMono> {
  const { ALL_FORMATS, AudioSampleSink, BlobSource, Input, UrlSource } = await import('mediabunny');
  const input = new Input({
    source: typeof source === 'string'
      ? new UrlSource(source)
      : new BlobSource(source, { maxCacheSize: 4 * 1024 * 1024, useStreamReader: true }),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('export_audio_missing_track');
    try {
      const metadataDurationSeconds = await track.getDurationFromMetadata({ skipLiveWait: true });
      if (metadataDurationSeconds !== null && Number.isFinite(metadataDurationSeconds)
        && metadataDurationSeconds > 0) {
        validateRawExportDurationBudget(metadataDurationSeconds, limits);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('export_audio_')) throw error;
      // Some streaming containers have no trustworthy duration metadata. The
      // incremental checks below remain authoritative for those inputs.
    }
    throwIfExportAborted(signal);
    const sink = new AudioSampleSink(track);
    let resampler: StreamingCubicResampler | null = null;
    let sourceSampleRate: number | null = null;
    let sourceFramesSeen = 0;
    let materializedFrames = 0;
    const parts: Float32Array[] = [];
    for await (const sample of sink.samples()) {
      try {
        if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
        if (!Number.isSafeInteger(sample.numberOfFrames) || sample.numberOfFrames <= 0
          || !Number.isInteger(sample.sampleRate) || sample.sampleRate <= 0) {
          throw new Error('export_audio_invalid_decoded_sample');
        }
        sourceFramesSeen += sample.numberOfFrames;
        const projectedFrames = Math.ceil(sourceFramesSeen / sample.sampleRate * EXPORT_AUDIO_SAMPLE_RATE);
        validateRawOutputBudget(projectedFrames, limits);
        const mono = new Float32Array(sample.numberOfFrames);
        for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
          const plane = new Float32Array(sample.numberOfFrames);
          sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
          for (let index = 0; index < mono.length; index += 1) mono[index] += plane[index] / sample.numberOfChannels;
        }
        if (!resampler) {
          sourceSampleRate = sample.sampleRate;
          resampler = new StreamingCubicResampler(sample.sampleRate, EXPORT_AUDIO_SAMPLE_RATE);
        }
        if (sample.sampleRate !== sourceSampleRate) throw new Error('export_audio_sample_rate_changed');
        const resampled = resampler.push(mono);
        if (resampled.length > 0) {
          materializedFrames += resampled.length;
          validateRawOutputBudget(materializedFrames, limits);
          parts.push(resampled);
        }
      } finally {
        sample.close();
      }
    }
    if (!resampler) throw new Error('export_audio_empty');
    const tail = resampler.flush();
    if (tail.length > 0) {
      materializedFrames += tail.length;
      validateRawOutputBudget(materializedFrames, limits);
      parts.push(tail);
    }

    const totalFrames = parts.reduce((sum, part) => sum + part.length, 0);
    if (totalFrames === 0) throw new Error('export_audio_empty');
    validateRawOutputBudget(totalFrames, limits);
    const samples = new Float32Array(totalFrames);
    let offset = 0;
    for (const part of parts) {
      samples.set(part, offset);
      offset += part.length;
    }
    return {
      samples,
      sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
      durationMs: totalFrames / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    };
  } finally {
    input.dispose();
  }
}

export async function prepareExportAudio(input: {
  blob: Blob | string;
  segments?: TimeSegment[];
  sourceKind?: PreparedExportAudio['sourceKind'];
  sourceTrackId?: string;
  signal?: AbortSignal;
  limits?: Partial<RawCanonicalExportLimits>;
}): Promise<PreparedExportAudio> {
  return normalizeRawCanonicalExportAudio(await prepareRawExportAudio(input));
}

export async function prepareRawExportAudio(input: {
  blob: Blob | string;
  segments?: TimeSegment[];
  sourceKind?: PreparedExportAudio['sourceKind'];
  sourceTrackId?: string;
  signal?: AbortSignal;
  limits?: Partial<RawCanonicalExportLimits>;
}): Promise<RawCanonicalExportAudio> {
  if (input.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  try {
    const decoded = await decodeExportMono(input.blob, input.signal, input.limits);
    if (input.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    return buildRawExportMonoPcm({
      channels: [decoded.samples],
      sampleRate: decoded.sampleRate,
      durationMs: decoded.durationMs,
      segments: input.segments,
      sourceKind: input.sourceKind,
      sourceTrackId: input.sourceTrackId,
      limits: input.limits,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof Error && error.message.startsWith('export_audio_')) throw error;
    throw new Error('export_audio_decode_failed', { cause: error });
  }
}
