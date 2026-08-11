import type { KeyPointMotionSegment, SubtitleCue } from '@/types/recording';
import { migrateKeyPointMotionSegment } from '@/services/keyPointMotion';

export interface KeyPointMotionGenerationResult {
  motions: KeyPointMotionSegment[];
  model: string;
  source: 'deepseek';
}
export async function generateKeyPointMotions(params: {
  cues: SubtitleCue[];
  durationMs: number;
  locale: 'en' | 'zh';
  signal?: AbortSignal;
}): Promise<KeyPointMotionGenerationResult> {
  const response = await fetch('/api/key-points/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cues: params.cues, durationMs: params.durationMs, locale: params.locale }),
    signal: params.signal,
  });
  const payload = await response.json().catch(() => null) as {
    motions?: KeyPointMotionSegment[];
    model?: string;
    source?: string;
    error?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.error ?? `key_point_request_${response.status}`);
  if (!payload || !Array.isArray(payload.motions) || payload.motions.length === 0) {
    throw new Error('key_point_empty_result');
  }
  const motions = payload.motions
    .filter((motion) => motion && typeof motion === 'object' && typeof motion.title === 'string')
    .map(migrateKeyPointMotionSegment);
  if (motions.length === 0) throw new Error('key_point_invalid_result');
  return { motions, model: payload.model ?? 'deepseek', source: 'deepseek' };
}
