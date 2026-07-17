'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { locales, type Locale } from '@/i18n/config';

export function LanguageToggle(): JSX.Element {
  const t = useTranslations('header.languageToggle');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const onChange = (next: Locale) => {
    if (next === locale || pending) return;
    startTransition(() => {
      router.replace(pathname as never, { locale: next });
    });
  };

  return (
    <div
      role="group"
      aria-label={t('label')}
      className="app-craft-language-toggle inline-flex items-center"
      style={{
        border: '1px solid var(--craft-line)',
        background: 'rgba(255,253,248,0.74)',
        borderRadius: 999,
        padding: 2,
        gap: 2,
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        textTransform: 'none',
        boxShadow: '0 8px 18px rgba(48,38,26,0.045), inset 0 1px 0 rgba(255,255,255,0.72)',
      }}
    >
      {locales.map((loc) => {
        const active = loc === locale;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => onChange(loc as Locale)}
            disabled={pending}
            className="transition"
            style={{
              padding: '4px 10px',
              background: active ? '#050505' : 'transparent',
              color: active ? '#fffdf8' : 'rgba(24,25,26,0.58)',
              border: 'none',
              borderRadius: 999,
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {loc === 'zh' ? t('zh') : t('en')}
          </button>
        );
      })}
    </div>
  );
}
