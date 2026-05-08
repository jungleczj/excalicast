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
