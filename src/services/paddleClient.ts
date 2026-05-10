'use client';

import type { Paddle } from '@paddle/paddle-js';

export interface OpenCheckoutOptions {
  paddle: Paddle;
  recordingId: string;
}

/**
 * Open Paddle Overlay Checkout for a single-recording one-time purchase.
 * The caller subscribes to checkout.completed via usePaddle().subscribe
 * before calling this — that's how it learns when to start polling /api/is-paid.
 */
export function openCheckout({ paddle, recordingId }: OpenCheckoutOptions): void {
  const priceId = process.env.NEXT_PUBLIC_PADDLE_PRICE_ID;
  if (!priceId) {
    throw new Error('NEXT_PUBLIC_PADDLE_PRICE_ID is not set');
  }
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customData: { recordingId },
    settings: {
      displayMode: 'overlay',
      theme: 'light',
      locale: 'zh',
    },
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
  userId: string;
  email?: string;
}

/**
 * Open Paddle Overlay Checkout for the Pro recurring subscription.
 * Customer pays via Paddle Sandbox or live env. After successful payment,
 * Paddle pushes `subscription.activated` → /api/paddle-webhook → user_subscriptions
 * row gets upserted with tier='pro'. Client side then re-fetches /api/me/tier.
 *
 * Important: userId is forwarded as customData.userId so the webhook can
 * identify which app user owns the subscription.
 */
export function openProSubscriptionCheckout({ paddle, userId, email }: OpenProSubscriptionOptions): void {
  const priceId = process.env.NEXT_PUBLIC_PADDLE_PRO_PRICE_ID;
  if (!priceId) {
    throw new Error(
      'NEXT_PUBLIC_PADDLE_PRO_PRICE_ID is not set. Create a Pro recurring product in Paddle dashboard and put its priceId in .env.local',
    );
  }
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customData: { userId, tier: 'pro' },
    customer: email ? { email } : undefined,
    settings: {
      displayMode: 'overlay',
      theme: 'light',
      locale: 'zh',
    },
  });
}
