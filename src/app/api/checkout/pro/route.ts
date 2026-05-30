import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveConfig } from '@/lib/paymentConfig';
import { createCreemCheckout } from '@/services/creemServer';
import { defaultLocale, LOCALE_COOKIE, locales } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 创建 Pro / Max 订阅 checkout。
 *
 * 入参（可选 body）：{ tier?: 'pro' | 'max' }，默认 'pro'。
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
  try {
    const body = (await req.json().catch(() => ({}))) as { tier?: string };
    if (body.tier === 'max') tier = 'max';
  } catch {
    // 无 body → 默认 pro
  }

  const cfg = await getActiveConfig();
  if (!cfg) {
    return NextResponse.json({ error: 'no_active_payment_config' }, { status: 500 });
  }
  const productId = tier === 'max' ? cfg.maxProductId : cfg.proProductId;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '') || 'http://localhost:3005';
  const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
  const locale = cookieLocale && (locales as readonly string[]).includes(cookieLocale) ? cookieLocale : defaultLocale;

  if (cfg.provider === 'creem') {
    if (!productId || !cfg.apiKey || !cfg.apiBase) {
      return NextResponse.json(
        { error: 'creem_creds_missing', mode: cfg.mode, tier },
        { status: 500 },
      );
    }
    try {
      const result = await createCreemCheckout({
        creds: { apiKey: cfg.apiKey, apiBase: cfg.apiBase },
        productId,
        successUrl: `${appUrl}/${locale}/app?creem_purchase=${tier}`,
        customerEmail: user.email ?? undefined,
        metadata: {
          kind: tier === 'max' ? 'max_subscription' : 'pro_subscription',
          tier,
          userId: user.id,
        },
        requestId: `${tier}_${user.id}_${Date.now()}`,
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

  if (!productId) {
    return NextResponse.json({ error: 'paddle_price_id_missing', tier }, { status: 500 });
  }
  return NextResponse.json({
    provider: 'paddle',
    priceId: productId,
    userId: user.id,
    email: user.email ?? null,
    tier,
  });
}
