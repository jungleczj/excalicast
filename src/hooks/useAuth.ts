'use client';

import { useSession, signOut } from 'next-auth/react';
import { useCallback } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

export interface UseAuth {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuth {
  const { data, status } = useSession();
  const user: AuthUser | null = data?.user
    ? {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: ((data.user as any).id as string) ?? data.user.email ?? 'unknown',
        email: data.user.email ?? '',
        name: data.user.name,
        image: data.user.image,
      }
    : null;

  const logout = useCallback(async () => {
    await signOut({ redirect: false });
  }, []);

  return {
    user,
    loading: status === 'loading',
    logout,
  };
}
