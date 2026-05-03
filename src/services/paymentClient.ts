'use client';

import type {
  CheckoutRequest,
  CheckoutResponse,
  IsPaidRequest,
  IsPaidResponse,
} from '@/types/recording';

export async function isPaid(recordingId: string): Promise<boolean> {
  const res = await fetch('/api/is-paid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId } satisfies IsPaidRequest),
  });
  if (!res.ok) throw new Error(`is-paid ${res.status}`);
  const data = (await res.json()) as IsPaidResponse;
  return data.paid;
}

export async function startCheckout(recordingId: string): Promise<CheckoutResponse> {
  const returnPath = typeof window !== 'undefined'
    ? (window.location.pathname + window.location.search)
    : undefined;
  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId, returnPath } satisfies CheckoutRequest),
  });
  if (!res.ok) throw new Error(`checkout ${res.status}`);
  return (await res.json()) as CheckoutResponse;
}

export async function simulatePayment(recordingId: string): Promise<void> {
  const res = await fetch('/api/dev/simulate-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId }),
  });
  if (!res.ok) throw new Error(`simulate-payment ${res.status}`);
}
