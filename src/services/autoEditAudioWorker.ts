'use client';

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';

const WINDOW_MS = 20;

export interface PcmLevelAnalysisResult {
  levels: number[];
  analyzedDurationMs: number;
  workerUsed: boolean;
}

interface PcmChunkWorkerMessage {
  type: 'ack' | 'result' | 'error';
  id?: number;
  levels?: number[];
  analyzedFrames?: number;
  message?: string;
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('The operation was aborted.', 'AbortError');
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function rmsWorkerSource(): string {
  return `
let sampleRate = 0;
let framesPerWindow = 1;
let maxFrames = 0;
let analyzedFrames = 0;
let framesInWindow = 0;
let sumSquares = 0;
let valueCount = 0;
const levels = [];

function flushWindow() {
  if (valueCount === 0) return;
  const rms = Math.sqrt(sumSquares / valueCount);
  levels.push(20 * Math.log10(Math.max(rms, 1e-6)));
  framesInWindow = 0;
  sumSquares = 0;
  valueCount = 0;
}

self.onmessage = (event) => {
  try {
    const message = event.data;
    if (message.type === 'init') {
      sampleRate = message.sampleRate;
      framesPerWindow = Math.max(1, Math.round(sampleRate * ${WINDOW_MS / 1000}));
      maxFrames = message.maxFrames;
      self.postMessage({ type: 'ack', id: message.id });
      return;
    }
    if (message.type === 'chunk') {
      const channels = message.buffers.map((buffer) => new Float32Array(buffer));
      const frameCount = Math.min(
        message.frameCount,
        Math.max(0, maxFrames - analyzedFrames),
        ...channels.map((channel) => channel.length),
      );
      for (let frame = 0; frame < frameCount; frame += 1) {
        for (const channel of channels) {
          const value = channel[frame] || 0;
          sumSquares += value * value;
          valueCount += 1;
        }
        analyzedFrames += 1;
        framesInWindow += 1;
        if (framesInWindow >= framesPerWindow) flushWindow();
      }
      self.postMessage({ type: 'ack', id: message.id });
      return;
    }
    if (message.type === 'finish') {
      flushWindow();
      self.postMessage({ type: 'result', levels, analyzedFrames });
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'audio_worker_failed' });
  }
};
`;
}

async function analyzePcmChunksOnMainThread(params: {
  chunks: AsyncIterable<Float32Array[]>;
  sampleRate: number;
  durationMs: number;
  signal?: AbortSignal;
}): Promise<PcmLevelAnalysisResult> {
  const framesPerWindow = Math.max(1, Math.round(params.sampleRate * (WINDOW_MS / 1000)));
  const maxFrames = Math.max(0, Math.round(params.sampleRate * (params.durationMs / 1000)));
  const levels: number[] = [];
  let analyzedFrames = 0;
  let framesInWindow = 0;
  let sumSquares = 0;
  let valueCount = 0;
  const flush = () => {
    if (valueCount === 0) return;
    levels.push(20 * Math.log10(Math.max(Math.sqrt(sumSquares / valueCount), 1e-6)));
    framesInWindow = 0;
    sumSquares = 0;
    valueCount = 0;
  };
  for await (const channels of params.chunks) {
    throwIfAborted(params.signal);
    const frameCount = Math.min(
      Math.max(0, maxFrames - analyzedFrames),
      ...channels.map((channel) => channel.length),
    );
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (const channel of channels) {
        const value = channel[frame] ?? 0;
        sumSquares += value * value;
        valueCount += 1;
      }
      analyzedFrames += 1;
      framesInWindow += 1;
      if (framesInWindow >= framesPerWindow) flush();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (analyzedFrames >= maxFrames) break;
  }
  flush();
  return {
    levels,
    analyzedDurationMs: analyzedFrames / params.sampleRate * 1000,
    workerUsed: false,
  };
}

/** Keeps the RMS loop off the UI thread while applying one-chunk backpressure. */
export async function analyzePcmChunksInWorker(params: {
  chunks: AsyncIterable<Float32Array[]>;
  sampleRate: number;
  durationMs: number;
  signal?: AbortSignal;
}): Promise<PcmLevelAnalysisResult> {
  throwIfAborted(params.signal);
  if (typeof Worker === 'undefined') return analyzePcmChunksOnMainThread(params);
  const url = URL.createObjectURL(new Blob([rmsWorkerSource()], { type: 'text/javascript' }));
  const worker = new Worker(url);
  const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let resultResolve: ((value: PcmLevelAnalysisResult) => void) | null = null;
  let resultReject: ((error: Error) => void) | null = null;
  const resultPromise = new Promise<PcmLevelAnalysisResult>((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  const cleanup = () => {
    params.signal?.removeEventListener('abort', abort);
    worker.terminate();
    URL.revokeObjectURL(url);
  };
  const fail = (error: Error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    resultReject?.(error);
  };
  const abort = () => fail(abortError());
  params.signal?.addEventListener('abort', abort, { once: true });
  worker.onerror = () => fail(new Error('audio_worker_failed'));
  worker.onmessage = (event: MessageEvent<PcmChunkWorkerMessage>) => {
    const message = event.data;
    if (message.type === 'ack' && message.id !== undefined) {
      pending.get(message.id)?.resolve();
      pending.delete(message.id);
      return;
    }
    if (message.type === 'error') {
      fail(new Error(message.message ?? 'audio_worker_failed'));
      return;
    }
    if (message.type === 'result') {
      resultResolve?.({
        levels: message.levels ?? [],
        analyzedDurationMs: (message.analyzedFrames ?? 0) / params.sampleRate * 1000,
        workerUsed: true,
      });
    }
  };
  const send = (message: Record<string, unknown>, transfer: Transferable[] = []) => new Promise<void>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...message, id }, transfer);
  });

  try {
    const maxFrames = Math.max(0, Math.round(params.sampleRate * (params.durationMs / 1000)));
    await send({ type: 'init', sampleRate: params.sampleRate, maxFrames });
    let sentFrames = 0;
    for await (const channels of params.chunks) {
      throwIfAborted(params.signal);
      const frameCount = Math.min(
        Math.max(0, maxFrames - sentFrames),
        ...channels.map((channel) => channel.length),
      );
      if (frameCount <= 0) break;
      const buffers = channels.map((channel) => {
        const copy = channel.length === frameCount ? channel : channel.slice(0, frameCount);
        return copy.buffer;
      });
      await send({ type: 'chunk', buffers, frameCount }, buffers);
      sentFrames += frameCount;
      if (sentFrames >= maxFrames) break;
    }
    worker.postMessage({ type: 'finish' });
    return await resultPromise;
  } finally {
    cleanup();
  }
}

