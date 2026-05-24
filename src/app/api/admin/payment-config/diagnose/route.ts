import { NextResponse } from 'next/server';
import { getActiveConfig, listAllConfigs } from '@/lib/paymentConfig';
import { diagnoseCreemCreds } from '@/services/creemServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin-only：诊断当前 active 行的 Creem 凭证配对情况。
 *
 * 用途：当客户端报 "Creem 鉴权失败 (401): Invalid API Key" 时，操作者用这个
 * 接口快速判断是 apiKey 与 apiBase 的 mode 错配，还是 key 已在 Creem 后台旋转。
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

  if (active.provider !== 'creem') {
    return NextResponse.json({
      active: { provider: active.provider, mode: active.mode },
      message: 'active row is not Creem; diagnose only meaningful for Creem rows',
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
