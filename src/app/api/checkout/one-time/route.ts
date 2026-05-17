import { NextResponse } from 'next/server';
import { getPaymentConfig } from '@/lib/paymentConfig';
import { createCreemCheckout } from '@/services/creemServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 创建单次解锁（去水印）checkout。
 *
 * 入参：{ recordingId: string }
 *
 * 出参（按 provider 分两种）：
 *   - Paddle：{ provider:'paddle', priceId, recordingId } —— 客户端继续走 Paddle SDK overlay
 *   - Creem： { provider:'creem',  redirectUrl, checkoutId } —— 客户端 window.location 或 window.open
 *
 * 这条路由对 one-time 全开放（不需要登录），与现有 Paddle 一次性流程一致。
 */

export async function POST(req: Request): Promise<NextResponse> {
  let body: { recordingId?: string };
  try {
    body = (await req.json()) as { recordingId?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const recordingId = body.recordingId;
  if (!recordingId || typeof recordingId !== 'string') {
    return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });
  }

  const cfg = await getPaymentConfig();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '') || 'http://localhost:3005';

  if (cfg.provider === 'creem') {
    const productId = cfg.creemOneTimeProductId;
    if (!productId) {
      return NextResponse.json(
        { error: 'creem_one_time_product_id_missing' },
        { status: 500 },
      );
    }
    try {
      const result = await createCreemCheckout({
        productId,
        successUrl: `${appUrl}/app?creem_purchase=one_time&recording=${encodeURIComponent(recordingId)}`,
        metadata: {
          kind: 'one_time',
          recordingId,
        },
        requestId: `one_time_${recordingId}_${Date.now()}`,
      });
      return NextResponse.json({
        provider: 'creem',
        redirectUrl: result.checkoutUrl,
        checkoutId: result.id,
      });
    } catch (err) {
      return NextResponse.json(
        { error: 'creem_checkout_failed', message: err instanceof Error ? err.message : 'unknown' },
        { status: 502 },
      );
    }
  }

  // Paddle path — UI sticks with SDK overlay, we just return the priceId
  const priceId = cfg.paddleOneTimePriceId ?? process.env.NEXT_PUBLIC_PADDLE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: 'paddle_price_id_missing' }, { status: 500 });
  }
  return NextResponse.json({
    provider: 'paddle',
    priceId,
    recordingId,
  });
}