/** Sequentially decodes compressed audio and transfers only one PCM chunk at a time to the RMS worker. */
export async function analyzeAudioBlobLevels(params: {
  blob: Blob;
  durationMs: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}): Promise<PcmLevelAnalysisResult> {
  throwIfAborted(params.signal);
  const input = new Input({
    source: new BlobSource(params.blob, { maxCacheSize: 4 * 1024 * 1024, useStreamReader: true }),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('audio_track_missing');
    const sampleRate = await track.getSampleRate();
    const sink = new AudioSampleSink(track);
    const chunks = async function* (): AsyncGenerator<Float32Array[]> {
      for await (const sample of sink.samples()) {
        try {
          throwIfAborted(params.signal);
          if (sample.timestamp * 1000 >= params.durationMs) break;
          const channels: Float32Array[] = [];
          for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
            const data = new Float32Array(sample.numberOfFrames);
            sample.copyTo(data, { planeIndex: channel, format: 'f32-planar' });
            channels.push(data);
          }
          params.onProgress?.(Math.max(0, Math.min(0.99, sample.timestamp * 1000 / Math.max(1, params.durationMs))));
          yield channels;
        } finally {
          sample.close();
        }
      }
    };
    const result = await analyzePcmChunksInWorker({ chunks: chunks(), sampleRate, durationMs: params.durationMs, signal: params.signal });
    params.onProgress?.(1);
    return result;
  } finally {
    input.dispose();
  }
}
