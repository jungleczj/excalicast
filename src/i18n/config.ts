export const locales = ['zh', 'en'] as const;
/** English is the primary acquisition market; locale detection may still select Chinese. */
export const defaultLocale: Locale = 'en';
export type Locale = (typeof locales)[number];

export const LOCALE_COOKIE = 'NEXT_LOCALE';
