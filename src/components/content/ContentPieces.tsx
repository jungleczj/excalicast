import type { JSX } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { TrackedLink } from '@/components/analytics/TrackedLink';
import type {
  ContentFact,
  ContentSource,
  ContentStep,
  CtaPreset,
  FaqItem,
  LocalizedText,
} from '@/content/types';
import { pick } from '@/content/types';

/** Page H1 with the brand marker underline. */
export function PageTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h1 className="content-craft-title" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.025em', margin: 0 }}>
      {children}
    </h1>
  );
}

/** Lead paragraph — also the GEO definition sentence; rendered prominently. */
export function Lead({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p className="content-craft-lead" style={{ marginTop: 20, fontSize: 19, lineHeight: 1.6, color: 'var(--ink-2)' }}>{children}</p>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h2 className="content-craft-section-title" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 44, marginBottom: 12 }}>
      {children}
    </h2>
  );
}

/** A concise answer block that remains useful when lifted out of page context. */
export function DirectAnswer({
  answer,
  locale,
}: {
  answer?: LocalizedText;
  locale: string;
}): JSX.Element | null {
  if (!answer || !pick(answer, locale).trim()) return null;
  return (
    <section
      className="content-craft-direct-answer"
      aria-labelledby="direct-answer-heading"
      style={{ marginTop: 28, borderLeft: '4px solid var(--hi)', padding: '4px 0 4px 18px' }}
    >
      <h2 id="direct-answer-heading" style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
        {locale === 'zh' ? '简短回答' : 'Short answer'}
      </h2>
      <p style={{ marginTop: 8, fontSize: 17, lineHeight: 1.65, color: 'var(--ink-2)' }}>
        {pick(answer, locale)}
      </p>
    </section>
  );
}

