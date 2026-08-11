'use client';

import { getCursorFocusTrack, saveCursorFocusTrack } from '@/lib/db-client';
import { createDisplayFrameSource } from '@/services/displayFrameSource';
import type { CursorFocusSample, CursorFocusTrack } from '@/types/recording';

const DETECTOR_VERSION = 1;
const SAMPLE_INTERVAL_MS = 100;
const MAX_SAMPLE_EDGE = 960;
const MIN_CONFIDENCE = 0.2;
const HOLD_GAP_MS = 1_000;
const RETURN_TO_CENTER_MS = 500;
const activeAnalyses = new Map<string, Promise<CursorFocusTrack>>();

export interface FocusPoint {
  x: number;
  y: number;
  confidence: number;
}

interface PendingFocusRequest {
  timestamp: number;
  resolve: (sample: CursorFocusSample) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PendingFocusRequests {
  private readonly requests = new Map<number, PendingFocusRequest>();

  get size(): number {
    return this.requests.size;
  }

  create(id: number, timestamp: number, timeoutMs = 8_000): Promise<CursorFocusSample> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.resolve(id, this.fallback(timestamp)), timeoutMs);
      this.requests.set(id, { timestamp, resolve, timer });
    });
  }

  resolve(id: number, sample: CursorFocusSample): void {
    const request = this.requests.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    this.requests.delete(id);
    request.resolve(sample);
  }

  failAll(): void {
    for (const [id, request] of this.requests) this.resolve(id, this.fallback(request.timestamp));
  }

  private fallback(timestamp: number): CursorFocusSample {
    return { timestamp, x: 0.5, y: 0.5, confidence: 0 };
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function focusPointAt(track: CursorFocusTrack | null | undefined, timestamp: number): FocusPoint {
  const samples = track?.samples.filter((sample) => sample.confidence >= MIN_CONFIDENCE) ?? [];
  if (samples.length === 0) return { x: 0.5, y: 0.5, confidence: 0 };

  let previous: CursorFocusSample | null = null;
  let next: CursorFocusSample | null = null;
  for (const sample of samples) {
    if (sample.timestamp <= timestamp) previous = sample;
    if (sample.timestamp >= timestamp) {
      next = sample;
      break;
    }
  }

  if (previous && next && next.timestamp > previous.timestamp && next.timestamp - previous.timestamp <= HOLD_GAP_MS) {
    const progress = clamp01((timestamp - previous.timestamp) / (next.timestamp - previous.timestamp));
    return {
      x: round(previous.x + (next.x - previous.x) * progress),
      y: round(previous.y + (next.y - previous.y) * progress),
      confidence: round(previous.confidence + (next.confidence - previous.confidence) * progress),
    };
  }

  const anchor = previous ?? next;
  if (!anchor) return { x: 0.5, y: 0.5, confidence: 0 };
  const distance = Math.abs(timestamp - anchor.timestamp);
  if (distance <= HOLD_GAP_MS) {
    return { x: round(anchor.x), y: round(anchor.y), confidence: round(anchor.confidence) };
  }
  const returnProgress = clamp01((distance - HOLD_GAP_MS) / RETURN_TO_CENTER_MS);
  const eased = 1 - Math.pow(1 - returnProgress, 3);
  return {
    x: round(anchor.x + (0.5 - anchor.x) * eased),
    y: round(anchor.y + (0.5 - anchor.y) * eased),
    confidence: round(anchor.confidence * (1 - eased)),
  };
}

export function focusedCoverPlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  focus: { x: number; y: number },
): { dx: number; dy: number; dw: number; dh: number; scale: number } {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const dw = sourceWidth * scale;
  const dh = sourceHeight * scale;
  const dx = Math.max(targetWidth - dw, Math.min(0, targetWidth / 2 - clamp01(focus.x) * dw));
  const dy = Math.max(targetHeight - dh, Math.min(0, targetHeight / 2 - clamp01(focus.y) * dh));
  return { dx, dy, dw, dh, scale };
}

export function cursorFocusSourceSignature(blob: Blob, durationMs: number, width: number, height: number): string {
  return `${DETECTOR_VERSION}:${blob.size}:${blob.type}:${Math.round(durationMs)}:${width}x${height}`;
}

export interface CursorFocusExportAnalyzer {
  analyzeFrame(frame: CanvasImageSource, timestamp: number): Promise<FocusPoint>;
  save(): Promise<CursorFocusTrack>;
  close(): void;
}

