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
      className="inline-flex items-center"
      style={{
        border: '1.4px solid var(--ink)',
        background: 'var(--paper-2)',
        borderRadius: 999,
        padding: 2,
        gap: 2,
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
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
              background: active ? 'var(--ink)' : 'transparent',
              color: active ? 'var(--paper)' : 'var(--ink-2)',
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
