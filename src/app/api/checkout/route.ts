import { NextResponse } from 'next/server';
import { createCheckoutSession } from '@/lib/creem';
import type { CheckoutRequest, CheckoutResponse } from '@/types/recording';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  let body: CheckoutRequest;
  try {
    body = (await req.json()) as CheckoutRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const recordingId = body.recordingId;
  if (!recordingId || typeof recordingId !== 'string') {
    return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });
  }

  const amountCents = Number(process.env.SINGLE_PURCHASE_PRICE_CENTS ?? 300);
  const currency = String(process.env.SINGLE_PURCHASE_CURRENCY ?? 'usd');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';

  // 默认回到 /export/[id]；客户端可以传 returnPath 覆盖
  const safeReturnPath = (() => {
    const p = body.returnPath;
    if (typeof p !== 'string') return `/export/${recordingId}`;
    if (!p.startsWith('/')) return `/export/${recordingId}`;
    if (p.startsWith('//')) return `/export/${recordingId}`;
    return p;
  })();
  const sep = safeReturnPath.includes('?') ? '&' : '?';
  const successUrl = `${appUrl}${safeReturnPath}${sep}paid=1&recording_id=${encodeURIComponent(recordingId)}`;

  try {
    const session = await createCheckoutSession({
      recordingId,
      amountCents,
      currency,
      successUrl,
    });
    const resp: CheckoutResponse = { checkoutUrl: session.url, sessionId: session.id };
    return NextResponse.json(resp);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'checkout_failed', message }, { status: 502 });
  }
}
