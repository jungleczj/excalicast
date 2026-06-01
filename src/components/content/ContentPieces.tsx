import type { JSX } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { TrackedLink } from '@/components/analytics/TrackedLink';
import type { FaqItem, LocalizedText } from '@/content/types';
import { pick } from '@/content/types';

/** Page H1 with the brand marker underline. */
export function PageTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h1 style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.025em', margin: 0 }}>
      {children}
    </h1>
  );
}

/** Lead paragraph — also the GEO definition sentence; rendered prominently. */
export function Lead({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p style={{ marginTop: 20, fontSize: 19, lineHeight: 1.6, color: 'var(--ink-2)' }}>{children}</p>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 44, marginBottom: 12 }}>
      {children}
    </h2>
  );
}

/** FAQ list, rendered as visible <h3>/<p> (the JSON-LD is emitted separately). */
export function FaqList({ faqs, locale }: { faqs: FaqItem[]; locale: string }): JSX.Element {
  return (
    <div style={{ marginTop: 16 }}>
      {faqs.map((f, i) => (
        <div key={i} style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{pick(f.q, locale)}</h3>
          <p style={{ marginTop: 8, fontSize: 16, lineHeight: 1.6, color: 'var(--ink-2)' }}>
            {pick(f.a, locale)}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Closing call-to-action row reusing the landing button styles. The primary
 * CTA fires `content_cta_click` (tagged with the page type + slug) so we can
 * see which content pages actually convert to /app.
 */
export async function CtaRow({
  locale,
  type,
  slug,
}: {
  locale: string;
  type: 'compare' | 'use-case' | 'blog';
  slug: string;
}): Promise<JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'landing' });
  return (
    <div
      className="mt-12 flex flex-wrap items-center gap-3"
      style={{ borderTop: '2px solid var(--ink)', paddingTop: 28 }}
    >
      <TrackedLink
        event="content_cta_click"
        eventProps={{ type, slug }}
        href="/app"
        className="btn-sketch btn-sketch-primary"
      >
        <span className="recording-indicator h-1.5 w-1.5 rounded-full" style={{ background: 'var(--rec)' }} />
        {t('hero.ctaPrimary')}
      </TrackedLink>
      <Link href="/" className="btn-sketch">{t('hero.ctaSecondary')}</Link>
    </div>
  );
}

/** A simple comparison table styled with the brand's hard borders. */
export function CompareTable({
  rows,
  competitor,
  locale,
}: {
  rows: { feature: LocalizedText; excalicast: LocalizedText; competitor: LocalizedText }[];
  competitor: string;
  locale: string;
}): JSX.Element {
  const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '12px 14px',
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '2px solid var(--ink)',
  };
  const td: React.CSSProperties = {
    padding: '12px 14px',
    fontSize: 15,
    verticalAlign: 'top',
    borderBottom: '1px solid var(--paper-3)',
  };
  return (
    <div style={{ marginTop: 16, overflowX: 'auto', border: '2px solid var(--ink)', borderRadius: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}></th>
            <th style={{ ...th, background: 'var(--hi-soft)' }}>Excalicast</th>
            <th style={th}>{competitor}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ ...td, fontWeight: 600 }}>{pick(r.feature, locale)}</td>
              <td style={{ ...td, background: 'var(--hi-soft)' }}>{pick(r.excalicast, locale)}</td>
              <td style={td}>{pick(r.competitor, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