/** Uses frames already decoded for export so uncached tracking does not scan the media twice. */
export function createCursorFocusExportAnalyzer(params: {
  recordingId: string;
  screenBlob: Blob;
  durationMs: number;
  sourceWidth: number;
  sourceHeight: number;
}): CursorFocusExportAnalyzer | null {
  const scale = Math.min(1, MAX_SAMPLE_EDGE / Math.max(params.sourceWidth, params.sourceHeight));
  const width = Math.max(2, Math.round(params.sourceWidth * scale));
  const height = Math.max(2, Math.round(params.sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const worker = createPixelWorker();
  if (!context || !worker) {
    worker?.close();
    return null;
  }

  const signature = cursorFocusSourceSignature(
    params.screenBlob,
    params.durationMs,
    params.sourceWidth,
    params.sourceHeight,
  );
  const samples: CursorFocusSample[] = [];
  let lastSampleAt = -Infinity;
  let smoothX = 0.5;
  let smoothY = 0.5;
  let closed = false;

  const buildTrack = (): CursorFocusTrack => {
    const confident = samples.filter((sample) => sample.confidence >= MIN_CONFIDENCE).length;
    const coverage = confident / Math.max(1, samples.length);
    return {
      recordingId: params.recordingId,
      detectorVersion: DETECTOR_VERSION,
      sourceSignature: signature,
      analyzedAt: Date.now(),
      quality: coverage >= 0.7 ? 'good' : coverage >= 0.35 ? 'partial' : 'poor',
      samples: [...samples],
    };
  };

  return {
    async analyzeFrame(frame, timestamp) {
      if (closed) return { x: 0.5, y: 0.5, confidence: 0 };
      if (timestamp - lastSampleAt >= SAMPLE_INTERVAL_MS || samples.length === 0) {
        context.drawImage(frame, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        const raw = await worker.analyze(new Uint8ClampedArray(pixels), width, height, timestamp);
        let sample = raw;
        if (raw.confidence >= MIN_CONFIDENCE) {
          const weight = Math.max(0.18, Math.min(0.58, raw.confidence * 0.55));
          smoothX += (raw.x - smoothX) * weight;
          smoothY += (raw.y - smoothY) * weight;
          sample = {
            ...raw,
            x: round(clamp01(smoothX)),
            y: round(clamp01(smoothY)),
            confidence: round(raw.confidence),
          };
        }
        samples.push(sample);
        lastSampleAt = timestamp;
      }
      return focusPointAt(buildTrack(), timestamp);
    },
    async save() {
      const track = buildTrack();
      await saveCursorFocusTrack(track);
      return track;
    },
    close() {
      if (closed) return;
      closed = true;
      worker.close();
    },
  };
}

function workerSource(): string {
  return `
    let previous = null;
    let last = null;
    self.onmessage = (event) => {
      const { id, pixels, width, height, timestamp } = event.data;
      const current = new Uint8ClampedArray(pixels);
      if (!previous) {
        previous = current;
        self.postMessage({ id, sample: { timestamp, x: .5, y: .5, confidence: 0 } });
        return;
      }
      const tile = 8;
      const cols = Math.ceil(width / tile);
      const rows = Math.ceil(height / tile);
      const counts = new Uint16Array(cols * rows);
      const sumsX = new Uint32Array(cols * rows);
      const sumsY = new Uint32Array(cols * rows);
      let changed = 0;
      for (let y = 1; y < height - 1; y += 2) {
        for (let x = 1; x < width - 1; x += 2) {
          const offset = (y * width + x) * 4;
          const delta = Math.abs(current[offset] - previous[offset])
            + Math.abs(current[offset + 1] - previous[offset + 1])
            + Math.abs(current[offset + 2] - previous[offset + 2]);
          if (delta < 105) continue;
          const cell = Math.floor(y / tile) * cols + Math.floor(x / tile);
          counts[cell] += 1;
          sumsX[cell] += x;
          sumsY[cell] += y;
          changed += 1;
        }
      }
      let best = -1;
      let bestScore = 0;
      const changedRatio = changed / Math.max(1, width * height / 4);
      if (changedRatio < .18) {
        for (let cell = 0; cell < counts.length; cell += 1) {
          const count = counts[cell];
          if (count < 3 || count > 58) continue;
          const x = sumsX[cell] / count / width;
          const y = sumsY[cell] / count / height;
          const distance = last ? Math.hypot(x - last.x, y - last.y) : 0;
          const continuity = last ? Math.max(0, 1 - distance * 3.5) : .55;
          const compactness = 1 - Math.abs(count - 18) / 45;
          const score = count * (.45 + continuity) * Math.max(.2, compactness);
          if (score > bestScore) {
            bestScore = score;
            best = cell;
          }
        }
      }
      let sample;
      if (best >= 0) {
        const count = counts[best];
        const x = sumsX[best] / count / width;
        const y = sumsY[best] / count / height;
        const confidence = Math.min(.96, .22 + bestScore / 65);
        sample = { timestamp, x, y, confidence };
        last = sample;
      } else {
        sample = { timestamp, x: last ? last.x : .5, y: last ? last.y : .5, confidence: 0 };
      }
      previous = current;
      self.postMessage({ id, sample });
    };
  `;
}

function createPixelWorker(): {
  analyze: (pixels: Uint8ClampedArray, width: number, height: number, timestamp: number) => Promise<CursorFocusSample>;
  close: () => void;
} | null {
  if (typeof Worker === 'undefined') return null;
  const url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
  const worker = new Worker(url);
  let nextId = 1;
  let failed = false;
  const pending = new PendingFocusRequests();
  worker.onmessage = (event: MessageEvent<{ id: number; sample: CursorFocusSample }>) => {
    pending.resolve(event.data.id, event.data.sample);
  };
  worker.onerror = () => {
    failed = true;
    pending.failAll();
    worker.terminate();
    URL.revokeObjectURL(url);
  };
  return {
    analyze: (pixels, width, height, timestamp) => {
      if (failed) return Promise.resolve({ timestamp, x: 0.5, y: 0.5, confidence: 0 });
      const id = nextId++;
      const result = pending.create(id, timestamp);
      try {
        worker.postMessage({ id, pixels: pixels.buffer, width, height, timestamp }, [pixels.buffer]);
      } catch {
        failed = true;
        pending.failAll();
      }
      return result;
    },
    close: () => {
      failed = true;
      pending.failAll();
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

function smoothSamples(samples: CursorFocusSample[]): CursorFocusSample[] {
  let x = 0.5;
  let y = 0.5;
  return samples.map((sample) => {
    if (sample.confidence < MIN_CONFIDENCE) return sample;
    const weight = Math.max(0.18, Math.min(0.58, sample.confidence * 0.55));
    x += (sample.x - x) * weight;
    y += (sample.y - y) * weight;
    return { ...sample, x: round(clamp01(x)), y: round(clamp01(y)), confidence: round(sample.confidence) };
  });
}

export async function analyzeCursorFocusTrack(params: {
  recordingId: string;
  screenBlob: Blob;
  durationMs: number;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<CursorFocusTrack> {
  const source = await createDisplayFrameSource(params.screenBlob);
  const signature = cursorFocusSourceSignature(params.screenBlob, params.durationMs, source.width, source.height);
  const cached = await getCursorFocusTrack(params.recordingId);
  if (cached?.detectorVersion === DETECTOR_VERSION && cached.sourceSignature === signature) {
    params.onProgress?.(1);
    source.close();
    return cached;
  }

  const existing = activeAnalyses.get(params.recordingId);
  if (existing) {
    source.close();
    return existing;
  }

  const analysis = (async () => {
    const scale = Math.min(1, MAX_SAMPLE_EDGE / Math.max(source.width, source.height));
    const width = Math.max(2, Math.round(source.width * scale));
    const height = Math.max(2, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      source.close();
      throw new Error('cursor_tracking_canvas_unavailable');
    }
    const worker = createPixelWorker();
    if (!worker) {
      source.close();
      throw new Error('cursor_tracking_worker_unavailable');
    }
    const durationMs = Math.max(0, params.durationMs);
    const sampleCount = Math.max(1, Math.ceil(durationMs / SAMPLE_INTERVAL_MS));
    const samples: CursorFocusSample[] = [];
    try {
      for (let index = 0; index <= sampleCount; index += 1) {
        if (params.signal?.aborted) throw new DOMException('Cursor analysis cancelled', 'AbortError');
        const timestamp = Math.min(durationMs, index * SAMPLE_INTERVAL_MS);
        const frame = await source.getFrameAt(timestamp);
        if (!frame) continue;
        context.drawImage(frame, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        samples.push(await worker.analyze(new Uint8ClampedArray(pixels), width, height, timestamp));
        params.onProgress?.(Math.min(1, (index + 1) / (sampleCount + 1)));
        if (index % 12 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    } finally {
      worker.close();
      source.close();
    }
    const smoothed = smoothSamples(samples);
    const confident = smoothed.filter((sample) => sample.confidence >= MIN_CONFIDENCE).length;
    const coverage = confident / Math.max(1, smoothed.length);
    const track: CursorFocusTrack = {
      recordingId: params.recordingId,
      detectorVersion: DETECTOR_VERSION,
      sourceSignature: signature,
      analyzedAt: Date.now(),
      quality: coverage >= 0.7 ? 'good' : coverage >= 0.35 ? 'partial' : 'poor',
      samples: smoothed,
    };
    await saveCursorFocusTrack(track);
    params.onProgress?.(1);
    return track;
  })();

  activeAnalyses.set(params.recordingId, analysis);
  try {
    return await analysis;
  } finally {
    activeAnalyses.delete(params.recordingId);
  }
}
