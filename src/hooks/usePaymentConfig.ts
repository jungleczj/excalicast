'use client';

import { useEffect, useState } from 'react';
import type { PublicPaymentConfig } from '@/lib/paymentConfig';

interface UsePaymentConfig {
  config: PublicPaymentConfig | null;
  loading: boolean;
  error: string | null;
}

/**
 * 读取当前生效的支付配置（provider + 价格）。
 * 仅在 modal 挂载时拉一次；admin 改完配置后用户需要刷新页面才能看到新值。
 */
export function usePaymentConfig(): UsePaymentConfig {
  const [config, setConfig] = useState<PublicPaymentConfig | null>(null);
  const [loading, setLoading] = useState(true);
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
    return () => {
      cancelled = true;
    };
  }, []);

  return { config, loading, error };
}

export function formatPrice(cents: number, currency: string): string {
  const symbol = (() => {
    switch (currency.toLowerCase()) {
      case 'usd': return '$';
      case 'eur': return '€';
      case 'gbp': return '£';
      case 'cny': return '¥';
      case 'jpy': return '¥';
      default: return '';
    }
  })();
  const integral = Math.floor(cents / 100);
  const frac = cents % 100;
  if (currency.toLowerCase() === 'jpy') return `${symbol}${integral}`;
  if (frac === 0) return `${symbol}${integral}`;
  return `${symbol}${integral}.${frac.toString().padStart(2, '0')}`;
}
