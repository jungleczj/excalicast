import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n/config';
import { absoluteUrl } from '@/lib/seo/alternates';
import { pageMetadata } from '@/lib/seo/meta';
import { JsonLd } from '@/components/seo/JsonLd';
import { faqPageSchema, breadcrumbSchema } from '@/lib/seo/schema';
import { ContentShell } from '@/components/content/ContentShell';
import { PageTitle, Lead, SectionHeading, FaqList, CtaRow } from '@/components/content/ContentPieces';
import { RelatedLinks } from '@/components/content/RelatedLinks';
import { USE_CASE_ENTRIES, getUseCaseEntry, pick } from '@/content';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export function generateStaticParams() {
  return USE_CASE_ENTRIES.flatMap((e) => locales.map((locale) => ({ locale, slug: e.slug })));
}

export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params;
  const entry = getUseCaseEntry(slug);
  if (!entry) return {};
  return pageMetadata({
    title: pick(entry.title, locale),
    description: pick(entry.description, locale),
    path: `/use-cases/${slug}`,
    locale,
  });
}

export default async function UseCasePage({ params }: Props): Promise<JSX.Element> {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const entry = getUseCaseEntry(slug);
  if (!entry) notFound();

  const faqSchema = faqPageSchema(
    entry.faqs.map((f) => ({ question: pick(f.q, locale), answer: pick(f.a, locale) })),
  );
  const crumb = breadcrumbSchema([
    { name: 'Excalicast', url: absoluteUrl(locale, '/') },
    { name: locale === 'zh' ? '使用场景' : 'Use cases', url: absoluteUrl(locale, '/use-cases') },
    { name: pick(entry.title, locale), url: absoluteUrl(locale, `/use-cases/${slug}`) },
  ]);

  return (
    <ContentShell locale={locale}>
      <JsonLd data={[faqSchema, crumb]} />
      <PageTitle>{pick(entry.title, locale)}</PageTitle>
      <Lead>{pick(entry.intro, locale)}</Lead>

      <SectionHeading>{locale === 'zh' ? '步骤' : 'Steps'}</SectionHeading>
      <ol style={{ marginTop: 8, paddingLeft: 0, listStyle: 'none', counterReset: 'step' }}>
        {entry.steps.map((s, i) => (
          <li key={i} className="content-craft-step" style={{ display: 'flex', gap: 16, marginTop: 18 }}>
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
              {i + 1}
            </span>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{pick(s.title, locale)}</h3>
              <p style={{ marginTop: 6, fontSize: 16, lineHeight: 1.6, color: 'var(--ink-2)' }}>
                {pick(s.body, locale)}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <SectionHeading>{locale === 'zh' ? '常见问题' : 'FAQ'}</SectionHeading>
      <FaqList faqs={entry.faqs} locale={locale} />

      <RelatedLinks refs={entry.related} locale={locale} />

      <CtaRow locale={locale} type="use-case" slug={slug} />
    </ContentShell>
  );
}
