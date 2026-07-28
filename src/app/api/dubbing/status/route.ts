import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { type DubbingJob, getDubbingJob, updateDubbingJob } from '@/lib/dubbingStore';
import { generateDubbingAssets } from '@/services/dubbingProviders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface DubbingStatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed';
  srtUrl?: string;
  audioUrl?: string;
  cameraUrl?: string;
  lipSync?: 'done' | 'skipped' | 'failed';
  provider?: string;
  error?: string;
}

function resultUrl(req: Request, jobId: string, asset: 'subtitles.srt' | 'audio.wav' | 'camera.webm'): string {
  return new URL(`/api/dubbing/result/${jobId}/${asset}`, req.url).pathname;
}

function isLocalOrigin(origin: string): boolean {
  return /localhost|127\.0\.0\.1|\[::1\]/i.test(origin);
}

function publicOrigin(req: Request): string | null {
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
  if (configured && !isLocalOrigin(configured)) return configured;
  const origin = new URL(req.url).origin.replace(/\/+$/, '');
  return isLocalOrigin(origin) ? null : origin;
}

function audioExtension(mime: string | undefined): string {
  if (!mime) return 'webm';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('ogg') || mime.includes('opus')) return 'ogg';
  if (mime.includes('flac')) return 'flac';
  return 'webm';
}

function sourceAudioUrl(req: Request, job: DubbingJob): string | undefined {
  if (!job.audioToken) return undefined;
  const origin = publicOrigin(req);
  if (!origin) return undefined;
  const ext = audioExtension(job.audioType);
  return `${origin}/api/dubbing/audio/${job.audioToken}.${ext}`;
}

export async function GET(req: Request): Promise<NextResponse<DubbingStatusResponse>> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) return NextResponse.json({ status: 'failed', error: 'unauthenticated' }, { status: 401 });

  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ status: 'failed', error: 'missing_job_id' }, { status: 400 });

  const job = getDubbingJob(jobId);
  if (!job) return NextResponse.json({ status: 'failed', error: 'job_not_found' }, { status: 404 });
  if (job.userId !== userId) {
    return NextResponse.json({ status: 'failed', error: 'forbidden' }, { status: 403 });
  }

  if (job.status === 'done') {
    return NextResponse.json({
      status: 'done',
      srtUrl: resultUrl(req, jobId, 'subtitles.srt'),
      audioUrl: resultUrl(req, jobId, 'audio.wav'),
      cameraUrl: job.lipSyncCamera ? resultUrl(req, jobId, 'camera.webm') : undefined,
      lipSync: job.lipSync ?? 'skipped',
      provider: job.provider,
    });
  }
  if (job.status === 'failed') {
    return NextResponse.json({ status: 'failed', error: job.error ?? 'unknown' });
  }

  try {
    updateDubbingJob(jobId, { status: 'running' });
    const result = await generateDubbingAssets({
      sourceSrt: job.sourceSrt,
      sourceAudioFileUrl: sourceAudioUrl(req, job),
      cameraBytes: job.cameraBytes,
    });
    const done = updateDubbingJob(jobId, {
      status: 'done',
      translatedSrt: result.translatedSrt,
      dubbedAudio: result.audioBytes,
      dubbedAudioType: result.audioType,
      lipSyncCamera: result.lipSyncCamera,
      lipSyncCameraType: result.lipSyncCameraType,
      lipSync: result.lipSync,
      provider: result.provider,
    });

    return NextResponse.json({
      status: 'done',
      srtUrl: resultUrl(req, jobId, 'subtitles.srt'),
      audioUrl: resultUrl(req, jobId, 'audio.wav'),
      cameraUrl: done?.lipSyncCamera ? resultUrl(req, jobId, 'camera.webm') : undefined,
      lipSync: done?.lipSync ?? 'skipped',
      provider: done?.provider,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'dubbing_failed';
    updateDubbingJob(jobId, { status: 'failed', error: message });
    return NextResponse.json({ status: 'failed', error: message });
  }
}
