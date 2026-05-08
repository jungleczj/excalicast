import { NextResponse } from 'next/server';
import { verifyWebhookSignature, parseTransactionCompleted } from '@/lib/paddle';
import { markRecordingPaid } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('paddle-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const event = parseTransactionCompleted(payload);
  if (!event) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  markRecordingPaid({
    recordingId: event.recordingId,
    amountCents: event.amountCents,
    currency: event.currency,
    paddleTransactionId: event.transactionId,
    rawPayload: rawBody,
  });

  return NextResponse.json({ ok: true });
}
