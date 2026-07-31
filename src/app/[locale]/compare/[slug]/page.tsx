import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n/config';
import { absoluteUrl } from '@/lib/seo/alternates';
import { pageMetadata } from '@/lib/seo/meta';
import { JsonLd } from '@/components/seo/JsonLd';
import { faqPageSchema, breadcrumbSchema } from '@/lib/seo/schema';
import { ContentShell } from '@/components/content/ContentShell';
import {
  CompareTable,
  CtaRow,
  DirectAnswer,
  FactList,
  FaqList,
  FitLists,
  Lead,
  LimitationsList,
  PageTitle,
  SectionHeading,
  SourceList,
  WorkflowList,
} from '@/components/content/ContentPieces';
import { RelatedLinks } from '@/components/content/RelatedLinks';
import { COMPARE_ENTRIES, getCompareEntry, pick } from '@/content';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export function generateStaticParams() {
  return COMPARE_ENTRIES.flatMap((e) => locales.map((locale) => ({ locale, slug: e.slug })));
}

export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params;
  const entry = getCompareEntry(slug);
  if (!entry) return {};
  return pageMetadata({
    title: pick(entry.title, locale),
    description: pick(entry.description, locale),
    path: `/compare/${slug}`,
    locale,
  });
}

export default async function ComparePage({ params }: Props): Promise<JSX.Element> {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const entry = getCompareEntry(slug);
  if (!entry) notFound();
  const hasFitGuidance = Boolean(entry.bestFor?.length || entry.notBestFor?.length);

  const faqSchema = faqPageSchema(
    entry.faqs.map((f) => ({ question: pick(f.q, locale), answer: pick(f.a, locale) })),
  );
  const crumb = breadcrumbSchema([
    { name: 'Excalicast', url: absoluteUrl(locale, '/') },
    { name: locale === 'zh' ? '对比' : 'Compare', url: absoluteUrl(locale, '/compare') },
    { name: pick(entry.title, locale), url: absoluteUrl(locale, `/compare/${slug}`) },
  ]);

  return (
    <ContentShell locale={locale} contentType="compare" slug={slug}>
      <JsonLd data={[faqSchema, crumb]} />
      <PageTitle>{pick(entry.title, locale)}</PageTitle>
      <Lead>{pick(entry.intro, locale)}</Lead>
      <DirectAnswer answer={entry.directAnswer} locale={locale} />

      <SectionHeading>{locale === 'zh' ? '功能对比' : 'Feature comparison'}</SectionHeading>
      <CompareTable rows={entry.rows} competitor={entry.competitor} locale={locale} />

      {hasFitGuidance ? (
        <>
          <SectionHeading>{locale === 'zh' ? '适用场景' : 'Who each option fits'}</SectionHeading>
          <FitLists bestFor={entry.bestFor} notBestFor={entry.notBestFor} locale={locale} />
        </>
      ) : null}

      {entry.workflow?.length ? (
        <>
          <SectionHeading>{locale === 'zh' ? 'Excalicast 端到端工作流' : 'The Excalicast end-to-end workflow'}</SectionHeading>
          <WorkflowList steps={entry.workflow} locale={locale} />
        </>
      ) : null}

      {entry.facts?.length ? (
        <>
          <SectionHeading>{locale === 'zh' ? '已核实事实' : 'Verified facts'}</SectionHeading>
          <FactList facts={entry.facts} locale={locale} />
        </>
      ) : null}

      <SectionHeading>{locale === 'zh' ? '该选哪个' : 'Which to choose'}</SectionHeading>
      <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--ink-2)' }}>{pick(entry.verdict, locale)}</p>

      {entry.limitations?.length ? (
        <>
          <SectionHeading>{locale === 'zh' ? '边界与限制' : 'Limits and boundaries'}</SectionHeading>
          <LimitationsList limitations={entry.limitations} locale={locale} />
        </>
      ) : null}

      <SectionHeading>{locale === 'zh' ? '常见问题' : 'FAQ'}</SectionHeading>
      <FaqList faqs={entry.faqs} locale={locale} />

      {entry.sources?.length ? (
        <>
          <SectionHeading>{locale === 'zh' ? '公开来源' : 'Public sources'}</SectionHeading>
          <SourceList sources={entry.sources} verifiedAt={entry.verifiedAt} locale={locale} />
        </>
      ) : null}

      <RelatedLinks refs={entry.related} locale={locale} />

      <CtaRow locale={locale} type="compare" slug={slug} preset={entry.ctaPreset} />
    </ContentShell>
  );
}
