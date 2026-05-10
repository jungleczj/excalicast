import { NextResponse } from 'next/server';
import {
  verifyWebhookSignature,
  parseTransactionCompleted,
  parseSubscriptionEvent,
} from '@/lib/paddle';
import { markRecordingPaid, upsertSubscription } from '@/lib/db';

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

  // 1) 一次性购买（去水印 / 单次解锁）
  const txEvent = parseTransactionCompleted(payload);
  if (txEvent) {
    markRecordingPaid({
      recordingId: txEvent.recordingId,
      amountCents: txEvent.amountCents,
      currency: txEvent.currency,
      paddleTransactionId: txEvent.transactionId,
      rawPayload: rawBody,
    });
    return NextResponse.json({ ok: true, kind: 'transaction.completed' });
  }

  // 2) 订阅生命周期（Pro / Max）
  const subEvent = parseSubscriptionEvent(payload);
  if (subEvent) {
    upsertSubscription({
      userId: subEvent.userId,
      tier: subEvent.tier,
      status: subEvent.status,
      paddleSubscriptionId: subEvent.subscriptionId,
      paddleCustomerId: subEvent.customerId,
      currentPeriodEnd: subEvent.currentPeriodEnd,
      rawPayload: rawBody,
    });
    return NextResponse.json({ ok: true, kind: subEvent.eventType });
  }

  return NextResponse.json({ ok: true, ignored: true });
}
