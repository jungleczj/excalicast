import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSubtitleJob, updateSubtitleJob } from '@/lib/db';
import {
  fetchTranscriptionResult,
  pollTranscriptionTaskOnce,
  sentencesToSrt,
  submitTranscriptionTask,
} from '@/services/qwenAsr';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  type MediaJobStage,
  mediaJobFailurePayload,
  mediaJobFailureStatus,
  reportMediaJobFailure,
} from '@/lib/mediaJobDiagnostics';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed';
  srt?: string;
  error?: string;
  code?: string;
  stage?: MediaJobStage;
  cause?: string;
}

async function removeSourceAsset(
  supabase: SupabaseClient,
  path: string | null,
): Promise<void> {
  if (!path) return;
  await supabase.storage.from('recordings').remove([path]).catch(() => undefined);
}

export async function GET(req: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) return NextResponse.json({ status: 'failed', error: 'unauthenticated' }, { status: 401 });

  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ status: 'failed', error: 'missing_job_id' }, { status: 400 });

  let job;
  try {
    job = await getSubtitleJob(jobId, userId);
  } catch (error) {
    const failure = mediaJobFailurePayload(error, 'database');
    reportMediaJobFailure('asr.status.read', failure);
    return NextResponse.json(failure, { status: mediaJobFailureStatus(failure) });
  }
  if (!job) return NextResponse.json({ status: 'failed', error: 'job_not_found' }, { status: 404 });

  // Already terminal
  if (job.status === 'done') return NextResponse.json({ status: 'done', srt: job.srt ?? '' });
  if (job.status === 'failed') return NextResponse.json({ status: 'failed', error: job.error ?? 'unknown' });

  let stage: MediaJobStage = 'storage';
  let admin: SupabaseClient | undefined;
  try {
    admin = createSupabaseAdminClient();
    if (job.status === 'pending') {
      let fileUrl: string;
      if (job.asset_path) {
        const { data, error } = await admin.storage.from('recordings').createSignedUrl(job.asset_path, 3600);
        if (error || !data?.signedUrl) throw new Error(`audio_sign_failed: ${error?.message ?? 'missing_url'}`);
        fileUrl = data.signedUrl;
      } else if (job.audio_token) {
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
        if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL not set');
        fileUrl = `${appUrl}/api/asr/audio/${job.audio_token}.webm`;
      } else {
        throw new Error('missing_audio_asset');
      }
      stage = 'external_service';
      const submit = await submitTranscriptionTask({ fileUrl });
      stage = 'database';
      await updateSubtitleJob(jobId, userId, { status: 'running', task_id: submit.taskId });
      return NextResponse.json({ status: 'running' });
    }

    // running → poll once
    if (!job.task_id) {
      await updateSubtitleJob(jobId, userId, { status: 'failed', error: 'missing_task_id' });
      return NextResponse.json({ status: 'failed', error: 'missing_task_id' });
    }
    stage = 'external_service';
    const poll = await pollTranscriptionTaskOnce(job.task_id);
    if (poll.status === 'SUCCEEDED' && poll.transcriptionUrl) {
      const sentences = await fetchTranscriptionResult(poll.transcriptionUrl);
      const srt = sentencesToSrt(sentences);
      stage = 'database';
      await updateSubtitleJob(jobId, userId, { status: 'done', srt });
      await removeSourceAsset(admin, job.asset_path);
      return NextResponse.json({ status: 'done', srt });
    }
    if (poll.status === 'NO_SPEECH') {
      // DashScope 已经明确"任务完成 + 无语音"。用稳定业务码代替中文，
      // 让客户端 i18n 决定如何呈现给用户。
      console.warn(`[asr] no_speech_detected jobId=${jobId} recordingId=${job.recording_id}`);
      await updateSubtitleJob(jobId, userId, { status: 'failed', error: 'no_speech_detected' });
      await removeSourceAsset(admin, job.asset_path);
      return NextResponse.json({ status: 'failed', error: 'no_speech_detected' });
    }
    if (poll.status === 'FAILED' || poll.status === 'CANCELED') {
      // 剥掉上游可能自带的 "字幕生成失败：" 前缀，避免与客户端 i18n 标题双重前缀
      throw new Error(`DashScope poll failed 502: ${poll.errorMessage ?? poll.status}`);
    }
    // Still in progress
    return NextResponse.json({ status: 'running' });
  } catch (err) {
    const failure = mediaJobFailurePayload(err, stage);
    reportMediaJobFailure('asr.status', failure);
    await updateSubtitleJob(jobId, userId, { status: 'failed', error: failure.cause }).catch(() => undefined);
    if (admin) await removeSourceAsset(admin, job.asset_path);
    return NextResponse.json({
      status: 'failed',
      error: failure.cause,
      code: failure.code,
      stage: failure.stage,
      cause: failure.cause,
    } satisfies StatusResponse);
  }
}
