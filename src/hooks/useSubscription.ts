'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { TIER_PERMISSIONS, type TierPermissions, type TierResponse } from '@/types/user';

interface UseSubscription {
  tier: TierResponse['tier'];
  status: TierResponse['status'];
  currentPeriodEnd: number | null;
  loggedIn: boolean;
  loading: boolean;
  permissions: TierPermissions;
  refresh: () => Promise<void>;
}

export function useSubscription(): UseSubscription {
  const [data, setData] = useState<TierResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/me/tier', { cache: 'no-store' });
      if (!res.ok) throw new Error(`tier fetch failed: ${res.status}`);
      const json = (await res.json()) as TierResponse;
      setData(json);
    } catch {
      setData({ tier: 'free', status: 'inactive', currentPeriodEnd: null, loggedIn: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 登录/登出/令牌刷新 → 重查档位（修：经 Header LoginModal 登录后档位仍停在登录前的 free）。
  useEffect(() => {
    let sub: { unsubscribe: () => void } | undefined;
    try {
      const supabase = createClient();
      const { data: listener } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          void refresh();
        }
      });
      sub = listener.subscription;
    } catch { /* 未配 NEXT_PUBLIC_SUPABASE_* 时忽略 */ }
    return () => { try { sub?.unsubscribe(); } catch { /* */ } };
  }, [refresh]);

  const tier = data?.tier ?? 'free';
  return {
    tier,
    status: data?.status ?? 'inactive',
    currentPeriodEnd: data?.currentPeriodEnd ?? null,
    loggedIn: data?.loggedIn ?? false,
    loading,
    permissions: TIER_PERMISSIONS[tier],
    refresh,
  };
}
