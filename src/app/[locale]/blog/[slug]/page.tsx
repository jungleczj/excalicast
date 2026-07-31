import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n/config';
import { absoluteUrl, SITE_URL } from '@/lib/seo/alternates';
import { pageMetadata } from '@/lib/seo/meta';
import { JsonLd } from '@/components/seo/JsonLd';
import { faqPageSchema, breadcrumbSchema } from '@/lib/seo/schema';
import { ContentShell } from '@/components/content/ContentShell';
import { PageTitle, Lead, SectionHeading, FaqList, CtaRow } from '@/components/content/ContentPieces';
import { RelatedLinks } from '@/components/content/RelatedLinks';
import { BLOG_ENTRIES, getBlogEntry, pick } from '@/content';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export function generateStaticParams() {
  return BLOG_ENTRIES.flatMap((e) => locales.map((locale) => ({ locale, slug: e.slug })));
}

export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params;
  const entry = getBlogEntry(slug);
  if (!entry) return {};
  return pageMetadata({
    title: pick(entry.title, locale),
    description: pick(entry.description, locale),
    path: `/blog/${slug}`,
    locale,
    ogType: 'article',
    publishedTime: entry.date,
  });
}

export default async function BlogPostPage({ params }: Props): Promise<JSX.Element> {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const entry = getBlogEntry(slug);
  if (!entry) notFound();

  // Article schema lets AI engines attribute the post; FAQ schema (if any)
  // adds liftable answers.
  const articleSchema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: pick(entry.title, locale),
    description: pick(entry.description, locale),
    datePublished: entry.date,
    inLanguage: locale === 'zh' ? 'zh-CN' : 'en',
    author: { '@type': 'Organization', name: 'Excalicast' },
    publisher: { '@type': 'Organization', name: 'Excalicast' },
    mainEntityOfPage: `${SITE_URL}/${locale}/blog/${slug}`,
  };
  const schemas: Record<string, unknown>[] = [
    articleSchema,
    breadcrumbSchema([
      { name: 'Excalicast', url: absoluteUrl(locale, '/') },
      { name: 'Blog', url: absoluteUrl(locale, '/blog') },
      { name: pick(entry.title, locale), url: absoluteUrl(locale, `/blog/${slug}`) },
    ]),
  ];
  if (entry.faqs?.length) {
    schemas.push(faqPageSchema(entry.faqs.map((f) => ({ question: pick(f.q, locale), answer: pick(f.a, locale) }))));
  }

  return (
    <ContentShell locale={locale} contentType="blog" slug={slug}>
      <JsonLd data={schemas} />
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-3)' }}>{entry.date}</div>
      <div style={{ marginTop: 8 }}>
        <PageTitle>{pick(entry.title, locale)}</PageTitle>
      </div>
      <Lead>{pick(entry.intro, locale)}</Lead>

      {entry.body.map((block, i) => (
        <section key={i}>
          {block.heading && <SectionHeading>{pick(block.heading, locale)}</SectionHeading>}
          {block.paragraphs.map((p, j) => (
            <p key={j} style={{ marginTop: 14, fontSize: 16, lineHeight: 1.7, color: 'var(--ink-2)' }}>
              {pick(p, locale)}
            </p>
          ))}
        </section>
      ))}

      {entry.faqs?.length ? (
        <>
          <SectionHeading>{locale === 'zh' ? '常见问题' : 'FAQ'}</SectionHeading>
          <FaqList faqs={entry.faqs} locale={locale} />
        </>
      ) : null}

      <RelatedLinks refs={entry.related} locale={locale} />

      <CtaRow locale={locale} type="blog" slug={slug} />
    </ContentShell>
  );
}
