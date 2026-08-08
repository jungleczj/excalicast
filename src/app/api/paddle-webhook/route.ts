import { NextResponse } from 'next/server';
import {
  getPaddleWebhookMeta,
  verifyWebhookSignature,
  verifyWebhookSignatureWithSecrets,
  parseTransactionCompleted,
  parseSubscriptionEvent,
} from '@/lib/paddle';
import { markRecordingPaid, recordPaymentWebhookEvent, releasePaymentWebhookEvent, upsertProviderSubscription } from '@/lib/db';
import { getActiveConfig, getAllPaddleWebhookSecrets, listAllConfigs } from '@/lib/paymentConfig';
import { productsFromConfig, type PaymentProducts } from '@/lib/paymentDomain';
import crypto from 'node:crypto';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('paddle-signature');

  const secrets = await getAllPaddleWebhookSecrets();
  const verified = secrets.length > 0
    ? verifyWebhookSignatureWithSecrets(rawBody, signature, secrets)
    : verifyWebhookSignature(rawBody, signature);
  if (!verified) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const meta = getPaddleWebhookMeta(payload);
  const eventId = meta.eventId || `sha256:${crypto.createHash('sha256').update(rawBody).digest('hex')}`;
  const claim = await recordPaymentWebhookEvent({
    provider: 'paddle',
    eventId,
    eventType: meta.eventType || 'unknown',
    occurredAt: meta.occurredAt,
    rawPayload: rawBody,
  });
  if (claim.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    const products = await getPaddleProducts();

    // 1) 一次性购买（去水印 / 单次解锁）
    const txEvent = parseTransactionCompleted(payload, products);
    if (txEvent) {
      await markRecordingPaid({
        recordingId: txEvent.recordingId,
        amountCents: txEvent.amountCents,
        currency: txEvent.currency,
        paddleTransactionId: txEvent.transactionId,
        rawPayload: rawBody,
      });
      return NextResponse.json({ ok: true, kind: 'transaction.completed' });
    }

    // 2) 订阅生命周期（Pro / Max）
    const subEvent = parseSubscriptionEvent(payload, products);
    if (subEvent) {
      const result = await upsertProviderSubscription({
        userId: subEvent.userId,
        provider: 'paddle',
        tier: subEvent.tier,
        status: subEvent.status,
        providerSubscriptionId: subEvent.subscriptionId,
        providerCustomerId: subEvent.customerId,
        currentPeriodEnd: subEvent.currentPeriodEnd,
        eventOccurredAt: subEvent.occurredAt,
        rawPayload: rawBody,
      });
      return NextResponse.json({ ok: true, kind: subEvent.eventType, applied: result.applied });
    }

    return NextResponse.json({ ok: true, ignored: true });
  } catch (error) {
    await releasePaymentWebhookEvent('paddle', eventId);
    throw error;
  }
}

async function getPaddleProducts(): Promise<PaymentProducts | undefined> {
  const active = await getActiveConfig();
  if (active?.provider === 'paddle') return productsFromConfig(active);
  const paddleRows = (await listAllConfigs()).filter((row) => row.provider === 'paddle');
  const merged: PaymentProducts = {
    oneTimeProductId: null,
    proProductId: null,
    maxProductId: null,
    proYearlyProductId: null,
    maxYearlyProductId: null,
  };
  for (const row of paddleRows) {
    const products = productsFromConfig(row);
    merged.oneTimeProductId ??= products.oneTimeProductId;
    merged.proProductId ??= products.proProductId;
    merged.maxProductId ??= products.maxProductId;
    merged.proYearlyProductId ??= products.proYearlyProductId;
    merged.maxYearlyProductId ??= products.maxYearlyProductId;
  }
  return Object.values(merged).some(Boolean) ? merged : undefined;
}
