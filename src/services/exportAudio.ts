'use client';

import type { TimeSegment } from '@/types/recording';

export const EXPORT_AUDIO_SAMPLE_RATE = 48_000;
export const EXPORT_AUDIO_BITRATE = 160_000;
export const AAC_FRAME_SAMPLES = 1_024;

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
}

export interface PreparedExportAudio {
  samples: Float32Array;
  sampleRate: typeof EXPORT_AUDIO_SAMPLE_RATE;
  channels: 1;
  totalFrames: number;
  durationMs: number;
  diagnostics: PreparedExportAudioDiagnostics;
  wavBlob: Blob;
  sourceKind: 'original' | 'enhanced' | 'repair' | 'dubbing';
  sourceTrackId?: string;
}

export function createSilentExportAudio(durationMs: number): PreparedExportAudio {
  const totalFrames = Math.max(1, Math.round(Math.max(0, durationMs) / 1_000 * EXPORT_AUDIO_SAMPLE_RATE));
  const samples = new Float32Array(totalFrames);
  return {
    samples,
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
    },
    wavBlob: encodeFloat32Wav(samples, EXPORT_AUDIO_SAMPLE_RATE),
    sourceKind: 'original',
  };
}

/** Joins independently recorded clips before the single final audio encode. */
export function concatenatePreparedExportAudio(
  tracks: PreparedExportAudio[],
  crossfadeMs = 5,
): PreparedExportAudio {
  if (tracks.length === 0) return createSilentExportAudio(0);
  const totalFrames = tracks.reduce((sum, track) => sum + track.totalFrames, 0);
  const samples = new Float32Array(Math.max(1, totalFrames));
  const boundaries: number[] = [];
  let offset = 0;
  for (const track of tracks) {
    if (offset > 0) boundaries.push(offset);
    samples.set(track.samples, offset);
    offset += track.totalFrames;
  }

  const radius = Math.max(0, Math.round(crossfadeMs / 1_000 * EXPORT_AUDIO_SAMPLE_RATE));
  for (const boundary of boundaries) {
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

  let peak = 0;
  let clippedSamples = 0;
  let nonFiniteSamples = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) nonFiniteSamples += 1;
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    if (magnitude > 1) clippedSamples += 1;
  }
  if (nonFiniteSamples > 0) throw new Error('export_audio_non_finite_samples');
  if (clippedSamples > 0) throw new Error('export_audio_clipped_samples');

  return {
    samples,
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    channels: 1,
    totalFrames: samples.length,
    durationMs: samples.length / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    diagnostics: {
      sourceFrames: tracks.reduce((sum, track) => sum + track.diagnostics.sourceFrames, 0),
      outputFrames: samples.length,
      nonFiniteSamples,
      clippedSamples,
      peak,
    },
    wavBlob: encodeFloat32Wav(samples, EXPORT_AUDIO_SAMPLE_RATE),
    sourceKind: tracks.every((track) => track.sourceKind === tracks[0].sourceKind)
      ? tracks[0].sourceKind
      : 'original',
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

function downmixMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) throw new Error('export_audio_missing_channels');
  const frames = Math.min(...channels.map((channel) => channel.length));
  if (frames <= 0) throw new Error('export_audio_empty');
  if (channels.length === 1) return channels[0].slice(0, frames);
  const mono = new Float32Array(frames);
  for (const channel of channels) {
    for (let index = 0; index < frames; index += 1) mono[index] += channel[index] / channels.length;
  }
  return mono;
}

function splicePcm(source: Float32Array, segments: TimeSegment[] | undefined, sampleRate: number): Float32Array {
  if (!segments?.length) return source;
  const ranges = segments.map((segment) => {
    const start = Math.max(0, Math.min(source.length, Math.round(segment.start / 1_000 * sampleRate)));
    const end = Math.max(start, Math.min(source.length, Math.round(segment.end / 1_000 * sampleRate)));
    return { start, end };
  });
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

/** Builds the single canonical PCM timeline consumed by every export encoder. */
export function buildExportMonoPcm(input: {
  channels: Float32Array[];
  sampleRate: number;
  durationMs: number;
  segments?: TimeSegment[];
  crossfadeMs?: number;
  sourceKind?: PreparedExportAudio['sourceKind'];
  sourceTrackId?: string;
}): PreparedExportAudio {
  if (input.sampleRate !== EXPORT_AUDIO_SAMPLE_RATE) {
    throw new Error(`export_audio_requires_48000hz:${input.sampleRate}`);
  }
  const source = downmixMono(input.channels);
  const samples = splicePcm(source, input.segments, input.sampleRate);
  smoothCutBoundaries(samples, input.segments, input.sampleRate, input.crossfadeMs ?? 5);
  let nonFiniteSamples = 0;
  let clippedSamples = 0;
  let peak = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) nonFiniteSamples += 1;
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    if (magnitude > 1) clippedSamples += 1;
  }
  if (nonFiniteSamples > 0) throw new Error('export_audio_non_finite_samples');
  if (clippedSamples > 0) throw new Error('export_audio_clipped_samples');
  const prepared: PreparedExportAudio = {
    samples,
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    channels: 1,
    totalFrames: samples.length,
    durationMs: samples.length / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    diagnostics: {
      sourceFrames: source.length,
      outputFrames: samples.length,
      nonFiniteSamples,
      clippedSamples,
      peak,
    },
    wavBlob: encodeFloat32Wav(samples, EXPORT_AUDIO_SAMPLE_RATE),
    sourceKind: input.sourceKind ?? 'original',
    sourceTrackId: input.sourceTrackId,
  };
  return prepared;
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

export async function prepareExportAudio(input: {
  blob: Blob;
  segments?: TimeSegment[];
  sourceKind?: PreparedExportAudio['sourceKind'];
  sourceTrackId?: string;
  signal?: AbortSignal;
}): Promise<PreparedExportAudio> {
  if (input.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  const AudioContextCtor = globalThis.AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('export_audio_decode_unsupported');
  const context = new AudioContextCtor({ sampleRate: EXPORT_AUDIO_SAMPLE_RATE });
  try {
    const decoded = await context.decodeAudioData(await input.blob.arrayBuffer());
    if (input.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    if (decoded.sampleRate !== EXPORT_AUDIO_SAMPLE_RATE) {
      throw new Error(`export_audio_resample_failed:${decoded.sampleRate}`);
    }
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      channels.push(decoded.getChannelData(channel));
    }
    return buildExportMonoPcm({
      channels,
      sampleRate: decoded.sampleRate,
      durationMs: decoded.duration * 1_000,
      segments: input.segments,
      sourceKind: input.sourceKind,
      sourceTrackId: input.sourceTrackId,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof Error && error.message.startsWith('export_audio_')) throw error;
    throw new Error('export_audio_decode_failed', { cause: error });
  } finally {
    await context.close().catch(() => undefined);
  }
}
