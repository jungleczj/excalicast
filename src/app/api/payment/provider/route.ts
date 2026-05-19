import { NextResponse } from 'next/server';
import { getActiveConfig, toPublic, type PublicPaymentConfig } from '@/lib/paymentConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/**
 * 公开只读：返回当前激活的支付提供商 + 价格 + mode。
 *
 * 严格白名单：仅 provider / mode / currency / 价格。
 * api_key / webhook_secret / product_id 永远不暴露。
 */
export async function GET(): Promise<NextResponse<PublicPaymentConfig | { error: string }>> {
  const cfg = await getActiveConfig();
  if (!cfg) {
    return NextResponse.json({ error: 'no_active_payment_config' }, { status: 503 });
  }
  return NextResponse.json(toPublic(cfg));
}
