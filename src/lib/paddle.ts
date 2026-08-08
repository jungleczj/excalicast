import crypto from 'node:crypto';
import type { SubscriptionStatus, SubscriptionTier } from '@/types/user';
import {
  extractPaddlePriceRefs,
  resolvePaddleEntitlement,
  type PaymentProducts,
  type SubscriptionBilling,
} from '@/lib/paymentDomain';

export interface PaddleTransactionCompleted {
  transactionId: string;
  recordingId: string;
  amountCents: number;
  currency: string;
}

export interface PaddleSubscriptionEvent {
  eventType:
    | 'subscription.activated'
    | 'subscription.created'
    | 'subscription.updated'
    | 'subscription.cancelled'
    | 'subscription.paused'
    | 'subscription.resumed'
    | 'subscription.past_due'
    | 'subscription.trialing';
  subscriptionId: string;
  customerId: string | null;
  userId: string;             // 来自 custom_data.userId（前端打开 checkout 时塞进去）
  tier: Exclude<SubscriptionTier, 'free'>;
  billing: SubscriptionBilling;
  status: SubscriptionStatus;
  currentPeriodEnd: number | null;
  occurredAt: number | null;
}

export interface PaddleWebhookMeta {
  eventId: string;
  eventType: string;
  occurredAt: number | null;
}

/**
 * Verify Paddle webhook signature.
 * Header format: `Paddle-Signature: ts=<unix>;h1=<hex hmac>`
 * HMAC input: `${ts}:${rawBody}` (NOT the bare body — Paddle-specific)
 * Algorithm: HMAC-SHA256 with PADDLE_WEBHOOK_SECRET.
 *
 * Spec: https://developer.paddle.com/webhooks/signature-verification
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return process.env.DEV_MODE === 'true';
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(';').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const ts = parts['ts'];
  const h1 = parts['h1'];
  if (!ts || !h1) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - tsNum);
  if (ageSec > 300) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(h1, 'hex'));
  } catch {
    return false;
  }
}

export function verifyWebhookSignatureWithSecrets(
  rawBody: string,
  signatureHeader: string | null,
  secrets: string[],
): boolean {
  if (secrets.length === 0) return process.env.DEV_MODE === 'true';
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(';').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const ts = parts['ts'];
  const h1 = parts['h1'];
  if (!ts || !h1) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - tsNum);
  if (ageSec > 300) return false;

  return secrets.some((secret) => {
    const expected = crypto.createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(h1, 'hex'));
    } catch {
      return false;
    }
  });
}

export function getPaddleWebhookMeta(payload: unknown): PaddleWebhookMeta {
  if (!payload || typeof payload !== 'object') {
    return { eventId: '', eventType: '', occurredAt: null };
  }
  const p = payload as Record<string, unknown>;
  const occurredRaw = typeof p.occurred_at === 'string' ? Date.parse(p.occurred_at) : NaN;
  return {
    eventId: typeof p.event_id === 'string' ? p.event_id : '',
    eventType: typeof p.event_type === 'string' ? p.event_type : '',
    occurredAt: Number.isFinite(occurredRaw) ? occurredRaw : null,
  };
}

/**
 * Parse a `transaction.completed` Paddle webhook payload into our internal shape.
 * Returns null if event_type is not `transaction.completed` or required fields are missing.
 */
export function parseTransactionCompleted(
  payload: unknown,
  products?: PaymentProducts,
): PaddleTransactionCompleted | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.event_type !== 'transaction.completed') return null;

  const data = p.data as Record<string, unknown> | undefined;
  if (!data) return null;
  if (products) {
    const entitlement = resolvePaddleEntitlement(extractPaddlePriceRefs(payload), products);
    if (entitlement?.kind !== 'one_time') return null;
  }

  const transactionId = typeof data.id === 'string' ? data.id : '';
  if (!transactionId) return null;

  const customData = data.custom_data as Record<string, unknown> | undefined;
  const recordingId = customData && typeof customData.recordingId === 'string'
    ? customData.recordingId
    : '';
  if (!recordingId) return null;

  const currency = typeof data.currency_code === 'string' ? data.currency_code.toLowerCase() : 'usd';

  const details = data.details as Record<string, unknown> | undefined;
  const totals = details?.totals as Record<string, unknown> | undefined;
  const totalRaw = totals?.total;
  const amountCents = typeof totalRaw === 'string' ? Number(totalRaw) : Number(totalRaw ?? 0);

  return {
    transactionId,
    recordingId,
    amountCents: Number.isFinite(amountCents) ? amountCents : 0,
    currency,
  };
}

