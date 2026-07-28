'use client';

import { loadFullRecording } from '@/lib/db-client';
import type { TimeSegment } from '@/types/recording';
import { keptDuration, normalizeSegments, subtractRange } from '@/utils/segments';
import { parseSrt } from '@/utils/srtParser';
import { detectPySceneTransitions, snapCutsToPySceneTransitions } from '@/services/pysceneDetectAdapter';

/** 自动剪辑只生成时间轴上的保留片段；原录制和媒体 chunk 永远不被改写。 */
export type AutoEditPreset = 'gentle' | 'standard' | 'tight';
export type ChatCutPreset = 'lecture' | 'walkthrough' | 'shorts';
export type AutoEditMode = AutoEditPreset | ChatCutPreset;

export interface AutoEditResult {
  segments: TimeSegment[];
  removedMs: number;
  cuts: number;
  preset: AutoEditPreset;
  chatCutPreset?: ChatCutPreset;
  sceneCuts?: number;
  sceneTransitions?: number;
}

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

function rangesFromSilence(buffer: AudioBuffer, durationMs: number): TimeSegment[] {
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
export function buildAutoEditSegments(params: {
  audio: AudioBuffer;
  durationMs: number;
  currentSegments?: TimeSegment[];
  subtitleSrt?: string | null;
  preset: AutoEditPreset;
}): AutoEditResult {
  const settings = SETTINGS[params.preset];
  const sourceDurationMs = Math.max(0, params.durationMs);
  const analysisDurationMs = Math.max(0, Math.min(sourceDurationMs, Math.round(params.audio.duration * 1000)));
  // 音频轨可能比媒体时间轴短（例如暂停录制）；分析范围可以缩短，但绝不能截掉时间轴尾部。
  const initial = normalizeSegments(params.currentSegments, sourceDurationMs);
  if (analysisDurationMs < settings.minSilenceMs || initial.length === 0) {
    return { segments: initial, removedMs: 0, cuts: 0, preset: params.preset };
  }

  const protectedCues = parseSrt(params.subtitleSrt ?? '').map(({ startMs, endMs }) => ({
    start: Math.max(0, startMs - settings.paddingMs),
    end: Math.min(analysisDurationMs, endMs + settings.paddingMs),
  }));
  const candidates = rangesFromSilence(params.audio, analysisDurationMs);
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

async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const AudioContextCtor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new AutoEditError('browser_unsupported');
  const context = new AudioContextCtor();
  try {
    return await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
  } catch {
    throw new AutoEditError('audio_decode_failed');
  } finally {
    void context.close();
  }
}

/** 在浏览器本地读取 IndexedDB 音频并分析；不会上传或调用后端。 */
export async function analyzeRecordingForAutoEdit(params: {
  recordingId: string;
  durationMs: number;
  currentSegments?: TimeSegment[];
  subtitleSrt?: string | null;
  preset: AutoEditMode;
}): Promise<AutoEditResult> {
  const { audioBlob, screenBlob, cameraBlob } = await loadFullRecording(params.recordingId);
  if (!audioBlob || audioBlob.size === 0) throw new AutoEditError('no_audio');
  const audio = await decodeAudio(audioBlob);
  const mode = resolveMode(params.preset);
  const base = buildAutoEditSegments({ ...params, preset: mode.preset, audio });
  if (!mode.sceneAware) return base;

  const transitions = await detectPySceneTransitions(screenBlob ?? cameraBlob, params.durationMs);
  const snapped = snapCutsToPySceneTransitions({
    segments: base.segments,
    durationMs: params.durationMs,
    transitions,
  });
  return {
    ...base,
    segments: snapped.segments,
    removedMs: Math.max(0, keptDuration(normalizeSegments(params.currentSegments, params.durationMs)) - keptDuration(snapped.segments)),
    chatCutPreset: mode.chatCutPreset,
    sceneCuts: snapped.adjustedCuts,
    sceneTransitions: transitions.length,
  };
}
