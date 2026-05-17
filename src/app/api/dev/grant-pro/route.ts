import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { upsertSubscription } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dev-only：把当前登录用户直接升到 Pro，绕过 Paddle。
 *
 * 用于 Paddle 沙盒未配置 / 离线开发 / E2E 测试场景。
 * 上线时 DEV_MODE 必须为 false，否则任何登录用户都能白嫖 Pro。
 */
export async function POST(): Promise<NextResponse> {
  if (process.env.DEV_MODE !== 'true') {
    return NextResponse.json({ error: 'dev_mode_disabled' }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const periodEnd = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await upsertSubscription({
    userId: user.id,
    tier: 'pro',
    status: 'active',
    paddleSubscriptionId: `dev_grant_${user.id.slice(0, 8)}`,
    paddleCustomerId: `dev_cus_${user.id.slice(0, 8)}`,
    currentPeriodEnd: periodEnd,
    rawPayload: JSON.stringify({ devGranted: true, at: Date.now() }),
  });

  return NextResponse.json({
    ok: true,
    userId: user.id,
    tier: 'pro',
    status: 'active',
    currentPeriodEnd: periodEnd,
  });
}
