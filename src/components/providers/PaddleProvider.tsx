'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { initializePaddle, type Paddle, type CheckoutEventNames } from '@paddle/paddle-js';
import type { PublicPaymentConfig } from '@/lib/paymentConfig';
import { recordingLifecycle } from '@/services/recordingLifecycleSingleton';

type PaddleEvent = { name: CheckoutEventNames; data?: unknown };

interface PaddleContextValue {
  paddle: Paddle | null;
  subscribe: (cb: (event: PaddleEvent) => void) => () => void;
}

const PaddleContext = createContext<PaddleContextValue>({
  paddle: null,
  subscribe: () => () => {},
});

export function PaddleProvider({ children }: { children: ReactNode }): JSX.Element {
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const listenersRef = useRef<Set<(e: PaddleEvent) => void>>(new Set());
  const configSignatureRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    const locale = getPaddleLocale();
    const refreshProvider = async () => {
      if (recordingLifecycle.activeSession()) return;
      const res = await fetch('/api/payment/provider', { cache: 'no-store' });
      if (!res.ok) throw new Error(`payment provider ${res.status}`);
      const cfg = (await res.json()) as PublicPaymentConfig;
      const signature = `${cfg.provider}:${cfg.mode}:${cfg.paddleClientToken ?? ''}`;
      if (signature === configSignatureRef.current) return;
      configSignatureRef.current = signature;
      if (cfg.provider !== 'paddle' || !cfg.paddleClientToken) {
        setPaddle(null);
        return;
      }
      await initializePaddle({
        environment: cfg.mode === 'test' ? 'sandbox' : 'production',
        token: cfg.paddleClientToken,
        checkout: {
          settings: {
            displayMode: 'overlay',
            theme: 'light',
            locale,
          },
        },
        eventCallback: (event) => {
          listenersRef.current.forEach((cb) => cb({ name: event.name as CheckoutEventNames, data: event.data }));
        },
      }).then((instance) => {
        if (!cancelled) setPaddle(instance ?? null);
      });
    };
    const refreshSafely = () => {
      void refreshProvider().catch((err) => {
        console.warn('[PaddleProvider] Paddle disabled:', err instanceof Error ? err.message : err);
        configSignatureRef.current = '';
        setPaddle(null);
      });
    };
    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') refreshSafely();
    };
    refreshSafely();
    const interval = window.setInterval(refreshSafely, 30_000);
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
  }, []);

  const subscribe = (cb: (e: PaddleEvent) => void) => {
    listenersRef.current.add(cb);
    return () => { listenersRef.current.delete(cb); };
  };

  return (
    <PaddleContext.Provider value={{ paddle, subscribe }}>
      {children}
    </PaddleContext.Provider>
  );
}

export function usePaddle(): PaddleContextValue {
  return useContext(PaddleContext);
}

function getPaddleLocale(): 'zh' | 'en' {
  if (typeof document === 'undefined') return 'en';
  const cookie = document.cookie.split('; ').find((c) => c.startsWith('NEXT_LOCALE='));
  const value = cookie?.split('=')[1];
  return value === 'zh' ? 'zh' : 'en';
}
