import { NextResponse } from 'next/server';
import { isRecordingPaid } from '@/lib/db';
import type { IsPaidRequest, IsPaidResponse } from '@/types/recording';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  let body: IsPaidRequest;
  try {
    body = (await req.json()) as IsPaidRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const recordingId = body.recordingId;
  if (!recordingId || typeof recordingId !== 'string') {
    return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });
  }
  const paid = isRecordingPaid(recordingId);
  const resp: IsPaidResponse = { paid };
  return NextResponse.json(resp);
}
