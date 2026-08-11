import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/tier';
import { deepseekChat } from '@/services/deepseekClient';
import { buildKeyPointMotionPrompt, KEY_POINT_MOTION_SYSTEM_PROMPT } from '@/services/keyPointMotionPrompt';
import { parseKeyPointMotionResponse } from '@/services/keyPointMotionSchema';
import type { SubtitleCue } from '@/types/recording';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const MAX_CUES = 4_000;
const MAX_CAPTION_CHARS = 120_000;

function parseCues(value: unknown): SubtitleCue[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CUES) return [];
  let characterCount = 0;
  const cues: SubtitleCue[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const index = Number(row.index);
    const startMs = Number(row.startMs);
    const endMs = Number(row.endMs);
    const cueText = typeof row.text === 'string' ? row.text.replace(/\s+/g, ' ').trim() : '';
    characterCount += cueText.length;
    if (!Number.isFinite(index) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !cueText || characterCount > MAX_CAPTION_CHARS) {
      return [];
    }
    cues.push({
      index: Math.max(0, Math.round(index)),
      startMs: Math.max(0, Math.round(startMs)),
      endMs: Math.max(0, Math.round(endMs)),
      text: cueText,
    });
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireTier(request, 'pro');
  if ('error' in guard) return guard.error;

  let body: { cues?: unknown; durationMs?: unknown; locale?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const cues = parseCues(body.cues);
  const durationMs = Number(body.durationMs);
  const locale = body.locale === 'en' ? 'en' : 'zh';
  if (!cues.length || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 24 * 60 * 60 * 1_000) {
    return NextResponse.json({ error: 'invalid_key_point_input' }, { status: 400 });
  }

  try {
    const chat = await deepseekChat({
      systemPrompt: KEY_POINT_MOTION_SYSTEM_PROMPT,
      prompt: buildKeyPointMotionPrompt({ cues, durationMs, locale }),
      jsonMode: true,
      timeoutMs: 75_000,
    });
    const motions = parseKeyPointMotionResponse(chat.text, cues, durationMs, locale);
    if (!motions.length) throw new Error('key_point_empty_result');
    return NextResponse.json({ motions, model: chat.modelUsed, source: 'deepseek' });
  } catch (error) {
    return NextResponse.json({
      error: 'key_point_generation_failed',
      message: error instanceof Error ? error.message.slice(0, 240) : 'unknown',
    }, { status: 502 });
  }
}
