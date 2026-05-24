/**
 * 服务端 tier 守卫，给 /api/share/* 和 /api/handout/* 等 Max 路由共用。
 *
 * 使用方式（路由顶部）：
 *
 *   const guard = await requireTier(req, 'max');
 *   if ('error' in guard) return guard.error;
 *   const { userId, tier } = guard;
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSubscription } from '@/lib/db';
import type { SubscriptionTier } from '@/types/user';

const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1,
  max: 2,
};

export interface TierGuardOk {
  userId: string;
  tier: SubscriptionTier;
}

export interface TierGuardErr {
  error: NextResponse;
}

/**
 * 当前用户必须达到 `minimumTier`。否则返回带预制响应的对象（直接 `return guard.error`）。
 * 已取消但未到期仍享受 Pro/Max；到期后自动降级。
 */
export async function requireTier(
  _req: Request,
  minimumTier: SubscriptionTier,
): Promise<TierGuardOk | TierGuardErr> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) {
    return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  const sub = await getUserSubscription(userId);
  const baseTier: SubscriptionTier = sub?.tier ?? 'free';
  const status = sub?.status ?? 'inactive';
  const stillEntitled =
    status === 'active' ||
    status === 'paused' ||
    (status === 'cancelled' && sub?.currentPeriodEnd != null && sub.currentPeriodEnd > Date.now());
  const tier: SubscriptionTier = stillEntitled ? baseTier : 'free';

  if (TIER_RANK[tier] < TIER_RANK[minimumTier]) {
    return {
      error: NextResponse.json(
        { error: 'tier_required', requiredTier: minimumTier, currentTier: tier },
        { status: 403 },
      ),
    };
  }
  return { userId, tier };
}
