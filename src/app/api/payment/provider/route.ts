import { NextResponse } from 'next/server';
import { getPaymentConfig, toPublic, type PublicPaymentConfig } from '@/lib/paymentConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/**
 * 公开只读：返回当前支付提供商 + 价格。
 *
 * 仅暴露 provider/currency/价格三项，不暴露 paddle/creem 的产品 ID
 * （那些只在服务端构造 checkout 时使用）。
 *
 * 客户端用它决定弹哪个 modal / 调哪条 checkout 路由。
 */
export async function GET(): Promise<NextResponse<PublicPaymentConfig>> {
  const cfg = await getPaymentConfig();
  return NextResponse.json(toPublic(cfg));
}
