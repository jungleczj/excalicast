import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSubscription } from '@/lib/db';
import type { TierResponse } from '@/types/user';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<TierResponse>> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) {
    return NextResponse.json({
      tier: 'free',
      status: 'inactive',
      currentPeriodEnd: null,
      loggedIn: false,
    });
  }
  const sub = await getUserSubscription(userId);
  if (!sub) {
    return NextResponse.json({
      tier: 'free',
      status: 'inactive',
      currentPeriodEnd: null,
      loggedIn: true,
    });
  }
  // 已 cancelled 但未到期仍享受 Pro，到期后自动降级为 free。
  // past_due（扣款失败宽限期）也保留权益——宽限期结束支付商会推 cancelled，届时再降级。
  const now = Date.now();
  const isStillEntitled =
    sub.status === 'active' ||
    sub.status === 'paused' ||
    sub.status === 'past_due' ||
    (sub.status === 'cancelled' && sub.currentPeriodEnd != null && sub.currentPeriodEnd > now);
  return NextResponse.json({
    tier: isStillEntitled ? sub.tier : 'free',
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    loggedIn: true,
  });
}
