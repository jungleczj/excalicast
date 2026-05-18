import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defaultLocale, LOCALE_COOKIE, locales } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveLocale(req: NextRequest): string {
  const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && (locales as readonly string[]).includes(cookieLocale)) return cookieLocale;
  return defaultLocale;
}

/**
 * Magic-link landing page. Supabase's email template ends with
 * `?code=<oauth_pkce_code>&next=<path>`. We exchange the code for a
 * session (sets the encrypted cookie via the SSR helper) and then
 * redirect to `next`.
 *
 * The `next` query param is validated to be same-origin to prevent
 * open-redirect.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const locale = resolveLocale(request);
  const fallback = `/${locale}/app`;
  const rawNext = url.searchParams.get('next') ?? fallback;
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : fallback;

  if (!code) {
    return NextResponse.redirect(new URL(`${next}?login_error=missing_code`, request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`${next}?login_error=${encodeURIComponent(error.message)}`, request.url),
    );
  }

  return NextResponse.redirect(new URL(next, request.url));
}
