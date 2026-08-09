'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const AUTH_INITIALIZATION_TIMEOUT_MS = 3_000;

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export interface AuthUser {
  id: string; // Supabase auth.users.id (UUID)
  email: string;
  name?: string | null;
  image?: string | null;
}

export interface UseAuth {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

/**
 * Supabase-Auth backed replacement for the prior NextAuth useAuth().
 * Public shape is unchanged so existing callers don't break.
 */
export function useAuth(): UseAuth {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let verificationRequest = 0;
    const verificationTimers = new Set<ReturnType<typeof setTimeout>>();

    const verifyCurrentUser = async (): Promise<void> => {
      const requestId = ++verificationRequest;
      const result = await settleWithin(
        supabase.auth.getUser(),
        AUTH_INITIALIZATION_TIMEOUT_MS,
      );
      if (cancelled || requestId !== verificationRequest) return;
      const verifiedUser = result && !result.error ? result.data.user : null;
      setUser(verifiedUser ? toAuthUser(verifiedUser) : null);
      setLoading(false);
    };

    void verifyCurrentUser();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'INITIAL_SESSION') return;
      verificationRequest += 1;
      setUser(null);
      if (event === 'SIGNED_OUT') {
        setLoading(false);
        return;
      }
      setLoading(true);
      const timer = setTimeout(() => {
        verificationTimers.delete(timer);
        if (!cancelled) void verifyCurrentUser();
      }, 0);
      verificationTimers.add(timer);
    });

    return () => {
      cancelled = true;
      verificationRequest += 1;
      for (const timer of verificationTimers) clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const logout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  return { user, loading, logout };
}

function toAuthUser(u: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): AuthUser {
  const m = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? '',
    name: (m.full_name as string | undefined) ?? (m.name as string | undefined) ?? null,
    image: (m.avatar_url as string | undefined) ?? (m.picture as string | undefined) ?? null,
  };
}
