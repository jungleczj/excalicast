import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getCloudRecording, upsertHandout } from '@/lib/db';
import { claimHandoutJob, updateHandoutJob } from '@/lib/handoutJobStore';
import { deepseekChat } from '@/services/deepseekClient';
import {
  buildHandoutPrompt,
  extractBoardSummary,
  parseHandoutJson,
  SYSTEM_PROMPT,
} from '@/services/handout';
import type { WhiteboardSnapshot } from '@/types/recording';

const BUCKET = 'recordings';

async function gunzip(blob: Blob): Promise<string> {
  if (typeof DecompressionStream === 'undefined') return blob.text();
  try {
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch {
    return blob.text();
  }
}

function safeJobError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'handout_generation_failed';
  return message.slice(0, 500);
}

export async function processHandoutJob(jobId: string): Promise<void> {
  const job = await claimHandoutJob(jobId);
  if (!job) return;

  try {
    const cloud = await getCloudRecording(job.userId, job.recordingId);
    if (!cloud) throw new Error('cloud_recording_required');

    const path = `${cloud.storagePrefix.replace(/\/$/, '')}/snapshots.json.gz`;
    const { data, error } = await createSupabaseAdminClient().storage.from(BUCKET).download(path);
    if (error || !data) throw new Error(`snapshots_fetch_failed: ${error?.message ?? 'download_failed'}`);
    const parsed = JSON.parse(await gunzip(data)) as { snapshots?: WhiteboardSnapshot[] };
    const snapshots = parsed.snapshots ?? [];

    if ((!cloud.subtitleSrt || cloud.subtitleSrt.trim().length === 0) && snapshots.length === 0) {
      throw new Error('no_source_material');
    }

    const boardSummary = extractBoardSummary(snapshots, cloud.durationMs);
    const prompt = buildHandoutPrompt({
      subtitleSrt: cloud.subtitleSrt,
      boardSummary,
      durationMs: cloud.durationMs,
    });
    const chat = await deepseekChat({
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      jsonMode: true,
      timeoutMs: 240_000,
    });
    const result = parseHandoutJson(chat.text, cloud.durationMs);
    await upsertHandout({
      recordingId: job.recordingId,
      userId: job.userId,
      outline: { title: result.title, chapters: result.chapters, keyframes: result.keyframes },
      markdown: result.markdown,
      model: chat.modelUsed,
    });
    await updateHandoutJob(job.id, { status: 'done' });
  } catch (error) {
    const message = safeJobError(error);
    await updateHandoutJob(job.id, { status: 'failed', error: message }).catch(() => undefined);
    console.error('[handout-job]', { jobId: job.id, recordingId: job.recordingId, error: message });
  }
}
