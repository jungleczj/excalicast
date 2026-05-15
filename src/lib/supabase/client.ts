'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client.
 * Uses the publishable / anon key (NEXT_PUBLIC_*). Safe to ship to the client.
 * Cookies are stored/read via document.cookie; the matching server-side reader
 * lives in `./server.ts` and middleware refreshes them.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
