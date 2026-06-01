import { locales } from '@/i18n/config';

/** Canonical production origin. Used for metadataBase, canonical & hreflang. */
export const SITE_URL = 'https://excalicast.cc';

/** Map an app locale to its BCP-47 hreflang code. */
function hreflang(locale: string): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

/**
 * Build `alternates` (canonical + hreflang languages) for a page.
 *
 * @param pathWithoutLocale path WITHOUT the locale prefix, e.g. '/' or
 *   '/compare/excalicast-vs-loom'. Leading slash required.
 * @param currentLocale the locale being rendered.
 *
 * Routing uses next-intl `localePrefix: 'always'`, so every URL carries a
 * `/zh` or `/en` prefix. x-default points at English (overseas-first).
 */
export function buildAlternates(pathWithoutLocale: string, currentLocale: string) {
  const clean = pathWithoutLocale === '/' ? '' : pathWithoutLocale;
  const languages: Record<string, string> = {};
  for (const loc of locales) {
    languages[hreflang(loc)] = `${SITE_URL}/${loc}${clean}`;
  }
  languages['x-default'] = `${SITE_URL}/en${clean}`;
  return {
    canonical: `${SITE_URL}/${currentLocale}${clean}`,
    languages,
  };
}

/** Absolute URL for a locale-prefixed path. */
export function absoluteUrl(locale: string, pathWithoutLocale: string): string {
  const clean = pathWithoutLocale === '/' ? '' : pathWithoutLocale;
  return `${SITE_URL}/${locale}${clean}`;
}
