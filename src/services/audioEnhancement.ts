import type { EnhancedAudioTrack, NoiseReductionMode } from '@/types/recording';
import type { AudioRepairSettings } from '@/services/audioRepairDomain';
import { audioRepairSettingsFingerprint, normalizeAudioRepairSettings } from '@/services/audioRepairDomain';
import { summarizeAudioRepairDiagnosis, type AudioRepairDiagnosis } from '@/services/audioRepairDomain';
import { EXPORT_AUDIO_SAMPLE_RATE, validateProcessedAudioFrameCount } from '@/services/exportAudio';

export function audioSourceFingerprint(blob: Blob | null, durationMs: number): string {
  return `${blob?.size ?? 0}:${blob?.type ?? 'none'}:${Math.max(0, Math.round(durationMs))}`;
}

export function resolveEnhancedAudioSelection(
  original: Blob | null,
  tracks: EnhancedAudioTrack[],
  activeTrackId: string | null | undefined,
  sourceFingerprint: string,
): { blob: Blob | null; track: EnhancedAudioTrack | undefined } {
  if (!activeTrackId) return { blob: original, track: undefined };
  const track = tracks.find((candidate) => (
    candidate.id === activeTrackId
    && candidate.status === 'ready'
    && candidate.sourceFingerprint === sourceFingerprint
    && candidate.audioBlob.size > 0
  ));
  return track ? { blob: track.audioBlob, track } : { blob: original, track: undefined };
}

function wavHeader(sampleRate: number, sampleCount: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  const dataBytes = sampleCount * 2;
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataBytes, true);
  return buffer;
}

interface EnhanceOptions {
  recordingId: string;
  audioBlob: Blob;
  durationMs: number;
  mode: NoiseReductionMode;
  repairSettings?: AudioRepairSettings;
  signal?: AbortSignal;
  onProgress?: (phase: 'decoding' | 'loading_model' | 'processing' | 'encoding', progress: number) => void;
}

/** Bounded, stateful resampling for legacy/derived audio. Two source frames are
 * retained so a processing chunk boundary cannot become an audible seam. */
export class StreamingCubicResampler {
  private buffer = new Float32Array();
  private bufferStart = 0;
  private inputFrames = 0;
  private outputFrames = 0;
  private finalized = false;

  constructor(
    private readonly sourceSampleRate: number,
    private readonly targetSampleRate: number,
  ) {
    if (sourceSampleRate <= 0 || targetSampleRate <= 0) throw new Error('invalid_audio_sample_rate');
  }

  push(input: Float32Array): Float32Array {
    if (this.finalized) throw new Error('audio_resampler_finalized');
    if (input.length === 0) return new Float32Array();
    const next = new Float32Array(this.buffer.length + input.length);
    next.set(this.buffer);
    next.set(input, this.buffer.length);
    this.buffer = next;
    this.inputFrames += input.length;
    return this.produce(false);
  }

  flush(): Float32Array {
    if (this.finalized) return new Float32Array();
    this.finalized = true;
    return this.produce(true);
  }

  private sampleAt(index: number): number {
    const clamped = Math.max(0, Math.min(this.inputFrames - 1, index));
    const local = clamped - this.bufferStart;
    return this.buffer[Math.max(0, Math.min(this.buffer.length - 1, local))] ?? 0;
  }

  private produce(final: boolean): Float32Array {
    const limit = final
      ? Math.round(this.inputFrames * this.targetSampleRate / this.sourceSampleRate)
      : Math.max(this.outputFrames, Math.ceil(
          Math.max(0, this.inputFrames - 2) * this.targetSampleRate / this.sourceSampleRate,
        ));
    const output = new Float32Array(Math.max(0, limit - this.outputFrames));
    const firstOutputFrame = this.outputFrames;
    for (let offset = 0; offset < output.length; offset += 1) {
      const sourcePosition = (firstOutputFrame + offset) * this.sourceSampleRate / this.targetSampleRate;
      const base = Math.floor(sourcePosition);
      const fraction = sourcePosition - base;
      const p0 = this.sampleAt(base - 1);
      const p1 = this.sampleAt(base);
      const p2 = this.sampleAt(base + 1);
      const p3 = this.sampleAt(base + 2);
      const f2 = fraction * fraction;
      const f3 = f2 * fraction;
      output[offset] = 0.5 * (
        2 * p1
        + (-p0 + p2) * fraction
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * f3
      );
    }
    this.outputFrames = limit;

    const nextSourcePosition = this.outputFrames * this.sourceSampleRate / this.targetSampleRate;
    const keepFrom = Math.max(0, Math.floor(nextSourcePosition) - 1);
    const discard = Math.max(0, Math.min(this.buffer.length, keepFrom - this.bufferStart));
    if (discard > 0) {
      this.buffer = this.buffer.slice(discard);
      this.bufferStart += discard;
    }
    return output;
  }
}

