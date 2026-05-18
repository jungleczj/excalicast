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
      className="inline-flex items-center rounded-full border border-border-default bg-bg-secondary p-0.5 text-[11px] font-semibold"
    >
      {locales.map((loc) => {
        const active = loc === locale;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => onChange(loc as Locale)}
            disabled={pending}
            className={`rounded-full px-2.5 py-[3px] transition ${
              active
                ? 'bg-bg-primary text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
          >
            {loc === 'zh' ? t('zh') : t('en')}
          </button>
        );
      })}
    </div>
  );
}
