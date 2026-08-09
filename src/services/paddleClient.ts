'use client';

import type { Paddle } from '@paddle/paddle-js';

export interface NormalizedPaddleCheckoutEvent {
  name: string;
  data?: unknown;
  diagnostic?: { transactionId?: string };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function safeCheckoutName(value: unknown): string | null {
  return typeof value === 'string' && /^checkout\.[a-z_.]+$/.test(value) ? value : null;
}

export function normalizePaddleCheckoutEvent(event: unknown): NormalizedPaddleCheckoutEvent | null {
  const root = record(event);
  if (!root) return null;
  const name = safeCheckoutName(root.name) ?? safeCheckoutName(root.type);
  if (!name) return null;

  if (name === 'checkout.warning' || name === 'checkout.error' || name === 'checkout.payment.error') {
    const errors = Array.isArray(root.errors) ? root.errors : [];
    const fields = errors
      .map((item) => record(item)?.field)
      .filter((field): field is string => typeof field === 'string' && field.startsWith('/'));
    return {
      name,
      data: {
        code: typeof root.code === 'string' ? root.code : 'unknown',
        documentationUrl: typeof root.documentation_url === 'string' ? root.documentation_url : null,
        fields,
      },
    };
  }

  const data = root.data;
  const transactionId = record(data)?.transaction_id;
  return {
    name,
    ...(data !== undefined ? { data } : {}),
    ...(typeof transactionId === 'string' && transactionId.startsWith('txn_')
      ? { diagnostic: { transactionId } }
      : {}),
  };
}

export interface OpenCheckoutOptions {
  paddle: Paddle;
  transactionId: string;
}

/**
 * Open Paddle Overlay Checkout for a single-recording one-time purchase.
 * The caller subscribes to checkout.completed via usePaddle().subscribe
 * before calling this — that's how it learns when to start polling /api/is-paid.
 */
export function openCheckout({ paddle, transactionId }: OpenCheckoutOptions): void {
  paddle.Checkout.open({
    transactionId,
  });
}

export function closeCheckout(paddle: Paddle): void {
  try {
    paddle.Checkout.close();
  } catch {
    // safe to ignore — already closed
  }
}

export interface OpenProSubscriptionOptions {
  paddle: Paddle;
  transactionId: string;
}

/**
 * Open Paddle Overlay Checkout for the Pro / Max recurring subscription.
 * Customer pays via Paddle Sandbox or live env. After successful payment,
 * Paddle pushes `subscription.activated` → /api/paddle-webhook → user_subscriptions
 * row gets upserted with the tier carried in custom_data.tier. Client side then
 * re-fetches /api/me/tier.
 *
 * Important: userId is forwarded as customData.userId so the webhook can
 * identify which app user owns the subscription; tier tells it which plan.
 */
export function openProSubscriptionCheckout({ paddle, transactionId }: OpenProSubscriptionOptions): void {
  paddle.Checkout.open({
    transactionId,
  });
}
