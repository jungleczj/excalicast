'use client';

import { loadRecordingMediaTracks } from '@/lib/db-client';
import type { TimeSegment } from '@/types/recording';
import { keptDuration, normalizeSegments, subtractRange } from '@/utils/segments';
import { parseSrt } from '@/utils/srtParser';
import {
  detectPySceneTransitions,
  snapCutsToPySceneTransitions,
  type SceneAnalysisOptions,
  type SceneTransition,
} from '@/services/pysceneDetectAdapter';
import { analyzeAudioBlobLevels } from '@/services/autoEditAudioWorker';

/** 自动剪辑只生成时间轴上的保留片段；原录制和媒体 chunk 永远不被改写。 */
export type AutoEditPreset = 'gentle' | 'standard' | 'tight';
export type ChatCutPreset = 'lecture' | 'walkthrough' | 'shorts';
export type AutoEditMode = AutoEditPreset | ChatCutPreset;
export type AutoEditStage = 'reading' | 'audio' | 'scene_coarse' | 'scene_refine' | 'complete';
export type AutoEditResultStage = 'silence' | 'scene';
export const AUTO_EDIT_ANALYZER_VERSION = 'chatcut-progressive-v1';

export interface AutoEditProgress {
  stage: AutoEditStage;
  progress: number;
  etaMs: number | null;
}

export interface AutoEditResult {
  segments: TimeSegment[];
  removedMs: number;
  cuts: number;
  preset: AutoEditPreset;
  chatCutPreset?: ChatCutPreset;
  sceneCuts?: number;
  sceneTransitions?: number;
  sceneStatus?: 'pending' | 'complete' | 'failed' | 'timed_out' | 'skipped';
}

export interface AutoEditMediaTracks {
  audioBlob: Blob | null;
  screenBlob: Blob | null;
  cameraBlob: Blob | null;
}

export interface AutoEditCacheValue {
  stage: AutoEditResultStage;
  result: AutoEditResult;
}

export interface AutoEditCacheAdapter {
  get(key: string, variant: string): Promise<AutoEditCacheValue | null>;
  set(key: string, variant: string, value: AutoEditCacheValue): Promise<void>;
}

export interface AutoEditAnalyzeParams {
  recordingId: string;
  durationMs: number;
  currentSegments?: TimeSegment[];
  subtitleSrt?: string | null;
  preset: AutoEditMode;
  signal?: AbortSignal;
  sceneTimeoutMs?: number;
  mediaSignature?: string;
  cache?: AutoEditCacheAdapter;
  onProgress?: (stage: AutoEditStage, progress: number, etaMs: number | null) => void;
  onStageResult?: (stage: AutoEditResultStage, result: AutoEditResult) => void;
  loadMedia?: (
    recordingId: string,
    tracks: ReadonlyArray<'audio' | 'screen' | 'camera'>,
    signal?: AbortSignal,
  ) => Promise<AutoEditMediaTracks>;
  decodeAudio?: (blob: Blob, signal?: AbortSignal) => Promise<AudioBuffer>;
  detectScenes?: (
    blob: Blob | null,
    durationMs: number,
    options: SceneAnalysisOptions,
  ) => Promise<SceneTransition[]>;
}

function cloneResult(result: AutoEditResult): AutoEditResult {
  return { ...result, segments: result.segments.map((segment) => ({ ...segment })) };
}

export function createMemoryAutoEditCache(maxEntries = 24): AutoEditCacheAdapter & { keys(): string[] } {
  const values = new Map<string, Map<string, AutoEditCacheValue>>();
  return {
    async get(key, variant) {
      const value = values.get(key)?.get(variant);
      return value ? { stage: value.stage, result: cloneResult(value.result) } : null;
    },
    async set(key, variant, value) {
      let variants = values.get(key);
      if (!variants) {
        variants = new Map();
        values.set(key, variants);
      }
      variants.set(variant, { stage: value.stage, result: cloneResult(value.result) });
      while (values.size > maxEntries) {
        const oldest = values.keys().next().value as string | undefined;
        if (!oldest) break;
        values.delete(oldest);
      }
    },
    keys: () => [...values.keys()],
  };
}

const defaultAutoEditCache = createMemoryAutoEditCache();

interface AutoEditSettings {
  minSilenceMs: number;
  paddingMs: number;
  minClipMs: number;
}

const SETTINGS: Record<AutoEditPreset, AutoEditSettings> = {
  gentle: { minSilenceMs: 1400, paddingMs: 300, minClipMs: 800 },
  standard: { minSilenceMs: 850, paddingMs: 220, minClipMs: 520 },
  tight: { minSilenceMs: 560, paddingMs: 160, minClipMs: 360 },
};

