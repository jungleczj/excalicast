'use client';

import { createCameraFrameSource } from '@/services/webmCameraFrames';
import type { TimeSegment } from '@/types/recording';
import { normalizeSegments } from '@/utils/segments';

export interface SceneTransition {
  timeMs: number;
  score: number;
}

export type SceneAnalysisStage = 'scene_coarse' | 'scene_refine';

export interface SequentialSceneFrame {
  timeMs: number;
  pixels: Uint8ClampedArray;
}

export interface SceneAnalysisProgress {
  stage: SceneAnalysisStage;
  progress: number;
  etaMs: number | null;
}

export interface SceneAnalysisDiagnostics {
  sourceFrames: number;
  coarseSamples: number;
  retainedFineSamples: number;
  refinedSamples: number;
}

export interface SequentialSceneAnalysisResult {
  transitions: SceneTransition[];
  diagnostics: SceneAnalysisDiagnostics;
}

export interface SceneAnalysisOptions {
  signal?: AbortSignal;
  onProgress?: (stage: SceneAnalysisStage, progress: number, etaMs: number | null) => void;
  frameSource?: AsyncIterable<SequentialSceneFrame>;
}

const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 36;
const MIN_SCENE_DISTANCE_MS = 760;
const MAX_COARSE_SAMPLES = 600;
const MAX_FINE_SAMPLES = 2_400;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function frameDifference(previous: Uint8ClampedArray, next: Uint8ClampedArray): number {
  let total = 0;
  let count = 0;
  for (let index = 0; index < previous.length; index += 16) {
    total += Math.abs(previous[index] - next[index]);
    total += Math.abs(previous[index + 1] - next[index + 1]);
    total += Math.abs(previous[index + 2] - next[index + 2]);
    count += 3;
  }
  return total / Math.max(1, count);
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

function reportProgress(
  options: SceneAnalysisOptions,
  stage: SceneAnalysisStage,
  progress: number,
  startedAt: number,
): void {
  const bounded = Math.max(0, Math.min(1, progress));
  const elapsed = performance.now() - startedAt;
  const etaMs = bounded <= 0.01 ? null : Math.max(0, Math.round((elapsed / bounded) * (1 - bounded)));
  options.onProgress?.(stage, bounded, etaMs);
}

interface RetainedSample {
  timeMs: number;
  pixels: Uint8ClampedArray;
}

interface CandidateWindow {
  startMs: number;
  endMs: number;
}

function findCoarseCandidates(samples: RetainedSample[]): CandidateWindow[] {
  const candidates: CandidateWindow[] = [];
  const recentScores: number[] = [];
  let lastCandidateMs = -MIN_SCENE_DISTANCE_MS;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const score = frameDifference(previous.pixels, current.pixels);
    const baseline = median(recentScores.slice(-12));
    const threshold = Math.max(10, baseline * 1.85 + 4.5);
    const sparseHighContrastCut = recentScores.length < 3 && score >= 24;
    if ((score >= threshold && recentScores.length >= 3 || sparseHighContrastCut)
      && current.timeMs - lastCandidateMs >= MIN_SCENE_DISTANCE_MS) {
      candidates.push({ startMs: previous.timeMs, endMs: current.timeMs });
      lastCandidateMs = current.timeMs;
    }
    recentScores.push(score);
  }
  return candidates;
}

