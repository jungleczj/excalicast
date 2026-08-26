import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale, LOCALE_COOKIE } from '@/i18n/config';

export default createMiddleware({
  locales,
  defaultLocale,
  localeDetection: true,
  localePrefix: 'always',
  // HTML metadata + sitemap are the single hreflang source of truth.
  // next-intl's response Link header uses different language codes and an
  // unlocalized x-default, which conflicts with those canonical alternates.
  alternateLinks: false,
  localeCookie: { name: LOCALE_COOKIE, maxAge: 60 * 60 * 24 * 365 },
});

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
