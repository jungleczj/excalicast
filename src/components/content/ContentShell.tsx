import type { ReactNode, JSX } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LogoMark } from '@/components/icons';

/**
 * Shared chrome for programmatic content pages (compare / use-cases / blog).
 * Mirrors the landing page's paper/ink look and its h-full + overflow-auto
 * scroll model (body is h-screen). Server Component — links only.
 */
export async function ContentShell({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}): Promise<JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'landing' });
  return (
    <div className="app-craft-screen content-craft-page flex h-full flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <header
        className="content-craft-header flex h-16 flex-shrink-0 items-center justify-between px-6 sm:px-10"
        style={{ background: 'var(--paper)', borderBottom: '2px solid var(--ink)' }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark size={28} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.02em' }}>
            Excalicast
          </span>
        </Link>
        <Link href="/app" className="btn-sketch btn-sketch-primary" style={{ padding: '9px 16px' }}>
          <span className="recording-indicator h-1.5 w-1.5 rounded-full" style={{ background: 'var(--rec)' }} />
          {t('hero.ctaPrimary')}
        </Link>
      </header>

      <main className="content-craft-main flex-1 overflow-auto">
        <article
          className="content-craft-article mx-auto px-6 py-12 sm:px-8 sm:py-16"
          style={{ maxWidth: 860, lineHeight: 1.6 }}
        >
          {children}
        </article>

        <footer
          className="content-craft-footer px-6 py-10 sm:px-8"
          style={{ borderTop: '2px solid var(--ink)', fontSize: 13, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}
        >
          <div className="mx-auto flex flex-wrap items-center gap-x-6 gap-y-2" style={{ maxWidth: 860 }}>
            <Link href="/" style={{ color: 'var(--ink-3)' }}>{t('footer.home')}</Link>
            <Link href="/app" style={{ color: 'var(--ink-3)' }}>{t('hero.ctaPrimary')}</Link>
            <Link href="/terms" style={{ color: 'var(--ink-3)' }}>{t('footer.terms')}</Link>
            <Link href="/privacy" style={{ color: 'var(--ink-3)' }}>{t('footer.privacy')}</Link>
            <span style={{ marginLeft: 'auto' }}>© Excalicast</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
