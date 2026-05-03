import { NextResponse } from 'next/server';
import { verifyWebhookSignature, parseWebhookPayload } from '@/lib/creem';
import { markRecordingPaid } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('creem-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const event = parseWebhookPayload(payload);
  if (!event) {
    return NextResponse.json({ error: 'unparseable_payload' }, { status: 400 });
  }

  if (event.data.status !== 'paid') {
    return NextResponse.json({ ok: true, ignored: true, reason: 'not_paid' });
  }

  const recordingId = event.data.metadata.recordingId;
  if (!recordingId) {
    return NextResponse.json({ error: 'missing_recording_id_in_metadata' }, { status: 400 });
  }

  markRecordingPaid({
    recordingId,
    amountCents: event.data.amountCents,
    currency: event.data.currency,
    creemSessionId: event.data.sessionId,
    rawPayload: rawBody,
  });

  return NextResponse.json({ ok: true });
}
