'use client';

import type { TimeSegment } from '@/types/recording';
import { normalizeSegments } from '@/utils/segments';

/**
 * 浏览器本地的 PySceneDetect AdaptiveDetector 适配器。
 *
 * PySceneDetect 的核心语法是：比较相邻帧内容差异，再用一个滚动窗口的基线
 * 自适应判断镜头切换。这里完全在浏览器中对本地 Blob 采样，避免把录制上传
 * 给服务端；它是与 AdaptiveDetector 行为对齐的实现，不会声称在浏览器内运行
 * Python 包本身。
 */
export interface SceneTransition {
  timeMs: number;
  score: number;
}

const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 36;
const MIN_SCENE_DISTANCE_MS = 760;
const MAX_SAMPLES = 180;

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

function waitFor(video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`video_${event}_timeout`));
    }, 4_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(event, ready);
      video.removeEventListener('error', failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error(`video_${event}_failed`)); };
    video.addEventListener(event, ready, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}

/** 读取本地录制中的画面转场；无法采样时安全返回空数组。 */
export async function detectPySceneTransitions(blob: Blob | null, recordingDurationMs: number): Promise<SceneTransition[]> {
  if (!blob || blob.size === 0 || typeof document === 'undefined') return [];
  const video = document.createElement('video');
  const url = URL.createObjectURL(blob);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await waitFor(video, 'loadedmetadata');
    const durationMs = Math.min(recordingDurationMs, Math.floor(video.duration * 1_000));
    // 短演示也可能有一次有价值的切场；只要有一个最小镜头间隔与可比较样本就分析。
    if (!Number.isFinite(durationMs) || durationMs < MIN_SCENE_DISTANCE_MS + 220) return [];

    const sampleCount = Math.min(MAX_SAMPLES, Math.max(8, Math.ceil(durationMs / 700)));
    const intervalMs = durationMs / sampleCount;
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [];

    const transitions: SceneTransition[] = [];
    const recentScores: number[] = [];
    let previous: Uint8ClampedArray | null = null;
    let lastTransitionMs = -MIN_SCENE_DISTANCE_MS;

    for (let index = 0; index < sampleCount; index += 1) {
      const timeMs = Math.min(durationMs - 20, Math.round(index * intervalMs));
      video.currentTime = Math.max(0, timeMs / 1_000);
      await waitFor(video, 'seeked');
      context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      const frame = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
      if (previous) {
        const score = frameDifference(previous, frame);
        const baseline = median(recentScores.slice(-12));
        // AdaptiveDetector 风格：基线越平稳，阈值越灵敏；画面整体剧烈运动时自动抬高。
        const adaptiveThreshold = Math.max(10, baseline * 1.85 + 4.5);
        if (recentScores.length >= 3 && score >= adaptiveThreshold && timeMs - lastTransitionMs >= MIN_SCENE_DISTANCE_MS) {
          transitions.push({ timeMs, score: Math.round(score * 100) / 100 });
          lastTransitionMs = timeMs;
        }
        recentScores.push(score);
      }
      previous = new Uint8ClampedArray(frame);
    }
    return transitions;
  } catch {
    return [];
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
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
