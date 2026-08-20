import { waitUntil } from '@vercel/functions';
import { NextResponse } from 'next/server';
import { getHandoutJob } from '@/lib/handoutJobStore';
import { requireTier } from '@/lib/tier';
import { processHandoutJob } from '@/services/handoutJob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request): Promise<NextResponse> {
  const guard = await requireTier(req, 'max');
  if ('error' in guard) return guard.error;
  const jobId = new URL(req.url).searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'missing_job_id' }, { status: 400 });

  try {
    const job = await getHandoutJob(jobId, guard.userId);
    if (!job) return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
    if (job.status === 'failed') {
      return NextResponse.json({ status: 'failed', error: job.error ?? 'handout_generation_failed' });
    }
    if (job.status === 'done') {
      return NextResponse.json({ status: 'done', recordingId: job.recordingId });
    }

    // A durable pending job survives navigation/deployment. Polling schedules it
    // again; the atomic claim prevents duplicate model calls, while stale running
    // jobs become recoverable after the worker lease expires.
    if (job.status === 'pending' || Date.now() - job.updatedAt >= 5 * 60_000) {
      waitUntil(processHandoutJob(job.id));
    }
    return NextResponse.json({ status: job.status, recordingId: job.recordingId });
  } catch (error) {
    return NextResponse.json(
      { error: 'handout_status_failed', message: error instanceof Error ? error.message : 'unknown' },
      { status: 503 },
    );
  }
}
