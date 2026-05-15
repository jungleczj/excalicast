import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client bound to the current request's cookies.
 * Use inside Route Handlers / Server Components / Server Actions.
 *
 * IMPORTANT: never call `auth.getSession()` here — it reads the cookie
 * payload as-is which is forgeable. Use `auth.getUser()` (or
 * `auth.getClaims()`) instead so the JWT is re-validated against
 * Supabase Auth.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // In Server Components cookies are immutable — middleware refreshes them instead.
          }
        },
      },
    },
  );
}
