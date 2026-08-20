import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { NextResponse } from 'next/server';
import { getCloudRecording } from '@/lib/db';
import { createHandoutJob } from '@/lib/handoutJobStore';
import { requireTier } from '@/lib/tier';
import { processHandoutJob } from '@/services/handoutJob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request): Promise<NextResponse> {
  const guard = await requireTier(req, 'max');
  if ('error' in guard) return guard.error;

  let body: { recordingId?: string };
  try {
    body = await req.json() as { recordingId?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const recordingId = body.recordingId?.trim();
  if (!recordingId) return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });

  const cloud = await getCloudRecording(guard.userId, recordingId);
  if (!cloud) {
    return NextResponse.json(
      { error: 'cloud_recording_required', message: '请先把录制备份到云端再生成讲义' },
      { status: 409 },
    );
  }

  try {
    const job = await createHandoutJob({ id: randomUUID(), userId: guard.userId, recordingId });
    waitUntil(processHandoutJob(job.id));
    return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: 'handout_submit_failed', message: error instanceof Error ? error.message : 'unknown' },
      { status: 503 },
    );
  }
}
