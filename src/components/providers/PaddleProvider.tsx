'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { initializePaddle, type Paddle, type CheckoutEventNames } from '@paddle/paddle-js';

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

  useEffect(() => {
    const env = process.env.NEXT_PUBLIC_PADDLE_ENV;
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!env || !token) {
      console.warn('[PaddleProvider] missing NEXT_PUBLIC_PADDLE_ENV or NEXT_PUBLIC_PADDLE_CLIENT_TOKEN; Paddle disabled');
      return;
    }
    initializePaddle({
      environment: env as 'sandbox' | 'production',
      token,
      eventCallback: (event) => {
        listenersRef.current.forEach((cb) => cb({ name: event.name as CheckoutEventNames, data: event.data }));
      },
    })
      .then((p) => setPaddle(p ?? null))
      .catch((err) => {
        console.error('[PaddleProvider] initializePaddle failed', err);
      });
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
