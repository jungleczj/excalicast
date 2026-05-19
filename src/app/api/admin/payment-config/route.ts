import { NextResponse } from 'next/server';
import {
  getActiveConfig,
  getConfigByProviderMode,
  listAllConfigs,
  PaymentConfigMismatchError,
  toPublic,
  upsertConfigRow,
  type PaymentConfigPatch,
  type PaymentMode,
  type PaymentProvider,
} from '@/lib/paymentConfig';
import { fetchCreemProduct } from '@/services/creemServer';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin-only：读 / 写支付配置。
 *
 * 鉴权：HTTP header `x-admin-secret: ${ADMIN_SECRET}` 必须匹配环境变量。
 *
 * 端点：
 *   GET  /api/admin/payment-config            → 列全部 4 行 + 当前 active
 *   POST /api/admin/payment-config (+body)    → upsert 一行 by (provider, mode)
 *   POST /api/admin/payment-config/activate   → 切换激活行（见 ./activate/route.ts）
 *
 * 写入前如果 provider=creem 且涉及价格/productId → 调 Creem GET /products/{id} 校验，
 * 价格或币种对不上返 409 + hint。Creem API 不可达或 product 404 时仅记 warning，不阻塞写入。
 */

function checkAuth(req: Request): NextResponse | null {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'admin_secret_not_configured' }, { status: 403 });
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
  const all = await listAllConfigs();
  const active = all.find((r) => r.isActive) ?? null;
  return NextResponse.json({
    active: active ? { provider: active.provider, mode: active.mode } : null,
    rows: all,
  });
}

interface PostBody {
  provider?: string;
  mode?: string;
  currency?: string;
  oneTimePriceCents?: number;
  proMonthlyPriceCents?: number;
  apiKey?: string | null;
  webhookSecret?: string | null;
  apiBase?: string | null;
  oneTimeProductId?: string | null;
  proProductId?: string | null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const denied = checkAuth(req);
  if (denied) return denied;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (body.provider !== 'creem' && body.provider !== 'paddle') {
    return NextResponse.json({ error: 'invalid_provider', hint: "provider must be 'creem' or 'paddle'" }, { status: 400 });
  }
  if (body.mode !== 'live' && body.mode !== 'test') {
    return NextResponse.json({ error: 'invalid_mode', hint: "mode must be 'live' or 'test'" }, { status: 400 });
  }
  for (const k of ['oneTimePriceCents', 'proMonthlyPriceCents'] as const) {
    if (body[k] != null && (typeof body[k] !== 'number' || body[k]! < 0)) {
      return NextResponse.json({ error: `invalid_${k}` }, { status: 400 });
    }
  }
  if (body.currency != null && (typeof body.currency !== 'string' || body.currency.length > 8)) {
    return NextResponse.json({ error: 'invalid_currency' }, { status: 400 });
  }

  const patch: PaymentConfigPatch = {
    provider: body.provider as PaymentProvider,
    mode: body.mode as PaymentMode,
    currency: body.currency,
    oneTimePriceCents: body.oneTimePriceCents,
    proMonthlyPriceCents: body.proMonthlyPriceCents,
    apiKey: body.apiKey,
    webhookSecret: body.webhookSecret,
    apiBase: body.apiBase,
    oneTimeProductId: body.oneTimeProductId,
    proProductId: body.proProductId,
  };

  // Merge against current to know the final-effective state for validation
  const existing = await getConfigByProviderMode(patch.provider, patch.mode);
  const effective = {
    apiKey: patch.apiKey !== undefined ? patch.apiKey : existing?.apiKey ?? null,
    apiBase: patch.apiBase !== undefined ? patch.apiBase : existing?.apiBase ?? null,
    oneTimePriceCents: patch.oneTimePriceCents ?? existing?.oneTimePriceCents ?? 300,
    proMonthlyPriceCents: patch.proMonthlyPriceCents ?? existing?.proMonthlyPriceCents ?? 900,
    currency: (patch.currency ?? existing?.currency ?? 'usd').toLowerCase(),
    oneTimeProductId: patch.oneTimeProductId !== undefined ? patch.oneTimeProductId : existing?.oneTimeProductId ?? null,
    proProductId: patch.proProductId !== undefined ? patch.proProductId : existing?.proProductId ?? null,
  };

  // Creem write-time validation —— call Creem to confirm price/currency match.
  if (patch.provider === 'creem' && effective.apiKey && effective.apiBase) {
    for (const slot of ['one_time', 'pro'] as const) {
      const productId = slot === 'one_time' ? effective.oneTimeProductId : effective.proProductId;
      const expectedCents = slot === 'one_time' ? effective.oneTimePriceCents : effective.proMonthlyPriceCents;
      if (!productId) continue;
      try {
        const cp = await fetchCreemProduct(productId, { apiKey: effective.apiKey, apiBase: effective.apiBase });
        if (cp.priceCents !== expectedCents) {
          return NextResponse.json({
            error: 'creem_price_mismatch',
            slot,
            field: slot === 'one_time' ? 'oneTimePriceCents' : 'proMonthlyPriceCents',
            dbValue: expectedCents,
            creemValue: cp.priceCents,
            productId,
            hint: `请先在 Creem 后台把 ${productId} 的价格改成 ${(expectedCents/100).toFixed(2)} ${effective.currency.toUpperCase()} 再 retry`,
          }, { status: 409 });
        }
        if (cp.currency.toLowerCase() !== effective.currency) {
          return NextResponse.json({
            error: 'creem_currency_mismatch',
            slot,
            dbValue: effective.currency,
            creemValue: cp.currency,
            productId,
            hint: `Creem 产品 ${productId} 币种是 ${cp.currency}，DB 是 ${effective.currency}。Creem 不可 API 改币种，请在 DB 改 currency 或重建 Creem 产品`,
          }, { status: 409 });
        }
      } catch (err) {
        // Network / 404 → 不 block 写入，附带 warning
        const msg = err instanceof Error ? err.message : 'unknown';
        // eslint-disable-next-line no-console
        console.warn(`[admin/payment-config] Creem validation skipped for ${productId}: ${msg}`);
      }
    }
  }

  try {
    const row = await upsertConfigRow(patch);
    await broadcastActive();
    return NextResponse.json({ ok: true, row });
  } catch (err) {
    if (err instanceof PaymentConfigMismatchError) {
      return NextResponse.json({
        error: 'payment_config_mismatch',
        field: err.field,
        dbValue: err.dbValue,
        creemValue: err.creemValue,
        productId: err.productId,
      }, { status: 409 });
    }
    return NextResponse.json({
      error: 'upsert_failed',
      message: err instanceof Error ? err.message : 'unknown',
    }, { status: 500 });
  }
}

async function broadcastActive(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const active = await getActiveConfig();
    if (!active) return;
    const ch = supa.channel('payment-config-broadcast');
    await ch.subscribe();
    await ch.send({
      type: 'broadcast',
      event: 'updated',
      payload: toPublic(active),
    });
    await supa.removeChannel(ch);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[admin/payment-config] broadcast failed:', err instanceof Error ? err.message : err);
  }
}
