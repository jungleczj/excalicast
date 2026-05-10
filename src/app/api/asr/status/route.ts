import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getSubtitleJob, updateSubtitleJob } from '@/lib/db';
import { deleteAudio } from '@/lib/asrStore';
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

export async function GET(req: Request): Promise<NextResponse<StatusResponse>> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
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
      // Submit the task on the first /status call
      const audioToken = job.audio_token!;
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
      if (!appUrl) {
        await updateSubtitleJob(jobId, { status: 'failed', error: 'NEXT_PUBLIC_APP_URL not set' });
        return NextResponse.json({ status: 'failed', error: 'NEXT_PUBLIC_APP_URL not set' });
      }
      const fileUrl = `${appUrl}/api/asr/audio/${audioToken}`;
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
      if (job.audio_token) await deleteAudio(job.audio_token);
      return NextResponse.json({ status: 'done', srt });
    }
    if (poll.status === 'FAILED' || poll.status === 'CANCELED') {
      const err = poll.errorMessage ?? poll.status;
      await updateSubtitleJob(jobId, { status: 'failed', error: err });
      if (job.audio_token) await deleteAudio(job.audio_token);
      return NextResponse.json({ status: 'failed', error: err });
    }
    // Still in progress
    return NextResponse.json({ status: 'running' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    await updateSubtitleJob(jobId, { status: 'failed', error: msg });
    return NextResponse.json({ status: 'failed', error: msg });
  }
}
