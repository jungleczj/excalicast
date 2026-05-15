import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refresh Supabase auth cookies for every request.
 *
 * Pattern is the official one from @supabase/ssr docs: take the incoming
 * request cookies, hand them to createServerClient, then write any
 * refreshed cookies back onto the outgoing response.
 *
 * MUST call supabase.auth.getUser() (not getSession()) — that's what
 * triggers the token refresh under the hood.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touch the user so cookies refresh if needed — return value unused.
  await supabase.auth.getUser();

  return supabaseResponse;
}
