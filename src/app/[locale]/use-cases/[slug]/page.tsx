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
  const workflow = entry.workflow ?? entry.steps ?? [];
  const hasFitGuidance = Boolean(entry.bestFor?.length || entry.notBestFor?.length);

  const faqSchema = faqPageSchema(
    entry.faqs.map((f) => ({ question: pick(f.q, locale), answer: pick(f.a, locale) })),
  );
  const crumb = breadcrumbSchema([
    { name: 'Excalicast', url: absoluteUrl(locale, '/') },
    { name: locale === 'zh' ? '使用场景' : 'Use cases', url: absoluteUrl(locale, '/use-cases') },
    { name: pick(entry.title, locale), url: absoluteUrl(locale, `/use-cases/${slug}`) },
  ]);

  return (
    <ContentShell locale={locale} contentType="use-case" slug={slug}>
      <JsonLd data={[faqSchema, crumb]} />
      <PageTitle>{pick(entry.title, locale)}</PageTitle>
      <Lead>{pick(entry.intro, locale)}</Lead>
      <DirectAnswer answer={entry.directAnswer} locale={locale} />

      {hasFitGuidance ? (
        <>
          <SectionHeading>{locale === 'zh' ? '适用场景' : 'Who this workflow fits'}</SectionHeading>
          <FitLists bestFor={entry.bestFor} notBestFor={entry.notBestFor} locale={locale} />
        </>
      ) : null}

      <SectionHeading>{locale === 'zh' ? '工作流程' : 'Workflow'}</SectionHeading>
      <WorkflowList steps={workflow} locale={locale} />

      {entry.facts?.length ? (
        <>
          <SectionHeading>{locale === 'zh' ? '工作流事实' : 'Workflow facts'}</SectionHeading>
          <FactList facts={entry.facts} locale={locale} />
        </>
      ) : null}

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
          <SectionHeading>{locale === 'zh' ? '参考来源' : 'References'}</SectionHeading>
          <SourceList sources={entry.sources} verifiedAt={entry.verifiedAt} locale={locale} />
        </>
      ) : null}

      <RelatedLinks refs={entry.related} locale={locale} />

      <CtaRow locale={locale} type="use-case" slug={slug} preset={entry.ctaPreset} />
    </ContentShell>
  );
}
