import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n/config';
import { absoluteUrl } from '@/lib/seo/alternates';
import { pageMetadata } from '@/lib/seo/meta';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbSchema } from '@/lib/seo/schema';
import { ContentShell } from '@/components/content/ContentShell';
import {
  CtaRow,
  DirectAnswer,
  FactList,
  FaqList,
  Lead,
  LimitationsList,
  PageTitle,
  SectionHeading,
  SourceList,
  WorkflowList,
} from '@/components/content/ContentPieces';
import { RelatedLinks } from '@/components/content/RelatedLinks';
import { PILLAR_ENTRIES, getPillarEntry, pick } from '@/content';

interface Props {
  params: Promise<{ locale: string; pillar: string }>;
}

export function generateStaticParams() {
  return PILLAR_ENTRIES.flatMap((entry) =>
    locales.map((locale) => ({ locale, pillar: entry.slug })),
  );
}

export async function generateMetadata({ params }: Props) {
  const { locale, pillar } = await params;
  const entry = getPillarEntry(pillar);
  if (!entry) return {};
  return pageMetadata({
    title: pick(entry.title, locale),
    description: pick(entry.description, locale),
    path: `/${entry.slug}`,
    locale,
  });
}

export default async function PillarPage({ params }: Props): Promise<JSX.Element> {
  const { locale, pillar } = await params;
  setRequestLocale(locale);
  const entry = getPillarEntry(pillar);
  if (!entry) notFound();

  const crumb = breadcrumbSchema([
    { name: 'Excalicast', url: absoluteUrl(locale, '/') },
    { name: pick(entry.title, locale), url: absoluteUrl(locale, `/${entry.slug}`) },
  ]);

  return (
    <ContentShell locale={locale} contentType="pillar" slug={entry.slug}>
      <JsonLd data={crumb} />
      <PageTitle>{pick(entry.title, locale)}</PageTitle>
      <Lead>{pick(entry.intro, locale)}</Lead>
      <DirectAnswer answer={entry.directAnswer} locale={locale} />

      {entry.body.map((block, index) => (
        <section key={index}>
          {block.heading ? <SectionHeading>{pick(block.heading, locale)}</SectionHeading> : null}
          {block.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex} style={{ marginTop: 12, fontSize: 16, lineHeight: 1.7, color: 'var(--ink-2)' }}>
              {pick(paragraph, locale)}
            </p>
          ))}
        </section>
      ))}

      <SectionHeading>{locale === 'zh' ? '工作流程' : 'Workflow'}</SectionHeading>
      <WorkflowList steps={entry.workflow} locale={locale} />

      <SectionHeading>{locale === 'zh' ? '可验证事实' : 'Verifiable facts'}</SectionHeading>
      <FactList facts={entry.facts} locale={locale} />

      <SectionHeading>{locale === 'zh' ? '边界与限制' : 'Limits and boundaries'}</SectionHeading>
      <LimitationsList limitations={entry.limitations} locale={locale} />

      <SectionHeading>{locale === 'zh' ? '常见问题' : 'FAQ'}</SectionHeading>
      <FaqList faqs={entry.faqs} locale={locale} />

      <SectionHeading>{locale === 'zh' ? '参考来源' : 'References'}</SectionHeading>
      <SourceList sources={entry.sources} verifiedAt={entry.verifiedAt} locale={locale} />

      <RelatedLinks refs={entry.related} locale={locale} />
      <CtaRow locale={locale} type="pillar" slug={entry.slug} preset={entry.ctaPreset} />
    </ContentShell>
  );
}