/** Consume an ordered frame stream once, then refine only coarse candidate windows. */
export async function analyzeSequentialSceneFrames(
  frames: AsyncIterable<SequentialSceneFrame>,
  recordingDurationMs: number,
  options: SceneAnalysisOptions = {},
): Promise<SequentialSceneAnalysisResult> {
  const durationMs = Math.max(1, recordingDurationMs);
  const fineIntervalMs = Math.max(100, durationMs / Math.max(1, MAX_FINE_SAMPLES - 1));
  const coarseIntervalMs = Math.max(fineIntervalMs, durationMs / Math.max(1, MAX_COARSE_SAMPLES - 1));
  const fineSamples: RetainedSample[] = [];
  const coarseSamples: RetainedSample[] = [];
  const startedAt = performance.now();
  let nextFineMs = 0;
  let nextCoarseMs = 0;
  let sourceFrames = 0;
  let lastTimeMs = -1;

  for await (const frame of frames) {
    throwIfAborted(options.signal);
    if (frame.timeMs < lastTimeMs) throw new Error('scene_frames_not_monotonic');
    lastTimeMs = frame.timeMs;
    sourceFrames += 1;
    if (frame.timeMs >= nextFineMs && fineSamples.length < MAX_FINE_SAMPLES) {
      fineSamples.push({ timeMs: frame.timeMs, pixels: new Uint8ClampedArray(frame.pixels) });
      nextFineMs = frame.timeMs + fineIntervalMs;
    }
    if (frame.timeMs >= nextCoarseMs && coarseSamples.length < MAX_COARSE_SAMPLES) {
      coarseSamples.push({ timeMs: frame.timeMs, pixels: new Uint8ClampedArray(frame.pixels) });
      nextCoarseMs = frame.timeMs + coarseIntervalMs;
    }
    if (sourceFrames % 24 === 0) {
      reportProgress(options, 'scene_coarse', Math.min(0.99, frame.timeMs / durationMs), startedAt);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  throwIfAborted(options.signal);
  reportProgress(options, 'scene_coarse', 1, startedAt);
  const candidates = findCoarseCandidates(coarseSamples);
  const transitions: SceneTransition[] = [];
  let refinedSamples = 0;
  let lastTransitionMs = -MIN_SCENE_DISTANCE_MS;
  const refineStartedAt = performance.now();

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    throwIfAborted(options.signal);
    const candidate = candidates[candidateIndex];
    const local = fineSamples.filter((sample) => (
      sample.timeMs >= candidate.startMs - fineIntervalMs
      && sample.timeMs <= candidate.endMs + fineIntervalMs
    ));
    refinedSamples += local.length;
    let best: SceneTransition | null = null;
    for (let index = 1; index < local.length; index += 1) {
      const score = frameDifference(local[index - 1].pixels, local[index].pixels);
      if (!best || score > best.score) best = { timeMs: local[index].timeMs, score };
    }
    if (best && best.score >= 10 && best.timeMs - lastTransitionMs >= MIN_SCENE_DISTANCE_MS) {
      transitions.push({ timeMs: best.timeMs, score: Math.round(best.score * 100) / 100 });
      lastTransitionMs = best.timeMs;
    }
    reportProgress(options, 'scene_refine', (candidateIndex + 1) / Math.max(1, candidates.length), refineStartedAt);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (candidates.length === 0) reportProgress(options, 'scene_refine', 1, refineStartedAt);

  return {
    transitions,
    diagnostics: {
      sourceFrames,
      coarseSamples: coarseSamples.length,
      retainedFineSamples: fineSamples.length,
      refinedSamples,
    },
  };
}

function createPixelReader(): (frame: CanvasImageSource) => Uint8ClampedArray {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context) return (frame) => {
      context.drawImage(frame, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      return new Uint8ClampedArray(context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data);
    };
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context) return (frame) => {
      context.drawImage(frame, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      return new Uint8ClampedArray(context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data);
    };
  }
  throw new Error('scene_canvas_unavailable');
}

async function* sequentialFramesFromBlob(
  blob: Blob,
  recordingDurationMs: number,
  signal?: AbortSignal,
): AsyncGenerator<SequentialSceneFrame> {
  const source = await createCameraFrameSource(blob);
  const readPixels = createPixelReader();
  const sampleIntervalMs = Math.max(100, recordingDurationMs / Math.max(1, MAX_FINE_SAMPLES - 1));
  let nextSampleMs = 0;
  let timestampOffsetMs = 0;
  let lastRawTimeMs = -1;
  let lastTimeMs = -1;
  try {
    for await (const frame of source.frames()) {
      throwIfAborted(signal);
      const rawTimeMs = Math.max(0, Number(frame.timestamp ?? 0) / 1_000);
      if (lastRawTimeMs >= 0 && rawTimeMs < lastRawTimeMs - 1) {
        timestampOffsetMs = lastTimeMs + 1 - rawTimeMs;
      }
      const timeMs = Math.max(lastTimeMs + 1, rawTimeMs + timestampOffsetMs);
      lastRawTimeMs = rawTimeMs;
      lastTimeMs = timeMs;
      if (timeMs < nextSampleMs) continue;
      nextSampleMs = timeMs + sampleIntervalMs;
      yield {
        timeMs,
        pixels: readPixels(frame as CanvasImageSource),
      };
    }
  } finally {
    source.close();
  }
}

/** Local-only sequential scene detection; never seeks an HTMLVideo element. */
export async function detectPySceneTransitions(
  blob: Blob | null,
  recordingDurationMs: number,
  options: SceneAnalysisOptions = {},
): Promise<SceneTransition[]> {
  if (!blob || blob.size === 0) return [];
  throwIfAborted(options.signal);
  const frames = options.frameSource ?? sequentialFramesFromBlob(blob, recordingDurationMs, options.signal);
  return (await analyzeSequentialSceneFrames(frames, recordingDurationMs, options)).transitions;
}

/**
 * 将音频静音剪辑的边缘吸附到附近的画面转场。它不会凭空删掉画面，
 * 只微调已经存在的剪辑边界，因此用户得到更自然的镜头跳切。
 */
export function snapCutsToPySceneTransitions(params: {
  segments: TimeSegment[];
  durationMs: number;
  transitions: SceneTransition[];
  radiusMs?: number;
}): { segments: TimeSegment[]; adjustedCuts: number } {
  const radiusMs = params.radiusMs ?? 620;
  const segments = normalizeSegments(params.segments, params.durationMs).map((segment) => ({ ...segment }));
  if (segments.length < 2 || params.transitions.length === 0) return { segments, adjustedCuts: 0 };

  const nearest = (target: number) => params.transitions.reduce<SceneTransition | null>((best, transition) => {
    if (Math.abs(transition.timeMs - target) > radiusMs) return best;
    if (!best || Math.abs(transition.timeMs - target) < Math.abs(best.timeMs - target)) return transition;
    return best;
  }, null);

  let adjustedCuts = 0;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const left = segments[index];
    const right = segments[index + 1];
    const leftTransition = nearest(left.end);
    const rightTransition = nearest(right.start);
    const leftCandidate = leftTransition?.timeMs ?? left.end;
    const rightCandidate = rightTransition?.timeMs ?? right.start;
    // 至少保留 160ms 的被剪区，避免吸附后重新连接为一段。
    if (leftCandidate < rightCandidate - 160 && leftCandidate > left.start + 180 && rightCandidate < right.end - 180) {
      if (leftCandidate !== left.end) { left.end = leftCandidate; adjustedCuts += 1; }
      if (rightCandidate !== right.start) { right.start = rightCandidate; adjustedCuts += 1; }
    }
  }
  return { segments: normalizeSegments(segments, params.durationMs), adjustedCuts };
}
