import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveConfig } from '@/lib/paymentConfig';
import { createCreemCheckout } from '@/services/creemServer';
import { createPaddleTransaction } from '@/services/paddleServer';
import { buildPaddleTransactionRequest } from '@/lib/paymentDomain';
import { completeCheckoutAttempt, failCheckoutAttempt, insertCheckoutAttempt } from '@/lib/db';
import { defaultLocale, LOCALE_COOKIE, locales } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 创建 Pro / Max 订阅 checkout。
 *
 * 入参（可选 body）：{ tier?: 'pro' | 'max', billing?: 'monthly' | 'yearly' }，默认 tier='pro' / billing='monthly'。
 * billing='yearly' 时使用对应套餐的年付 product；未配置年付 product → creem_creds_missing。
 *
 * 出参：
 *   - Paddle：{ provider:'paddle', priceId, userId, tier } —— 走 Paddle SDK overlay
 *   - Creem： { provider:'creem',  redirectUrl, checkoutId }
 *
 * 必须已登录（订阅必须能绑定 Supabase userId）。
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let tier: 'pro' | 'max' = 'pro';
  let billing: 'monthly' | 'yearly' = 'monthly';
  let returnTo: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { tier?: string; billing?: string; returnTo?: string };
    if (body.tier === 'max') tier = 'max';
    if (body.billing === 'yearly') billing = 'yearly';
    if (typeof body.returnTo === 'string') returnTo = body.returnTo;
  } catch {
    // 无 body → 默认 pro / monthly
  }

  const cfg = await getActiveConfig();
  if (!cfg) {
    return NextResponse.json({ error: 'no_active_payment_config' }, { status: 500 });
  }
  const productId = billing === 'yearly'
    ? (tier === 'max' ? cfg.maxYearlyProductId : cfg.proYearlyProductId)
    : (tier === 'max' ? cfg.maxProductId : cfg.proProductId);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '') || 'http://localhost:3005';
  const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
  const locale = cookieLocale && (locales as readonly string[]).includes(cookieLocale) ? cookieLocale : defaultLocale;

  // returnTo：让支付成功后回到发起页（如 /zh/export/[id]），而不是写死 /app。
  // 校验同 /api/auth/callback：仅接受站内绝对路径，防开放重定向；非法则回退 /app。
  const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null;
  const successUrl = safeReturnTo
    ? `${appUrl}${safeReturnTo}?creem_purchase=${tier}`
    : `${appUrl}/${locale}/app?creem_purchase=${tier}`;

  if (cfg.provider === 'creem') {
    if (!productId || !cfg.apiKey || !cfg.apiBase) {
      return NextResponse.json(
        { error: 'creem_creds_missing', mode: cfg.mode, tier, billing },
        { status: 500 },
      );
    }
    const attempt = await insertCheckoutAttempt({
      provider: 'creem',
      mode: cfg.mode,
      kind: 'subscription',
      tier,
      billing,
      recordingId: null,
      userId: user.id,
      productId,
      rawRequest: JSON.stringify({ tier, billing, returnTo: safeReturnTo }),
    });
    try {
      const result = await createCreemCheckout({
        creds: { apiKey: cfg.apiKey, apiBase: cfg.apiBase },
        productId,
        successUrl,
        customerEmail: user.email ?? undefined,
        metadata: {
          // _yearly 后缀仅用于审计/对账；真正的订阅周期由 Creem 按 product 自动报回。
          kind: `${tier === 'max' ? 'max_subscription' : 'pro_subscription'}${billing === 'yearly' ? '_yearly' : ''}`,
          tier,
          billing,
          userId: user.id,
        },
        requestId: `${tier}_${billing}_${user.id}_${Date.now()}`,
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

  if (!productId || !cfg.apiKey) {
    return NextResponse.json({ error: 'paddle_creds_missing', mode: cfg.mode, tier, billing }, { status: 500 });
  }
  const request = buildPaddleTransactionRequest({
    priceId: productId,
    customData: {
      kind: 'subscription',
      userId: user.id,
      tier,
      billing,
    },
  });
  const attempt = await insertCheckoutAttempt({
    provider: 'paddle',
    mode: cfg.mode,
    kind: 'subscription',
    tier,
    billing,
    recordingId: null,
    userId: user.id,
    productId,
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
      tier,
      billing,
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
