'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setUser(data.user ? toAuthUser(data.user) : null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(session?.user ? toAuthUser(session.user) : null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
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
