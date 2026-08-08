import { NextResponse, type NextRequest } from 'next/server';
import { getActiveConfig } from '@/lib/paymentConfig';
import { createCreemCheckout } from '@/services/creemServer';
import { createPaddleTransaction } from '@/services/paddleServer';
import { buildPaddleTransactionRequest } from '@/lib/paymentDomain';
import { completeCheckoutAttempt, failCheckoutAttempt, insertCheckoutAttempt } from '@/lib/db';
import { defaultLocale, LOCALE_COOKIE, locales } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 创建单次解锁（去水印）checkout。
 *
 * 入参：{ recordingId: string }
 *
 * 出参（按 provider 分两种）：
 *   - Paddle：{ provider:'paddle', priceId, recordingId } —— 客户端继续走 Paddle SDK overlay
 *   - Creem： { provider:'creem',  redirectUrl, checkoutId } —— 客户端 window.open
 *
 * 这条路由对 one-time 全开放（不需要登录）。
 */

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { recordingId?: string; returnTo?: string };
  try {
    body = (await req.json()) as { recordingId?: string; returnTo?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const recordingId = body.recordingId;
  if (!recordingId || typeof recordingId !== 'string') {
    return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });
  }

  const cfg = await getActiveConfig();
  if (!cfg) {
    return NextResponse.json({ error: 'no_active_payment_config' }, { status: 500 });
  }
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '') || 'http://localhost:3005';
  const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
  const locale = cookieLocale && (locales as readonly string[]).includes(cookieLocale) ? cookieLocale : defaultLocale;

  // returnTo：支付成功后回到发起页（如 /zh/export/[id]）。校验同 /api/auth/callback，
  // 仅接受站内绝对路径，防开放重定向；非法则回退原 /app 落地（带 recording 便于定位）。
  const returnTo = typeof body.returnTo === 'string' ? body.returnTo : undefined;
  const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null;
  const successUrl = safeReturnTo
    ? `${appUrl}${safeReturnTo}?creem_purchase=one_time`
    : `${appUrl}/${locale}/app?creem_purchase=one_time&recording=${encodeURIComponent(recordingId)}`;

  if (cfg.provider === 'creem') {
    if (!cfg.oneTimeProductId || !cfg.apiKey || !cfg.apiBase) {
      return NextResponse.json(
        { error: 'creem_creds_missing', mode: cfg.mode },
        { status: 500 },
      );
    }
    const attempt = await insertCheckoutAttempt({
      provider: 'creem',
      mode: cfg.mode,
      kind: 'one_time',
      tier: null,
      billing: null,
      recordingId,
      userId: null,
      productId: cfg.oneTimeProductId,
      rawRequest: JSON.stringify({ recordingId, returnTo: safeReturnTo }),
    });
    try {
      const result = await createCreemCheckout({
        creds: { apiKey: cfg.apiKey, apiBase: cfg.apiBase },
        productId: cfg.oneTimeProductId,
        successUrl,
        metadata: {
          kind: 'one_time',
          recordingId,
        },
        requestId: `one_time_${recordingId}_${Date.now()}`,
      });
      await completeCheckoutAttempt({
        id: attempt.id,
        providerTransactionId: result.id,
        rawResponse: JSON.stringify(result),
      });
      return NextResponse.json({
        provider: 'creem',
        attemptId: attempt.id,
        redirectUrl: result.checkoutUrl,
        checkoutId: result.id,
      });
    } catch (err) {
      await failCheckoutAttempt({
        id: attempt.id,
        rawResponse: err instanceof Error ? err.message : 'unknown',
      });
      return NextResponse.json(
        { error: 'creem_checkout_failed', message: err instanceof Error ? err.message : 'unknown' },
        { status: 502 },
      );
    }
  }

  if (!cfg.oneTimeProductId || !cfg.apiKey) {
    return NextResponse.json({ error: 'paddle_creds_missing', mode: cfg.mode }, { status: 500 });
  }
  const request = buildPaddleTransactionRequest({
    priceId: cfg.oneTimeProductId,
    customData: {
      kind: 'one_time',
      recordingId,
    },
  });
  const attempt = await insertCheckoutAttempt({
    provider: 'paddle',
    mode: cfg.mode,
    kind: 'one_time',
    tier: null,
    billing: null,
    recordingId,
    userId: null,
    productId: cfg.oneTimeProductId,
    rawRequest: JSON.stringify(request),
  });
  try {
    const tx = await createPaddleTransaction({
      mode: cfg.mode,
      apiKey: cfg.apiKey,
      apiBase: cfg.apiBase,
      request,
    });
    await completeCheckoutAttempt({
      id: attempt.id,
      providerTransactionId: tx.transactionId,
      rawResponse: tx.rawResponse,
    });
    return NextResponse.json({
      provider: 'paddle',
      attemptId: attempt.id,
      transactionId: tx.transactionId,
      recordingId,
    });
  } catch (err) {
    await failCheckoutAttempt({
      id: attempt.id,
      rawResponse: err instanceof Error ? err.message : 'unknown',
    });
    return NextResponse.json(
      { error: 'paddle_transaction_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    );
  }
}
