'use client';

import { useEffect, useState } from 'react';
import type { PublicPaymentConfig } from '@/lib/paymentConfig';
import { createClient } from '@/lib/supabase/client';

// Re-export formatPrice so existing call sites continue to import it from this module.
export { formatPrice } from '@/lib/formatPrice';

interface UsePaymentConfig {
  config: PublicPaymentConfig | null;
  loading: boolean;
  error: string | null;
}

/**
 * 读取当前激活的支付配置（provider + mode + 价格）。
 *
 * 初次 mount 拉一次 /api/payment/provider；
 * 同时订阅 Supabase Realtime broadcast channel `payment-config-broadcast`，
 * admin 改完配置后服务端会广播新 payload，所有在线 hook 自动 setConfig，
 * 用户不刷新即看到新价。
 *
 * 可选 `initialConfig` 作为 SSR 预取的初始值，避免首屏 skeleton 闪烁。
 */
export function usePaymentConfig(initialConfig?: PublicPaymentConfig | null): UsePaymentConfig {
  const [config, setConfig] = useState<PublicPaymentConfig | null>(initialConfig ?? null);
  const [loading, setLoading] = useState(!initialConfig);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/payment/provider', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as PublicPaymentConfig;
        if (!cancelled) setConfig(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'fetch_failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Realtime broadcast subscription
  useEffect(() => {
    let supa;
    try { supa = createClient(); }
    catch { return; } // supabase not configured in dev / no NEXT_PUBLIC_SUPABASE_URL
    const ch = supa.channel('payment-config-broadcast')
      .on('broadcast', { event: 'updated' }, (msg) => {
        const payload = msg.payload as PublicPaymentConfig | undefined;
        if (payload && typeof payload === 'object' && 'provider' in payload) {
          setConfig(payload);
          setLoading(false);
        }
      })
      .subscribe();
    return () => { void supa.removeChannel(ch); };
  }, []);

  return { config, loading, error };
}
