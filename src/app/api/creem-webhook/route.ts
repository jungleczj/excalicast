import { NextResponse } from 'next/server';
import {
  verifyCreemWebhook,
  parseCreemEvent,
  extractOneTimePaid,
  extractSubscriptionEvent,
} from '@/services/creemServer';
import { markRecordingPaid, recordPaymentWebhookEvent, releasePaymentWebhookEvent, upsertProviderSubscription } from '@/lib/db';
import { getAllCreemWebhookSecrets } from '@/lib/paymentConfig';
import crypto from 'node:crypto';

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
  const eventMeta = getCreemWebhookMeta(payload, rawBody);
  const claim = await recordPaymentWebhookEvent({
    provider: 'creem',
    eventId: eventMeta.eventId,
    eventType: eventMeta.eventType,
    occurredAt: eventMeta.occurredAt,
    rawPayload: rawBody,
  });
  if (claim.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
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
      const result = await upsertProviderSubscription({
        userId: sub.userId,
        provider: 'creem',
        tier: sub.tier,
        status: sub.status,
        providerSubscriptionId: sub.subscriptionId,
        providerCustomerId: sub.customerId,
        currentPeriodEnd: sub.currentPeriodEnd,
        eventOccurredAt: eventMeta.occurredAt,
        rawPayload: rawBody,
      });
      return NextResponse.json({ ok: true, kind: 'subscription', status: sub.status, applied: result.applied });
    }

    return NextResponse.json({ ok: true, ignored: ev.eventType });
  } catch (error) {
    await releasePaymentWebhookEvent('creem', eventMeta.eventId);
    throw error;
  }
}

function getCreemWebhookMeta(payload: unknown, rawBody: string): {
  eventId: string;
  eventType: string;
  occurredAt: number | null;
} {
  const p = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const eventId = firstString(p.id, p.event_id) ?? `sha256:${crypto.createHash('sha256').update(rawBody).digest('hex')}`;
  const eventType = firstString(p.eventType, p.event_type, p.type) ?? 'unknown';
  const rawOccurred = firstString(p.occurred_at, p.created_at, p.createdAt);
  const occurredAt = rawOccurred
    ? (/^\d+$/.test(rawOccurred) ? Number(rawOccurred) * 1000 : Date.parse(rawOccurred))
    : NaN;
  return {
    eventId,
    eventType,
    occurredAt: Number.isFinite(occurredAt) ? occurredAt : null,
  };
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}
