import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getDubbingJob,
  updateDubbingJob,
} from '@/lib/dubbingStore';
import { generateDubbingTranslation } from '@/services/dubbingProviders';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  type MediaJobStage,
  mediaJobFailurePayload,
  mediaJobFailureStatus,
  reportMediaJobFailure,
} from '@/lib/mediaJobDiagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface DubbingStatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed';
  srtUrl?: string;
  lipSync?: 'done' | 'skipped' | 'failed';
  provider?: string;
  error?: string;
}

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
  if (job.status === 'done') {
    return NextResponse.json({
      status: 'done',
      srtUrl: resultUrl(req, jobId, 'subtitles.srt'),
      lipSync: job.lipSync ?? 'skipped',
      provider: job.provider,
    });
  }
  if (job.status === 'failed') return NextResponse.json({ status: 'failed', error: job.error ?? 'unknown' });
  // A previous function may have died after claiming the job. Recent claims
  // remain single-flight; stale claims are recoverable on the next poll.
  if (job.status === 'running' && Date.now() - job.updatedAt < 120_000) {
    return NextResponse.json({ status: 'running' });
  }

  let stage: MediaJobStage = 'database';
  let admin: ReturnType<typeof createSupabaseAdminClient> | undefined;
  const removeSources = async () => {
    const paths = [job.audioAssetPath, job.cameraAssetPath].filter((value): value is string => !!value);
    if (admin && paths.length > 0) await admin.storage.from('recordings').remove(paths).catch(() => undefined);
  };
  try {
    await updateDubbingJob(jobId, user.id, { status: 'running' });
    if (job.audioAssetPath || job.cameraAssetPath) admin = createSupabaseAdminClient();
    stage = 'external_service';
    const result = await generateDubbingTranslation(job.sourceSrt ?? '');
    stage = 'database';
    const done = await updateDubbingJob(jobId, user.id, {
      status: 'done',
      translatedSrt: result.translatedSrt,
      lipSync: 'skipped',
      provider: result.provider,
    });
    await removeSources();
    return NextResponse.json({
      status: 'done',
      srtUrl: resultUrl(req, jobId, 'subtitles.srt'),
      lipSync: done?.lipSync ?? 'skipped',
      provider: done?.provider,
    });
  } catch (error) {
    const failure = mediaJobFailurePayload(error, stage);
    reportMediaJobFailure('dubbing.status', failure);
    await updateDubbingJob(jobId, user.id, { status: 'failed', error: failure.cause }).catch(() => undefined);
    await removeSources();
    return NextResponse.json({
      status: 'failed',
      error: failure.cause,
      code: failure.code,
      stage: failure.stage,
      cause: failure.cause,
    });
  }
}
