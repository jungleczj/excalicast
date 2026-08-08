import type { PaymentConfigRow } from '@/lib/paymentConfig';
import type { SubscriptionStatus, SubscriptionTier } from '@/types/user';

export type SubscriptionBilling = 'monthly' | 'yearly';

export type CheckoutRequest =
  | { kind: 'one_time' }
  | { kind: 'subscription'; tier: Exclude<SubscriptionTier, 'free'>; billing: SubscriptionBilling };

export interface PaymentProducts {
  oneTimeProductId: string | null;
  proProductId: string | null;
  maxProductId: string | null;
  proYearlyProductId: string | null;
  maxYearlyProductId: string | null;
}

export type PaymentEntitlement =
  | { kind: 'one_time' }
  | { kind: 'subscription'; tier: Exclude<SubscriptionTier, 'free'>; billing: SubscriptionBilling };

export interface PaidPriceRef {
  priceId: string;
}

export interface PaddleTransactionRequestInput {
  priceId: string;
  customData: Record<string, unknown>;
}

export interface PaddleTransactionRequest {
  collection_mode: 'automatic';
  items: Array<{ price_id: string; quantity: number }>;
  custom_data: Record<string, unknown>;
}

export interface EntitledSubscription {
  provider: string;
  tier: Exclude<SubscriptionTier, 'free'>;
  status: SubscriptionStatus;
  currentPeriodEnd: number | null;
}

export function productsFromConfig(cfg: PaymentConfigRow): PaymentProducts {
  return {
    oneTimeProductId: cfg.oneTimeProductId,
    proProductId: cfg.proProductId,
    maxProductId: cfg.maxProductId,
    proYearlyProductId: cfg.proYearlyProductId,
    maxYearlyProductId: cfg.maxYearlyProductId,
  };
}

export function getCheckoutProductId(products: PaymentProducts, request: CheckoutRequest): string | null {
  if (request.kind === 'one_time') return products.oneTimeProductId;
  if (request.tier === 'max') {
    return request.billing === 'yearly' ? products.maxYearlyProductId : products.maxProductId;
  }
  return request.billing === 'yearly' ? products.proYearlyProductId : products.proProductId;
}

export function resolvePaddleEntitlement(
  paidPrices: PaidPriceRef[],
  products: PaymentProducts,
): PaymentEntitlement | null {
  const priceIds = new Set(paidPrices.map((item) => item.priceId).filter(Boolean));
  if (products.maxYearlyProductId && priceIds.has(products.maxYearlyProductId)) {
    return { kind: 'subscription', tier: 'max', billing: 'yearly' };
  }
  if (products.maxProductId && priceIds.has(products.maxProductId)) {
    return { kind: 'subscription', tier: 'max', billing: 'monthly' };
  }
  if (products.proYearlyProductId && priceIds.has(products.proYearlyProductId)) {
    return { kind: 'subscription', tier: 'pro', billing: 'yearly' };
  }
  if (products.proProductId && priceIds.has(products.proProductId)) {
    return { kind: 'subscription', tier: 'pro', billing: 'monthly' };
  }
  if (products.oneTimeProductId && priceIds.has(products.oneTimeProductId)) {
    return { kind: 'one_time' };
  }
  return null;
}

export function isSubscriptionCurrentlyEntitled(
  sub: Pick<EntitledSubscription, 'status' | 'currentPeriodEnd'>,
  now = Date.now(),
): boolean {
  if (sub.status === 'active' || sub.status === 'paused') return true;
  if (sub.status === 'cancelled' || sub.status === 'past_due') {
    return typeof sub.currentPeriodEnd === 'number' && sub.currentPeriodEnd > now;
  }
  return false;
}

export function resolveHighestEntitlement(
  subscriptions: EntitledSubscription[],
  now = Date.now(),
): EntitledSubscription | null {
  const tierRank: Record<Exclude<SubscriptionTier, 'free'>, number> = { pro: 1, max: 2 };
  let best: EntitledSubscription | null = null;
  for (const sub of subscriptions) {
    if (!isSubscriptionCurrentlyEntitled(sub, now)) continue;
    if (!best || tierRank[sub.tier] > tierRank[best.tier]) {
      best = sub;
    }
  }
  return best;
}

export function buildPaddleTransactionRequest(input: PaddleTransactionRequestInput): PaddleTransactionRequest {
  return {
    collection_mode: 'automatic',
    items: [{ price_id: input.priceId, quantity: 1 }],
    custom_data: input.customData,
  };
}

export function extractPaddlePriceRefs(payload: unknown): PaidPriceRef[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object'
    ? root.data as Record<string, unknown>
    : root;
  const items = Array.isArray(data.items) ? data.items : [];

  const refs: PaidPriceRef[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const price = row.price && typeof row.price === 'object'
      ? row.price as Record<string, unknown>
      : null;
    const priceId = typeof price?.id === 'string'
      ? price.id
      : typeof row.price_id === 'string'
        ? row.price_id
        : '';
    if (priceId) refs.push({ priceId });
  }
  return refs;
}

export function shouldApplySubscriptionEvent(
  eventOccurredAt: number | null,
  previousOccurredAt: number | null,
): boolean {
  if (eventOccurredAt == null || !Number.isFinite(eventOccurredAt)) return true;
  if (previousOccurredAt == null || !Number.isFinite(previousOccurredAt)) return true;
  return eventOccurredAt >= previousOccurredAt;
}