async function* decodeMonoChunks(options: EnhanceOptions, targetSampleRate: number): AsyncGenerator<Float32Array> {
  const { ALL_FORMATS, AudioSampleSink, BlobSource, Input } = await import('mediabunny');
  const input = new Input({
    source: new BlobSource(options.audioBlob, { maxCacheSize: 4 * 1024 * 1024, useStreamReader: true }),
    formats: ALL_FORMATS,
  });
  const chunkSamples = Math.max(480, Math.round(targetSampleRate * 2 / 480) * 480);
  let pending = new Float32Array(chunkSamples);
  let pendingLength = 0;
  let resampler: StreamingCubicResampler | null = null;
  let sourceSampleRate: number | null = null;
  const appendResampled = (resampled: Float32Array): Float32Array[] => {
    const completed: Float32Array[] = [];
    let offset = 0;
    while (offset < resampled.length) {
      const copyLength = Math.min(pending.length - pendingLength, resampled.length - offset);
      pending.set(resampled.subarray(offset, offset + copyLength), pendingLength);
      pendingLength += copyLength;
      offset += copyLength;
      if (pendingLength === pending.length) {
        completed.push(pending);
        pending = new Float32Array(chunkSamples);
        pendingLength = 0;
      }
    }
    return completed;
  };
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('audio_track_missing');
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples()) {
      try {
        if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        const mono = new Float32Array(sample.numberOfFrames);
        for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
          const plane = new Float32Array(sample.numberOfFrames);
          sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
          for (let index = 0; index < mono.length; index += 1) mono[index] += plane[index] / sample.numberOfChannels;
        }
        if (!resampler) {
          sourceSampleRate = sample.sampleRate;
          resampler = new StreamingCubicResampler(sample.sampleRate, targetSampleRate);
        }
        if (sample.sampleRate !== sourceSampleRate) throw new Error('audio_sample_rate_changed');
        for (const completed of appendResampled(resampler.push(mono))) yield completed;
        options.onProgress?.('decoding', Math.max(0.02, Math.min(0.94, sample.timestamp * 1000 / Math.max(1, options.durationMs))));
      } finally {
        sample.close();
      }
    }
    if (resampler) {
      for (const completed of appendResampled(resampler.flush())) yield completed;
    }
    if (pendingLength > 0) yield pending.slice(0, pendingLength);
  } finally {
    input.dispose();
  }
}

export async function analyzeAudioRepairSource(
  audioBlob: Blob,
  durationMs: number,
  signal?: AbortSignal,
): Promise<AudioRepairDiagnosis> {
  let samples = 0;
  let highFrequencyEnergy = 0;
  let totalEnergy = 0;
  let clicks = 0;
  let clipped = 0;
  let lowFrequencyEnergy = 0;
  let previous = 0;
  let lowPassed = 0;
  for await (const chunk of decodeMonoChunks({ recordingId: 'diagnosis', audioBlob, durationMs, mode: 'standard', signal }, 16_000)) {
    for (let index = 0; index < chunk.length; index += 1) {
      const sample = chunk[index];
      const delta = sample - previous;
      lowPassed += (sample - lowPassed) * 0.018;
      totalEnergy += sample * sample;
      highFrequencyEnergy += delta * delta;
      lowFrequencyEnergy += lowPassed * lowPassed;
      if (Math.abs(delta) > 0.32) clicks += 1;
      if (Math.abs(sample) > 0.985) clipped += 1;
      previous = sample;
      samples += 1;
    }
    if (samples >= 30 * 16_000) break;
  }
  const energy = Math.max(1e-8, totalEnergy);
  return summarizeAudioRepairDiagnosis({
    highFrequencyRatio: highFrequencyEnergy / energy,
    clickRate: clicks / Math.max(1, samples),
    clippedRatio: clipped / Math.max(1, samples),
    humRatio: lowFrequencyEnergy / energy,
  });
}

