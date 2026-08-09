import { NextResponse } from 'next/server';
import { getActiveConfig, listAllConfigs } from '@/lib/paymentConfig';
import { diagnoseCreemCreds } from '@/services/creemServer';
import { diagnosePaddleConfiguration } from '@/services/paddleServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin-only：诊断当前 active 支付配置。
 *
 * Creem 检查凭证与 API mode；Paddle 检查 Price ID、实际币种、计费周期，并用
 * 中国地址 preview 单次 Price 是否返回 wechat_pay。
 *
 * 鉴权：HTTP header `x-admin-secret: ${ADMIN_SECRET}` 必须匹配。
 *
 * 永远不返回完整 apiKey / webhookSecret —— 只暴露 prefix/suffix 供操作者比对。
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

  const active = await getActiveConfig();
  if (!active) {
    return NextResponse.json({
      active: null,
      message: 'no_active_row — call POST /api/admin/payment-config/activate first',
    });
  }

  if (active.provider === 'paddle') {
    if (!active.apiKey) {
      return NextResponse.json({
        active: { provider: active.provider, mode: active.mode },
        error: 'paddle_api_key_missing',
      }, { status: 503 });
    }
    const paddle = await diagnosePaddleConfiguration({
      mode: active.mode,
      apiKey: active.apiKey,
      apiBase: active.apiBase,
      configuredCurrency: active.currency,
      prices: {
        oneTime: active.oneTimeProductId,
        proMonthly: active.proProductId,
        maxMonthly: active.maxProductId,
        proYearly: active.proYearlyProductId,
        maxYearly: active.maxYearlyProductId,
      },
    });
    return NextResponse.json({
      active: { provider: active.provider, mode: active.mode },
      paddle,
      guidance: paddle.wechatPay.available
        ? 'wechat_pay is eligible for the configured one-time Paddle Price in CN desktop checkout'
        : 'wechat_pay is not eligible for this one-time Paddle Price; inspect slot issues, availablePaymentMethods, and requestId',
    });
  }

  const diag = diagnoseCreemCreds({
    apiKey: active.apiKey ?? '',
    apiBase: active.apiBase ?? '',
  });

  // 也列出所有 Creem 行的简化诊断，便于操作者一眼看清
  const all = await listAllConfigs();
  const allCreem = all
    .filter((r) => r.provider === 'creem')
    .map((r) => ({
      mode: r.mode,
      isActive: r.isActive,
      diag: diagnoseCreemCreds({ apiKey: r.apiKey ?? '', apiBase: r.apiBase ?? '' }),
      oneTimeProductId: r.oneTimeProductId,
      proProductId: r.proProductId,
    }));

  return NextResponse.json({
    active: {
      provider: active.provider,
      mode: active.mode,
      apiBase: active.apiBase,
      oneTimeProductId: active.oneTimeProductId,
      proProductId: active.proProductId,
    },
    diag,
    allCreem,
    hint: diag.mismatch
      ? 'apiKey 与 apiBase 模式不匹配 —— 切换 active 行或修改 apiKey/apiBase。'
      : 'apiKey 与 apiBase 模式匹配。若仍报 401，去 Creem dashboard 检查 key 是否被旋转。',
  });
}