export function FitLists({
  bestFor,
  notBestFor,
  locale,
}: {
  bestFor?: LocalizedText[];
  notBestFor?: LocalizedText[];
  locale: string;
}): JSX.Element | null {
  if (!bestFor?.length && !notBestFor?.length) return null;

  const renderList = (title: string, items: LocalizedText[]) => (
    <section>
      <h3 style={{ fontSize: 18, fontWeight: 750, margin: 0 }}>{title}</h3>
      <ul style={{ margin: '10px 0 0', paddingLeft: 20, color: 'var(--ink-2)' }}>
        {items.map((item, index) => (
          <li key={index} style={{ marginTop: 7, fontSize: 16, lineHeight: 1.55 }}>
            {pick(item, locale)}
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div
      className="content-craft-fit-lists"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 28 }}
    >
      {bestFor?.length ? renderList(locale === 'zh' ? '最适合' : 'Best for', bestFor) : null}
      {notBestFor?.length ? renderList(locale === 'zh' ? '不太适合' : 'Not best for', notBestFor) : null}
    </div>
  );
}

export function WorkflowList({
  steps,
  locale,
}: {
  steps: ContentStep[];
  locale: string;
}): JSX.Element {
  return (
    <ol style={{ marginTop: 8, paddingLeft: 0, listStyle: 'none', counterReset: 'step' }}>
      {steps.map((step, index) => (
        <li key={index} className="content-craft-step" style={{ display: 'flex', gap: 16, marginTop: 18 }}>
          <span
            className="content-craft-step-index"
            style={{
              flexShrink: 0,
              width: 34,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              background: 'var(--hi)',
              border: '2px solid var(--ink)',
              borderRadius: 10,
            }}
          >
            {index + 1}
          </span>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{pick(step.title, locale)}</h3>
            <p style={{ marginTop: 6, fontSize: 16, lineHeight: 1.6, color: 'var(--ink-2)' }}>
              {pick(step.body, locale)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function FactList({
  facts,
  locale,
}: {
  facts?: ContentFact[];
  locale: string;
}): JSX.Element | null {
  if (!facts?.length) return null;
  return (
    <dl style={{ margin: 0, borderTop: '2px solid var(--ink)' }}>
      {facts.map((fact, index) => (
        <div
          key={index}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(140px, 0.8fr) minmax(220px, 2fr)',
            gap: 18,
            padding: '14px 0',
            borderBottom: '1px solid var(--paper-3)',
          }}
        >
          <dt style={{ fontSize: 15, fontWeight: 750 }}>{pick(fact.label, locale)}</dt>
          <dd style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--ink-2)' }}>
            {pick(fact.value, locale)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function LimitationsList({
  limitations,
  locale,
}: {
  limitations?: LocalizedText[];
  locale: string;
}): JSX.Element | null {
  if (!limitations?.length) return null;
  return (
    <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--ink-2)' }}>
      {limitations.map((item, index) => (
        <li key={index} style={{ marginTop: 8, fontSize: 16, lineHeight: 1.6 }}>
          {pick(item, locale)}
        </li>
      ))}
    </ul>
  );
}

export function SourceList({
  sources,
  verifiedAt,
  locale,
}: {
  sources?: ContentSource[];
  verifiedAt?: string;
  locale: string;
}): JSX.Element | null {
  if (!sources?.length) return null;
  return (
    <div>
      {verifiedAt ? (
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-2)' }}>
          {locale === 'zh' ? `公开资料核验日期：${verifiedAt}` : `Public sources verified: ${verifiedAt}`}
        </p>
      ) : null}
      <ul style={{ margin: '10px 0 0', paddingLeft: 20 }}>
        {sources.map((source, index) => (
          <li key={index} style={{ marginTop: 7, fontSize: 15, lineHeight: 1.55 }}>
            <a href={source.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>
              {pick(source.label, locale)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** FAQ list, rendered as visible <h3>/<p> (the JSON-LD is emitted separately). */
export function FaqList({ faqs, locale }: { faqs: FaqItem[]; locale: string }): JSX.Element {
  return (
    <div className="content-craft-faq-list" style={{ marginTop: 16 }}>
      {faqs.map((f, i) => (
        <div key={i} className="content-craft-faq-item" style={{ marginTop: 20 }}>
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
  preset,
}: {
  locale: string;
  type: 'pillar' | 'compare' | 'use-case' | 'blog';
  slug: string;
  preset?: CtaPreset;
}): Promise<JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'landing' });
  return (
    <div
      className="content-craft-cta-row mt-12 flex flex-wrap items-center gap-3"
      style={{ borderTop: '2px solid var(--ink)', paddingTop: 28 }}
    >
      <TrackedLink
        event="content_cta_click"
        eventProps={{ content_type: type, slug, surface: 'content_bottom' }}
        secondaryEvent={type === 'compare' ? 'comparison_cta_click' : undefined}
        href={preset?.href ?? '/app'}
        prefetchKind="whiteboard"
        className="btn-sketch btn-sketch-primary"
      >
        <span className="recording-indicator h-1.5 w-1.5 rounded-full" style={{ background: 'var(--rec)' }} />
        {preset ? pick(preset.label, locale) : t('hero.ctaPrimary')}
      </TrackedLink>
      <Link href="/" className="btn-sketch">{t('hero.ctaSecondary')}</Link>
    </div>
  );
}

/** A simple comparison table styled with the shared Craft hairline system. */
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
    <div className="content-craft-table" style={{ marginTop: 16, overflowX: 'auto', border: '2px solid var(--ink)', borderRadius: 12 }}>
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

/**
 * Cross-links between the three content hubs (compare / use-cases / blog).
 * Rendered at the bottom of each hub index page so crawlers can traverse the
 * full hub-and-spoke graph from any hub.
 */
export async function HubLinks({
  locale,
  current,
}: {
  locale: string;
  current: 'compare' | 'use-case' | 'blog';
}): Promise<JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'landing' });
  const hubs = [
    { type: 'use-case' as const, href: '/use-cases', label: t('footer.useCases') },
    { type: 'compare' as const, href: '/compare', label: t('footer.compare') },
    { type: 'blog' as const, href: '/blog', label: t('footer.blog') },
  ].filter((h) => h.type !== current);
  return (
    <nav className="content-craft-hub-links" aria-label="Related sections" style={{ marginTop: 44, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {hubs.map((h) => (
        <Link key={h.href} href={h.href} className="btn-sketch">{h.label}</Link>
      ))}
    </nav>
  );
}
