import { NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { requireTier } from '@/lib/tier';
import { getCloudRecording, upsertHandout } from '@/lib/db';
import { deepseekChat } from '@/services/deepseekClient';
import {
  buildHandoutPrompt,
  extractBoardSummary,
  parseHandoutJson,
  SYSTEM_PROMPT,
  type HandoutResult,
} from '@/services/handout';
import type { WhiteboardSnapshot } from '@/types/recording';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90; // Deepseek 通常 5-15s，留余地

const BUCKET = 'recordings';

function adminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_admin_not_configured');
  return createSupabaseAdmin(url, key, { auth: { persistSession: false } });
}

async function gunzip(blob: Blob): Promise<string> {
  if (typeof DecompressionStream === 'undefined') return blob.text();
  try {
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch {
    return blob.text();
  }
}

/**
 * POST /api/handout/generate
 *  body: { recordingId: string }
 *  → { outline, markdown, model }
 *
 * 要求：tier === 'max' + recording 已云端备份（snapshots 要从云端拉）。
 */
export async function POST(req: Request): Promise<NextResponse> {
  const guard = await requireTier(req, 'max');
  if ('error' in guard) return guard.error;

  let body: { recordingId?: string };
  try { body = (await req.json()) as { recordingId?: string }; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const recordingId = body.recordingId;
  if (!recordingId || typeof recordingId !== 'string') {
    return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });
  }

  const cloud = await getCloudRecording(guard.userId, recordingId);
  if (!cloud) {
    return NextResponse.json(
      { error: 'cloud_recording_required', message: '请先把录制备份到云端再生成讲义' },
      { status: 409 },
    );
  }

  // 从云端拉 snapshots.json.gz
  let snapshots: WhiteboardSnapshot[] = [];
  try {
    const admin = adminClient();
    const path = `${cloud.storagePrefix.replace(/\/$/, '')}/snapshots.json.gz`;
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error(error?.message ?? 'download_failed');
    const text = await gunzip(data);
    const parsed = JSON.parse(text) as { snapshots?: WhiteboardSnapshot[] };
    snapshots = parsed.snapshots ?? [];
  } catch (err) {
    return NextResponse.json(
      { error: 'snapshots_fetch_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }

  if ((!cloud.subtitleSrt || cloud.subtitleSrt.trim().length === 0) && snapshots.length === 0) {
    return NextResponse.json(
      { error: 'no_source_material', message: '录制既无字幕也无白板事件，无法生成讲义' },
      { status: 400 },
    );
  }

  const boardSummary = extractBoardSummary(snapshots, cloud.durationMs);
  const prompt = buildHandoutPrompt({
    subtitleSrt: cloud.subtitleSrt,
    boardSummary,
    durationMs: cloud.durationMs,
  });

  let result: HandoutResult;
  let modelUsed = '';
  try {
    const chat = await deepseekChat({ prompt, systemPrompt: SYSTEM_PROMPT, jsonMode: true });
    modelUsed = chat.modelUsed;
    result = parseHandoutJson(chat.text, cloud.durationMs);
  } catch (err) {
    return NextResponse.json(
      { error: 'handout_generation_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    );
  }

  try {
    await upsertHandout({
      recordingId,
      userId: guard.userId,
      outline: { title: result.title, chapters: result.chapters, keyframes: result.keyframes },
      markdown: result.markdown,
      model: modelUsed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'handout_save_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    title: result.title,
    chapters: result.chapters,
    keyframes: result.keyframes,
    markdown: result.markdown,
    model: modelUsed,
  });
}
