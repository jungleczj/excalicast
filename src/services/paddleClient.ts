'use client';

import type { Paddle } from '@paddle/paddle-js';

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
