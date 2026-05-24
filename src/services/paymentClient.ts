'use client';

import type { IsPaidRequest, IsPaidResponse } from '@/types/recording';

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

