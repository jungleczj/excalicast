import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSubtitleJob, updateSubtitleJob } from '@/lib/db';
import {
  fetchTranscriptionResult,
  pollTranscriptionTaskOnce,
  sentencesToSrt,
  submitTranscriptionTask,
} from '@/services/qwenAsr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed';
  srt?: string;
  error?: string;
}

async function removeSourceAsset(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  path: string | null,
): Promise<void> {
  if (!path) return;
  await supabase.storage.from('recordings').remove([path]).catch(() => undefined);
}

export async function GET(req: Request): Promise<NextResponse<StatusResponse>> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) return NextResponse.json({ status: 'failed', error: 'unauthenticated' }, { status: 401 });

  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ status: 'failed', error: 'missing_job_id' }, { status: 400 });

  const job = await getSubtitleJob(jobId);
  if (!job) return NextResponse.json({ status: 'failed', error: 'job_not_found' }, { status: 404 });
  if (job.user_id !== userId) {
    return NextResponse.json({ status: 'failed', error: 'forbidden' }, { status: 403 });
  }

  // Already terminal
  if (job.status === 'done') return NextResponse.json({ status: 'done', srt: job.srt ?? '' });
  if (job.status === 'failed') return NextResponse.json({ status: 'failed', error: job.error ?? 'unknown' });

  // Drive the DashScope state machine forward by one step
  try {
    if (job.status === 'pending') {
      let fileUrl: string;
      if (job.asset_path) {
        const { data, error } = await supabase.storage.from('recordings').createSignedUrl(job.asset_path, 3600);
        if (error || !data?.signedUrl) throw new Error(`audio_sign_failed: ${error?.message ?? 'missing_url'}`);
        fileUrl = data.signedUrl;
      } else if (job.audio_token) {
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
        if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL not set');
        fileUrl = `${appUrl}/api/asr/audio/${job.audio_token}.webm`;
      } else {
        throw new Error('missing_audio_asset');
      }
      const submit = await submitTranscriptionTask({ fileUrl });
      await updateSubtitleJob(jobId, { status: 'running', task_id: submit.taskId });
      return NextResponse.json({ status: 'running' });
    }

    // running → poll once
    if (!job.task_id) {
      await updateSubtitleJob(jobId, { status: 'failed', error: 'missing_task_id' });
      return NextResponse.json({ status: 'failed', error: 'missing_task_id' });
    }
    const poll = await pollTranscriptionTaskOnce(job.task_id);
    if (poll.status === 'SUCCEEDED' && poll.transcriptionUrl) {
      const sentences = await fetchTranscriptionResult(poll.transcriptionUrl);
      const srt = sentencesToSrt(sentences);
      await updateSubtitleJob(jobId, { status: 'done', srt });
      await removeSourceAsset(supabase, job.asset_path);
      return NextResponse.json({ status: 'done', srt });
    }
    if (poll.status === 'NO_SPEECH') {
      // DashScope 已经明确"任务完成 + 无语音"。用稳定业务码代替中文，
      // 让客户端 i18n 决定如何呈现给用户。
      console.warn(`[asr] no_speech_detected jobId=${jobId} recordingId=${job.recording_id}`);
      await updateSubtitleJob(jobId, { status: 'failed', error: 'no_speech_detected' });
      await removeSourceAsset(supabase, job.asset_path);
      return NextResponse.json({ status: 'failed', error: 'no_speech_detected' });
    }
    if (poll.status === 'FAILED' || poll.status === 'CANCELED') {
      // 剥掉上游可能自带的 "字幕生成失败：" 前缀，避免与客户端 i18n 标题双重前缀
      const rawErr = poll.errorMessage ?? poll.status;
      const err = rawErr.replace(/^字幕生成失败[：:]\s*/, '').trim() || rawErr;
      await updateSubtitleJob(jobId, { status: 'failed', error: err });
      await removeSourceAsset(supabase, job.asset_path);
      return NextResponse.json({ status: 'failed', error: err });
    }
    // Still in progress
    return NextResponse.json({ status: 'running' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    await updateSubtitleJob(jobId, { status: 'failed', error: msg });
    await removeSourceAsset(supabase, job.asset_path);
    return NextResponse.json({ status: 'failed', error: msg });
  }
}