const CHATCUT_SETTINGS: Record<ChatCutPreset, { preset: AutoEditPreset; sceneAware: boolean }> = {
  lecture: { preset: 'gentle', sceneAware: true },
  walkthrough: { preset: 'standard', sceneAware: true },
  shorts: { preset: 'tight', sceneAware: true },
};

function resolveMode(mode: AutoEditMode): { preset: AutoEditPreset; chatCutPreset?: ChatCutPreset; sceneAware: boolean } {
  if (mode in CHATCUT_SETTINGS) {
    const chatCutPreset = mode as ChatCutPreset;
    return { ...CHATCUT_SETTINGS[chatCutPreset], chatCutPreset };
  }
  return { preset: mode as AutoEditPreset, sceneAware: false };
}

const WINDOW_MS = 20;
const EDGE_GUARD_MS = 250;

export class AutoEditError extends Error {
  constructor(public readonly code: 'no_audio' | 'audio_decode_failed' | 'browser_unsupported') {
    super(code);
  }
}

function db(value: number): number {
  return 20 * Math.log10(Math.max(value, 1e-6));
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return -96;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
}

function levelsFromAudioBuffer(buffer: AudioBuffer, durationMs: number): number[] {
  const channels = Math.max(1, buffer.numberOfChannels);
  const framesPerWindow = Math.max(1, Math.round(buffer.sampleRate * (WINDOW_MS / 1000)));
  const lastFrame = Math.min(buffer.length, Math.round(buffer.sampleRate * (durationMs / 1000)));
  const levels: number[] = [];

  for (let start = 0; start < lastFrame; start += framesPerWindow) {
    const end = Math.min(lastFrame, start + framesPerWindow);
    let sumSquares = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += 1) sumSquares += data[sample] ** 2;
    }
    levels.push(db(Math.sqrt(sumSquares / Math.max(1, (end - start) * channels))));
  }

  return levels;
}

function rangesFromLevels(levels: number[], durationMs: number): TimeSegment[] {
  // 自适应噪声阈值：低于噪声地板 + 10 dB 的窗口视为静音；始终限制在可用语音范围内。
  const threshold = Math.max(-48, Math.min(-28, percentile(levels, 0.2) + 10));
  const silent: TimeSegment[] = [];
  let runStart: number | null = null;
  for (let index = 0; index < levels.length; index += 1) {
    if (levels[index] <= threshold) {
      if (runStart === null) runStart = index;
      continue;
    }
    if (runStart !== null) {
      silent.push({ start: runStart * WINDOW_MS, end: index * WINDOW_MS });
      runStart = null;
    }
  }
  if (runStart !== null) silent.push({ start: runStart * WINDOW_MS, end: Math.min(durationMs, levels.length * WINDOW_MS) });
  return silent;
}

function overlaps(a: TimeSegment, b: TimeSegment): boolean {
  return a.start < b.end && b.start < a.end;
}

function wouldCreateTinyClip(segments: TimeSegment[], minClipMs: number): boolean {
  return segments.some((segment) => segment.end - segment.start < minClipMs);
}

/**
 * 从已解码音频生成非破坏性保留片段。字幕时间轴为保护区，避免安静但仍在说话的内容被误剪。
 * 该函数不读取数据库，便于在 worker / 其他来源复用。
 */
function buildAutoEditSegmentsFromLevels(params: {
  levels: number[];
  analysisDurationMs: number;
  durationMs: number;
  currentSegments?: TimeSegment[];
  subtitleSrt?: string | null;
  preset: AutoEditPreset;
}): AutoEditResult {
  const settings = SETTINGS[params.preset];
  const sourceDurationMs = Math.max(0, params.durationMs);
  const analysisDurationMs = Math.max(0, Math.min(sourceDurationMs, Math.round(params.analysisDurationMs)));
  // 音频轨可能比媒体时间轴短（例如暂停录制）；分析范围可以缩短，但绝不能截掉时间轴尾部。
  const initial = normalizeSegments(params.currentSegments, sourceDurationMs);
  if (analysisDurationMs < settings.minSilenceMs || initial.length === 0) {
    return { segments: initial, removedMs: 0, cuts: 0, preset: params.preset };
  }

  const protectedCues = parseSrt(params.subtitleSrt ?? '').map(({ startMs, endMs }) => ({
    start: Math.max(0, startMs - settings.paddingMs),
    end: Math.min(analysisDurationMs, endMs + settings.paddingMs),
  }));
  const candidates = rangesFromLevels(params.levels, analysisDurationMs);
  let next = initial;
  let cuts = 0;

  for (const silence of candidates) {
    if (silence.end - silence.start < settings.minSilenceMs) continue;
    const cut: TimeSegment = {
      start: Math.max(EDGE_GUARD_MS, silence.start + settings.paddingMs),
      end: Math.min(analysisDurationMs - EDGE_GUARD_MS, silence.end - settings.paddingMs),
    };
    if (cut.end - cut.start < settings.minSilenceMs - settings.paddingMs * 2) continue;
    if (protectedCues.some((cue) => overlaps(cut, cue))) continue;
    const proposed = subtractRange(next, cut.start, cut.end);
    if (proposed.length === 0 || wouldCreateTinyClip(proposed, settings.minClipMs)) continue;
    if (keptDuration(proposed) < keptDuration(next)) {
      next = proposed;
      cuts += 1;
    }
  }

  return {
    segments: next,
    removedMs: Math.max(0, keptDuration(initial) - keptDuration(next)),
    cuts,
    preset: params.preset,
  };
}

