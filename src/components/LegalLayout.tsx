import type { CSSProperties, ReactNode, JSX } from 'react';
import { Link } from '@/i18n/navigation';
import { getTranslations } from 'next-intl/server';
import { I, LogoMark } from '@/components/icons';
import { MonoTag, FooterBar } from '@/components/ui';
import { TrackedLink } from '@/components/analytics/TrackedLink';

interface Props {
  title: string;
  /** Last updated date, ISO `YYYY-MM-DD`. */
  lastUpdated: string;
  /** Short kind label for the hi tag (defaults to title). */
  kind?: string;
  /** Optional one-line summary under the title. */
  summary?: string;
  children: ReactNode;
}

const navLink: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--ink)',
  opacity: 0.6,
  textDecoration: 'none',
  paddingBottom: 4,
};

/**
 * Shared shell for Privacy / Terms / Refund, ported to the ExcalidrawRec
 * sketch design (LegalShell): sketch header + doc header (breadcrumb · kind tag
 * · big title · last-updated) + .legal-prose body + design FooterBar.
 */
export async function LegalLayout({ title, lastUpdated, kind, summary, children }: Props): Promise<JSX.Element> {
  const t = await getTranslations('legal');
  return (
    <div className="app-craft-screen legal-craft-page flex h-full flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {/* Header */}
      <header className="legal-craft-header flex h-16 flex-shrink-0 items-center justify-between px-4 sm:px-10" style={{ background: 'var(--paper)', borderBottom: '2px solid var(--ink)' }}>
        <Link href="/" className="flex items-center gap-2.5" style={{ textDecoration: 'none', color: 'var(--ink)' }}>
          <LogoMark size={30} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>Excalicast</span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          <Link href="/" className="nav-link" style={navLink}>{t('nav.home')}</Link>
          <Link href="/pricing" className="nav-link" style={navLink}>{t('nav.pricing')}</Link>
        </nav>
        <TrackedLink event="cta_start_recording" eventProps={{ surface: 'nav' }} prefetchKind="whiteboard" href="/app" className="btn-sketch btn-sketch-primary btn-stamp" style={{ padding: '9px 16px' }}>
          <span className="rec-dot" style={{ width: 6, height: 6 }} />
          {t('nav.startRecording')}
        </TrackedLink>
      </header>

      <main className="flex-1 overflow-auto">
        {/* Doc header */}
        <section className="legal-craft-hero px-6 py-10 sm:px-10 lg:px-20" style={{ borderBottom: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
          <nav aria-label="Breadcrumb" className="mb-3.5 flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            <Link href="/" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>{t('nav.home')}</Link>
            <span aria-hidden>›</span>
            <span>{t('breadcrumbLegal')}</span>
            <span aria-hidden>›</span>
            <span style={{ color: 'var(--ink)' }}>{title}</span>
          </nav>
          <MonoTag variant="hi">{kind ?? title}</MonoTag>
          <h1 style={{ fontSize: 'clamp(30px, 6vw, 48px)', fontWeight: 700, letterSpacing: '-0.03em', margin: '12px 0 14px', lineHeight: 1.05 }}>{title}</h1>
          {summary && <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0, maxWidth: 720 }}>{summary}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            <span className="inline-flex items-center gap-1.5"><I.Edit size={13} /> {t('lastUpdated', { date: lastUpdated })}</span>
            <span aria-hidden>·</span>
            <span>{t('entity')}</span>
          </div>
        </section>

        {/* Prose */}
        <article className="legal-craft-article mx-auto px-6 py-12 sm:px-10" style={{ maxWidth: 820 }}>
          <div className="legal-prose">{children}</div>

          <div className="legal-craft-contact mt-12 text-center" style={{ border: '1.5px solid var(--ink)', background: 'var(--paper)', borderRadius: 4, boxShadow: '3px 3px 0 var(--ink)', padding: 20 }}>
            <p style={{ color: 'var(--ink-2)', fontSize: 13, margin: 0 }}>{t('questionsCta')}</p>
            <a href="mailto:support@excalicast.cn" className="mt-1 inline-block" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--ink)', borderBottom: '1.5px solid var(--hi)', textDecoration: 'none' }}>
              support@excalicast.cn
            </a>
          </div>
        </article>

        <FooterBar />
      </main>
    </div>
  );
}
