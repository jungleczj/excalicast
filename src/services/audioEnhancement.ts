import type { EnhancedAudioTrack, NoiseReductionMode } from '@/types/recording';
import type { AudioRepairSettings } from '@/services/audioRepairDomain';
import { audioRepairSettingsFingerprint, normalizeAudioRepairSettings } from '@/services/audioRepairDomain';
import { summarizeAudioRepairDiagnosis, type AudioRepairDiagnosis } from '@/services/audioRepairDomain';

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

interface ResamplerState {
  sourceSampleRate: number | null;
  inputFrames: number;
  outputFrames: number;
  previousSample: number;
}

function resampleMonoChunk(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
  state: ResamplerState,
): Float32Array {
  if (state.sourceSampleRate === null) state.sourceSampleRate = sourceSampleRate;
  if (state.sourceSampleRate !== sourceSampleRate) throw new Error('audio_sample_rate_changed');
  if (input.length === 0) return new Float32Array();

  const inputStart = state.inputFrames;
  const inputEnd = inputStart + input.length;
  const targetEnd = Math.round(inputEnd * targetSampleRate / sourceSampleRate);
  const output = new Float32Array(Math.max(0, targetEnd - state.outputFrames));
  for (let index = 0; index < output.length; index += 1) {
    const sourcePosition = (state.outputFrames + index) * sourceSampleRate / targetSampleRate - inputStart;
    const lowerIndex = Math.floor(sourcePosition);
    const upperIndex = Math.ceil(sourcePosition);
    const lower = lowerIndex < 0 ? state.previousSample : input[Math.min(input.length - 1, lowerIndex)];
    const upper = upperIndex < 0 ? state.previousSample : input[Math.min(input.length - 1, upperIndex)];
    const fraction = sourcePosition - lowerIndex;
    output[index] = lower + (upper - lower) * fraction;
  }
  state.inputFrames = inputEnd;
  state.outputFrames = targetEnd;
  state.previousSample = input[input.length - 1];
  return output;
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
  const resampler: ResamplerState = {
    sourceSampleRate: null,
    inputFrames: 0,
    outputFrames: 0,
    previousSample: 0,
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
        const resampled = resampleMonoChunk(mono, sample.sampleRate, targetSampleRate, resampler);
        let offset = 0;
        while (offset < resampled.length) {
          const copyLength = Math.min(pending.length - pendingLength, resampled.length - offset);
          pending.set(resampled.subarray(offset, offset + copyLength), pendingLength);
          pendingLength += copyLength;
          offset += copyLength;
          if (pendingLength === pending.length) {
            yield pending;
            pending = new Float32Array(chunkSamples);
            pendingLength = 0;
          }
        }
        options.onProgress?.('decoding', Math.max(0.02, Math.min(0.94, sample.timestamp * 1000 / Math.max(1, options.durationMs))));
      } finally {
        sample.close();
      }
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
  const targetSampleRate = 48_000;
  const { createAudioEnhancementWorker } = await import('@/services/audioEnhancementWorkerFactory');
  const worker = createAudioEnhancementWorker();
  const abort = () => worker.terminate();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.onProgress?.('decoding', 0.02);
    options.onProgress?.(options.mode === 'enhanced' ? 'loading_model' : 'processing', 0.08);

    const pcmParts: BlobPart[] = [];
    let processedSamples = 0;
    let peak = 0;
    let energy = 0;
    let requestId = 0;
    const expectedSamples = Math.max(1, Math.round(options.durationMs / 1000 * targetSampleRate));
    for await (const mixed of decodeMonoChunks(options, targetSampleRate)) {
      if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
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
    const audioBlob = new Blob([wavHeader(targetSampleRate, processedSamples), ...pcmParts], { type: 'audio/wav' });
    const durationMs = Math.round((processedSamples / targetSampleRate) * 1000);
    if (Math.abs(durationMs - options.durationMs) > Math.max(1_000, options.durationMs * 0.02)) throw new Error('audio_enhancement_duration_mismatch');
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
      audioBlob,
      createdAt: Date.now(),
    };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    try { worker.postMessage({ type: 'dispose' }); } catch { /* already terminated by cancellation */ }
    worker.terminate();
  }
}
