import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getDubbingJob } from '@/lib/dubbingStore';
import {
  mediaJobFailurePayload,
  mediaJobFailureStatus,
  reportMediaJobFailure,
} from '@/lib/mediaJobDiagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function resultUrl(req: Request, jobId: string, asset: string): string {
  return new URL(`/api/dubbing/result/${jobId}/${asset}`, req.url).pathname;
}

export async function GET(req: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return NextResponse.json({ status: 'failed', error: 'unauthenticated' }, { status: 401 });
  const jobId = new URL(req.url).searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ status: 'failed', error: 'missing_job_id' }, { status: 400 });
  let job;
  try {
    job = await getDubbingJob(jobId, user.id);
  } catch (error) {
    const failure = mediaJobFailurePayload(error, 'database');
    reportMediaJobFailure('dubbing.status.read', failure);
    return NextResponse.json(failure, { status: mediaJobFailureStatus(failure) });
  }
  if (!job) return NextResponse.json({ status: 'failed', error: 'job_not_found' }, { status: 404 });
  if (job.status !== 'pending' && job.status !== 'running') {
    return NextResponse.json({
      status: job.status,
      srtUrl: job.translatedSrt ? resultUrl(req, jobId, 'subtitles.srt') : undefined,
      audioUrl: job.dubbedAudioPath ? resultUrl(req, jobId, 'audio.wav') : undefined,
      lipSync: job.lipSync ?? 'skipped',
      provider: job.provider,
      voiceName: job.voiceName,
      billableCharacters: job.billableCharacters,
      synthesisChunkCount: job.synthesisChunkCount,
      phase: job.phase,
      totalChunks: job.totalChunks,
      completedChunks: job.completedChunks,
      elapsedMs: job.elapsedMs,
      etaMs: job.etaMs,
      decoder: job.decoder,
      fallbackReason: job.fallbackReason,
      error: job.error,
    });
  }
  // New clients drive bounded work through POST /api/dubbing/process. Keep a
  // read-only response here so retries and restored task polling never launch
  // duplicate synthesis work.
  return NextResponse.json({
    status: job.status,
    provider: job.provider,
    voiceName: job.voiceName,
    phase: job.phase,
    totalChunks: job.totalChunks,
    completedChunks: job.completedChunks,
    elapsedMs: job.elapsedMs,
    etaMs: job.etaMs,
    decoder: job.decoder,
    fallbackReason: job.fallbackReason,
    error: job.error,
  });

}
