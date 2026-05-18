export const locales = ['zh', 'en'] as const;
export const defaultLocale: Locale = 'zh';
export type Locale = (typeof locales)[number];

export const LOCALE_COOKIE = 'NEXT_LOCALE';
