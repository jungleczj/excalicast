import { NextResponse } from 'next/server';
import {
  getPaymentConfig,
  setPaymentConfig,
  type PaymentConfigPatch,
} from '@/lib/paymentConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin-only：读 / 改支付配置。
 *
 * 鉴权：请求头 `x-admin-secret: ${ADMIN_SECRET}` 必须匹配环境变量。
 * 没设 ADMIN_SECRET 则所有写入直接 403（防 misconfigured 暴露）。
 *
 * 用法：
 *   GET  /api/admin/payment-config           -H "x-admin-secret: <secret>"
 *   POST /api/admin/payment-config { ... }   -H "x-admin-secret: <secret>" -H "content-type: application/json"
 *
 * POST 字段（任意子集，缺失字段不改动）：
 *   provider: 'paddle' | 'creem'
 *   currency: 'usd' | 'cny' | ...
 *   oneTimePriceCents: 300
 *   proMonthlyPriceCents: 900
 *   paddleOneTimePriceId, paddleProPriceId, creemOneTimeProductId, creemProProductId: 字符串 / null
 */

function checkAuth(req: Request): NextResponse | null {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'admin_secret_not_configured' },
      { status: 403 },
    );
  }
  const got = req.headers.get('x-admin-secret');
  if (got !== expected) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const denied = checkAuth(req);
  if (denied) return denied;
  const cfg = await getPaymentConfig();
  return NextResponse.json(cfg);
}

export async function POST(req: Request): Promise<NextResponse> {
  const denied = checkAuth(req);
  if (denied) return denied;

  let body: PaymentConfigPatch;
  try {
    body = (await req.json()) as PaymentConfigPatch;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (body.provider != null && body.provider !== 'paddle' && body.provider !== 'creem') {
    return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
  }
  if (body.oneTimePriceCents != null && (typeof body.oneTimePriceCents !== 'number' || body.oneTimePriceCents < 0)) {
    return NextResponse.json({ error: 'invalid_one_time_price' }, { status: 400 });
  }
  if (body.proMonthlyPriceCents != null && (typeof body.proMonthlyPriceCents !== 'number' || body.proMonthlyPriceCents < 0)) {
    return NextResponse.json({ error: 'invalid_pro_monthly_price' }, { status: 400 });
  }
  if (body.currency != null && (typeof body.currency !== 'string' || body.currency.length > 8)) {
    return NextResponse.json({ error: 'invalid_currency' }, { status: 400 });
  }

  const next = await setPaymentConfig(body);
  return NextResponse.json(next);
}
