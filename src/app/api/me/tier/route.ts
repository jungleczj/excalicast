import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getUserSubscription } from '@/lib/db';
import type { TierResponse } from '@/types/user';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<TierResponse>> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({
      tier: 'free',
      status: 'inactive',
      currentPeriodEnd: null,
      loggedIn: false,
    });
  }
  const sub = getUserSubscription(userId);
  if (!sub) {
    return NextResponse.json({
      tier: 'free',
      status: 'inactive',
      currentPeriodEnd: null,
      loggedIn: true,
    });
  }
  // 已 cancelled 但未到期仍享受 Pro，到期后自动降级为 free
  const now = Date.now();
  const isStillEntitled =
    sub.status === 'active' ||
    (sub.status === 'cancelled' && sub.currentPeriodEnd != null && sub.currentPeriodEnd > now) ||
    sub.status === 'paused';
  return NextResponse.json({
    tier: isStillEntitled ? sub.tier : 'free',
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    loggedIn: true,
  });
}