export async function createEnhancedAudioTrack(options: EnhanceOptions): Promise<EnhancedAudioTrack> {
  const targetSampleRate = EXPORT_AUDIO_SAMPLE_RATE;
  const { createAudioEnhancementWorker } = await import('@/services/audioEnhancementWorkerFactory');
  const worker = createAudioEnhancementWorker();
  const abort = () => worker.terminate();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.onProgress?.('decoding', 0.02);
    options.onProgress?.(options.mode === 'enhanced' ? 'loading_model' : 'processing', 0.08);

    const pcmParts: BlobPart[] = [];
    let processedSamples = 0;
    let decodedSamples = 0;
    let peak = 0;
    let energy = 0;
    let requestId = 0;
    const expectedSamples = Math.max(1, Math.round(options.durationMs / 1000 * targetSampleRate));
    for await (const mixed of decodeMonoChunks(options, targetSampleRate)) {
      if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const inputSampleCount = mixed.length;
      decodedSamples += inputSampleCount;
      const currentRequestId = ++requestId;
      const result = await new Promise<Int16Array>((resolve, reject) => {
        const cleanup = () => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onWorkerError);
          options.signal?.removeEventListener('abort', onRequestAbort);
        };
        const onMessage = (event: MessageEvent<{ type: string; requestId: number; samples?: Int16Array; error?: string }>) => {
          if (event.data.requestId !== currentRequestId) return;
          cleanup();
          if (event.data.type === 'error') reject(new Error(event.data.error ?? 'audio_enhancement_failed'));
          else resolve(event.data.samples ?? new Int16Array());
        };
        const onWorkerError = () => {
          cleanup();
          reject(new Error('audio_enhancement_worker_failed'));
        };
        const onRequestAbort = () => {
          cleanup();
          reject(new DOMException('Cancelled', 'AbortError'));
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onWorkerError, { once: true });
        options.signal?.addEventListener('abort', onRequestAbort, { once: true });
        worker.postMessage({
          type: 'process', requestId: currentRequestId, mode: options.mode, samples: mixed,
          sampleRate: targetSampleRate, repairSettings: options.repairSettings,
        }, [mixed.buffer]);
      });
      validateProcessedAudioFrameCount(inputSampleCount, result.length, 0);
      for (let index = 0; index < result.length; index += 1) {
        const absolute = Math.abs(result[index]);
        peak = Math.max(peak, absolute);
        energy += absolute * absolute;
      }
      processedSamples += result.length;
      const bytes = new Uint8Array(result.byteLength);
      bytes.set(new Uint8Array(result.buffer, result.byteOffset, result.byteLength));
      pcmParts.push(bytes.buffer);
      options.onProgress?.('processing', 0.08 + 0.86 * Math.min(1, processedSamples / expectedSamples));
    }

    options.onProgress?.('encoding', 0.96);
    const rms = processedSamples > 0 ? Math.sqrt(energy / processedSamples) : 0;
    if (processedSamples === 0 || peak < 64 || rms < 8) throw new Error('audio_enhancement_silent_output');
    validateProcessedAudioFrameCount(decodedSamples, processedSamples, 0);
    const audioBlob = new Blob([wavHeader(targetSampleRate, processedSamples), ...pcmParts], { type: 'audio/wav' });
    const durationMs = Math.round((processedSamples / targetSampleRate) * 1000);
    options.onProgress?.('encoding', 1);
    return {
      id: `enh-${options.recordingId}-${options.repairSettings ? 'repair' : options.mode}-${Date.now().toString(36)}`,
      recordingId: options.recordingId,
      sourceFingerprint: audioSourceFingerprint(options.audioBlob, options.durationMs),
      mode: options.repairSettings ? 'repair' : options.mode,
      settingsFingerprint: options.repairSettings ? audioRepairSettingsFingerprint(options.repairSettings) : undefined,
      repairSettings: options.repairSettings ? normalizeAudioRepairSettings(options.repairSettings) : undefined,
      modelVersion: options.repairSettings ? 'voice-repair-v1' : options.mode === 'enhanced' ? 'rnnoise-wasm-2025.1.5' : 'speech-cleanup-v1',
      status: 'ready',
      durationMs,
      sampleRate: targetSampleRate,
      channelCount: 1,
      totalFrames: processedSamples,
      audioBlob,
      createdAt: Date.now(),
    };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    try { worker.postMessage({ type: 'dispose' }); } catch { /* already terminated by cancellation */ }
    worker.terminate();
  }
}
