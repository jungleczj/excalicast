import { NextResponse } from 'next/server';
import {
  verifyCreemWebhook,
  parseCreemEvent,
  extractOneTimePaid,
  extractSubscriptionEvent,
} from '@/services/creemServer';
import { markRecordingPaid, upsertSubscription } from '@/lib/db';
import { getAllCreemWebhookSecrets } from '@/lib/paymentConfig';

export const runtime = 'nodejs';

/**
 * Creem 回调入口。
 *
 * Creem 后台 → Webhooks → Endpoint：${NEXT_PUBLIC_APP_URL}/api/creem-webhook
 *
 * 验签：HMAC-SHA256(rawBody, CREEM_WEBHOOK_SECRET) === header['creem-signature']
 * 同时尝试 live + test 两套 secret，老的在飞重试也能验通。
 *
 * 分发：
 *   - `checkout.completed` + metadata.kind=='one_time'         → markRecordingPaid
 *   - `subscription.active/paid/canceled/paused/past_due`     → upsertSubscription
 *   - `checkout.completed` + metadata.kind=='pro_subscription' → 也当 active 处理（兜底）
 */
export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('creem-signature');

  const candidates = await getAllCreemWebhookSecrets();
  if (!verifyCreemWebhook(rawBody, signature, candidates)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const ev = parseCreemEvent(payload);
  if (!ev) {
    return NextResponse.json({ ok: true, ignored: 'unrecognised_payload' });
  }

  // 1) One-time payment（去水印）
  const oneTime = extractOneTimePaid(ev);
  if (oneTime) {
    await markRecordingPaid({
      recordingId: oneTime.recordingId,
      amountCents: oneTime.amountCents,
      currency: oneTime.currency,
      paddleTransactionId: `creem:${oneTime.transactionId}`,
      rawPayload: rawBody,
    });
    return NextResponse.json({ ok: true, kind: 'one_time' });
  }

  // 2) Subscription lifecycle
  const sub = extractSubscriptionEvent(ev);
  if (sub) {
    await upsertSubscription({
      userId: sub.userId,
      tier: sub.tier,
      status: sub.status,
      paddleSubscriptionId: `creem:${sub.subscriptionId}`,
      paddleCustomerId: sub.customerId ? `creem:${sub.customerId}` : null,
      currentPeriodEnd: sub.currentPeriodEnd,
      rawPayload: rawBody,
    });
    return NextResponse.json({ ok: true, kind: 'subscription', status: sub.status });
  }

  return NextResponse.json({ ok: true, ignored: ev.eventType });
}
