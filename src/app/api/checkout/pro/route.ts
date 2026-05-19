import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveConfig } from '@/lib/paymentConfig';
import { createCreemCheckout } from '@/services/creemServer';
import { defaultLocale, LOCALE_COOKIE, locales } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 创建 Pro 订阅 checkout。
 *
 * 出参：
 *   - Paddle：{ provider:'paddle', priceId, userId } —— 走 Paddle SDK overlay
 *   - Creem： { provider:'creem',  redirectUrl, checkoutId }
 *
 * 必须已登录（Pro 订阅必须能绑定 Supabase userId）。
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const cfg = await getActiveConfig();
  if (!cfg) {
    return NextResponse.json({ error: 'no_active_payment_config' }, { status: 500 });
  }
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '') || 'http://localhost:3005';
  const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
  const locale = cookieLocale && (locales as readonly string[]).includes(cookieLocale) ? cookieLocale : defaultLocale;

  if (cfg.provider === 'creem') {
    if (!cfg.proProductId || !cfg.apiKey || !cfg.apiBase) {
      return NextResponse.json(
        { error: 'creem_creds_missing', mode: cfg.mode },
        { status: 500 },
      );
    }
    try {
      const result = await createCreemCheckout({
        creds: { apiKey: cfg.apiKey, apiBase: cfg.apiBase },
        productId: cfg.proProductId,
        successUrl: `${appUrl}/${locale}/app?creem_purchase=pro`,
        customerEmail: user.email ?? undefined,
        metadata: {
          kind: 'pro_subscription',
          userId: user.id,
        },
        requestId: `pro_${user.id}_${Date.now()}`,
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

  if (!cfg.proProductId) {
    return NextResponse.json({ error: 'paddle_pro_price_id_missing' }, { status: 500 });
  }
  return NextResponse.json({
    provider: 'paddle',
    priceId: cfg.proProductId,
    userId: user.id,
    email: user.email ?? null,
  });
}