export function buildAutoEditSegments(params: {
  audio: AudioBuffer;
  durationMs: number;
  currentSegments?: TimeSegment[];
  subtitleSrt?: string | null;
  preset: AutoEditPreset;
}): AutoEditResult {
  const analysisDurationMs = Math.max(0, Math.min(params.durationMs, Math.round(params.audio.duration * 1000)));
  return buildAutoEditSegmentsFromLevels({
    levels: levelsFromAudioBuffer(params.audio, analysisDurationMs),
    analysisDurationMs,
    durationMs: params.durationMs,
    currentSegments: params.currentSegments,
    subtitleSrt: params.subtitleSrt,
    preset: params.preset,
  });
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

async function decodeAudio(blob: Blob, signal?: AbortSignal): Promise<AudioBuffer> {
  throwIfAborted(signal);
  const AudioContextCtor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new AutoEditError('browser_unsupported');
  const context = new AudioContextCtor();
  try {
    const bytes = await blob.arrayBuffer();
    throwIfAborted(signal);
    const decoded = await context.decodeAudioData(bytes.slice(0));
    throwIfAborted(signal);
    return decoded;
  } catch {
    if (signal?.aborted) throw abortError();
    throw new AutoEditError('audio_decode_failed');
  } finally {
    void context.close();
  }
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function cacheVariant(params: AutoEditAnalyzeParams): string {
  return hashText(JSON.stringify({
    preset: params.preset,
    durationMs: params.durationMs,
    segments: normalizeSegments(params.currentSegments, params.durationMs),
    subtitleSrt: params.subtitleSrt ?? '',
  }));
}

function inferredMediaSignature(media: AutoEditMediaTracks, durationMs: number): string {
  const describe = (blob: Blob | null) => blob ? `${blob.size}:${blob.type || '-'}` : '0:-';
  return hashText(`${durationMs}|${describe(media.audioBlob)}|${describe(media.screenBlob)}|${describe(media.cameraBlob)}`);
}

function cacheKey(recordingId: string, mediaSignature: string): string {
  return `${recordingId}::${mediaSignature}::${AUTO_EDIT_ANALYZER_VERSION}`;
}

function report(
  params: AutoEditAnalyzeParams,
  stage: AutoEditStage,
  progress: number,
  etaMs: number | null = null,
): void {
  params.onProgress?.(stage, Math.max(0, Math.min(1, progress)), etaMs);
}

async function defaultLoadMedia(
  recordingId: string,
  tracks: ReadonlyArray<'audio' | 'screen' | 'camera'>,
  signal?: AbortSignal,
): Promise<AutoEditMediaTracks> {
  throwIfAborted(signal);
  const loaded = await loadRecordingMediaTracks(recordingId, tracks);
  throwIfAborted(signal);
  return loaded;
}

/** Local progressive analysis. Media tracks are loaded once and are never uploaded. */
export async function analyzeRecordingForAutoEdit(params: AutoEditAnalyzeParams): Promise<AutoEditResult> {
  const mode = resolveMode(params.preset);
  const cache = params.cache ?? defaultAutoEditCache;
  const variant = cacheVariant(params);
  let key = params.mediaSignature ? cacheKey(params.recordingId, params.mediaSignature) : null;
  let cached = key ? await cache.get(key, variant) : null;
  if (cached?.stage === 'scene' || (cached && !mode.sceneAware)) {
    const result = cloneResult(cached.result);
    params.onStageResult?.(cached.stage, result);
    report(params, 'complete', 1, 0);
    return result;
  }

  throwIfAborted(params.signal);
  report(params, 'reading', 0);
  const loadMedia = params.loadMedia ?? defaultLoadMedia;
  const media = await loadMedia(
    params.recordingId,
    mode.sceneAware ? ['audio', 'screen', 'camera'] : ['audio'],
    params.signal,
  );
  throwIfAborted(params.signal);
  report(params, 'reading', 1, 0);
  key ??= cacheKey(params.recordingId, inferredMediaSignature(media, params.durationMs));
  cached ??= await cache.get(key, variant);
  if (cached?.stage === 'scene' || (cached && !mode.sceneAware)) {
    const result = cloneResult(cached.result);
    params.onStageResult?.(cached.stage, result);
    report(params, 'complete', 1, 0);
    return result;
  }

  const { audioBlob, screenBlob, cameraBlob } = media;
  if (!audioBlob || audioBlob.size === 0) throw new AutoEditError('no_audio');
  let base: AutoEditResult;
  if (cached?.stage === 'silence') {
    base = cloneResult(cached.result);
  } else {
    report(params, 'audio', 0);
    let analyzed: AutoEditResult;
    if (params.decodeAudio) {
      const audio = await params.decodeAudio(audioBlob, params.signal);
      throwIfAborted(params.signal);
      analyzed = buildAutoEditSegments({
        audio,
        durationMs: params.durationMs,
        currentSegments: params.currentSegments,
        subtitleSrt: params.subtitleSrt,
        preset: mode.preset,
      });
    } else {
      try {
        const streamed = await analyzeAudioBlobLevels({
          blob: audioBlob,
          durationMs: params.durationMs,
          signal: params.signal,
          onProgress: (progress) => report(params, 'audio', progress),
        });
        analyzed = buildAutoEditSegmentsFromLevels({
          levels: streamed.levels,
          analysisDurationMs: streamed.analyzedDurationMs,
          durationMs: params.durationMs,
          currentSegments: params.currentSegments,
          subtitleSrt: params.subtitleSrt,
          preset: mode.preset,
        });
      } catch (error) {
        if (params.signal?.aborted) throw abortError();
        const audio = await decodeAudio(audioBlob, params.signal);
        analyzed = buildAutoEditSegments({
          audio,
          durationMs: params.durationMs,
          currentSegments: params.currentSegments,
          subtitleSrt: params.subtitleSrt,
          preset: mode.preset,
        });
      }
    }
    base = {
      ...analyzed,
      chatCutPreset: mode.chatCutPreset,
      sceneStatus: mode.sceneAware ? 'pending' : 'skipped',
    };
    report(params, 'audio', 1, 0);
    await cache.set(key, variant, { stage: 'silence', result: base });
  }
  params.onStageResult?.('silence', cloneResult(base));

  if (!mode.sceneAware) {
    await cache.set(key, variant, { stage: 'scene', result: base });
    report(params, 'complete', 1, 0);
    return base;
  }

  const sceneController = new AbortController();
  let timedOut = false;
  const forwardAbort = () => sceneController.abort();
  params.signal?.addEventListener('abort', forwardAbort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      sceneController.abort();
      reject(abortError());
    }, Math.max(1, params.sceneTimeoutMs ?? 5 * 60_000));
  });

  try {
    const transitions = await Promise.race([
      (params.detectScenes ?? detectPySceneTransitions)(
        screenBlob ?? cameraBlob,
        params.durationMs,
        {
          signal: sceneController.signal,
          onProgress: (stage, progress, etaMs) => report(params, stage, progress, etaMs),
        },
      ),
      timeoutPromise,
    ]);
    throwIfAborted(params.signal);
    const snapped = snapCutsToPySceneTransitions({
      segments: base.segments,
      durationMs: params.durationMs,
      transitions,
    });
    const result: AutoEditResult = {
      ...base,
      segments: snapped.segments,
      removedMs: Math.max(
        0,
        keptDuration(normalizeSegments(params.currentSegments, params.durationMs)) - keptDuration(snapped.segments),
      ),
      sceneCuts: snapped.adjustedCuts,
      sceneTransitions: transitions.length,
      sceneStatus: 'complete',
    };
    await cache.set(key, variant, { stage: 'scene', result });
    params.onStageResult?.('scene', cloneResult(result));
    report(params, 'complete', 1, 0);
    return result;
  } catch (error) {
    if (params.signal?.aborted) throw abortError();
    const fallback: AutoEditResult = {
      ...base,
      sceneCuts: 0,
      sceneTransitions: 0,
      sceneStatus: timedOut ? 'timed_out' : 'failed',
    };
    report(params, 'complete', 1, 0);
    return fallback;
  } finally {
    if (timeout) clearTimeout(timeout);
    params.signal?.removeEventListener('abort', forwardAbort);
  }
}
