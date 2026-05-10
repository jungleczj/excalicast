'use client';

import { useCallback, useEffect, useState } from 'react';
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