const SUB_EVENT_TYPES = new Set([
  'subscription.activated',
  'subscription.created',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.paused',
  'subscription.resumed',
  'subscription.past_due',
  'subscription.trialing',
]);

/**
 * Map Paddle subscription event_type + status fields to our internal SubscriptionStatus.
 */
function mapPaddleStatus(eventType: string, paddleStatus: string | undefined): SubscriptionStatus {
  if (eventType === 'subscription.cancelled') return 'cancelled';
  if (eventType === 'subscription.paused') return 'paused';
  if (eventType === 'subscription.past_due') return 'past_due';
  if (paddleStatus === 'active' || paddleStatus === 'trialing') return 'active';
  if (paddleStatus === 'paused') return 'paused';
  if (paddleStatus === 'past_due') return 'past_due';
  if (paddleStatus === 'canceled' || paddleStatus === 'cancelled') return 'cancelled';
  return 'active';
}

/**
 * Parse any subscription.* Paddle webhook event.
 * Requires custom_data.userId (set when client opens checkout).
 * Optional custom_data.tier defaults to 'pro'.
 *
 * Returns null if not a subscription event or userId missing.
 */
export function parseSubscriptionEvent(
  payload: unknown,
  products?: PaymentProducts,
): PaddleSubscriptionEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const eventType = typeof p.event_type === 'string' ? p.event_type : '';
  if (!SUB_EVENT_TYPES.has(eventType)) return null;

  const data = p.data as Record<string, unknown> | undefined;
  if (!data) return null;

  const subscriptionId = typeof data.id === 'string' ? data.id : '';
  if (!subscriptionId) return null;

  const customerId = typeof data.customer_id === 'string' ? data.customer_id : null;
  const customData = data.custom_data as Record<string, unknown> | undefined;
  const userId = customData && typeof customData.userId === 'string' ? customData.userId : '';
  if (!userId) return null;

  const entitlement = products
    ? resolvePaddleEntitlement(extractPaddlePriceRefs(payload), products)
    : null;
  const tierRaw = customData && typeof customData.tier === 'string' ? customData.tier : 'pro';
  const tier: Exclude<SubscriptionTier, 'free'> =
    entitlement?.kind === 'subscription'
      ? entitlement.tier
      : tierRaw === 'max'
        ? 'max'
        : 'pro';
  const billing: SubscriptionBilling =
    entitlement?.kind === 'subscription' ? entitlement.billing : 'monthly';

  const paddleStatus = typeof data.status === 'string' ? data.status : undefined;
  const status = mapPaddleStatus(eventType, paddleStatus);

  // Paddle billing periods live at data.current_billing_period.{starts_at, ends_at} (ISO strings)
  const cbp = data.current_billing_period as Record<string, unknown> | undefined;
  const endsAt = cbp && typeof cbp.ends_at === 'string' ? cbp.ends_at : undefined;
  const currentPeriodEnd = endsAt ? Date.parse(endsAt) : null;

  return {
    eventType: eventType as PaddleSubscriptionEvent['eventType'],
    subscriptionId,
    customerId,
    userId,
    tier,
    billing,
    status,
    currentPeriodEnd: Number.isFinite(currentPeriodEnd ?? NaN) ? currentPeriodEnd : null,
    occurredAt: getPaddleWebhookMeta(payload).occurredAt,
  };
}
