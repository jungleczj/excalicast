import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n/config';
import { absoluteUrl } from '@/lib/seo/alternates';
import { pageMetadata } from '@/lib/seo/meta';
import { JsonLd } from '@/components/seo/JsonLd';
import { blogPostingSchema, breadcrumbSchema } from '@/lib/seo/schema';
import { ContentShell } from '@/components/content/ContentShell';
import { PageTitle, Lead, SectionHeading, FaqList, CtaRow, SourceList } from '@/components/content/ContentPieces';
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

  const articleSchema = blogPostingSchema({
    locale,
    slug,
    headline: pick(entry.title, locale),
    description: pick(entry.description, locale),
    publishedAt: entry.date,
    updatedAt: entry.updatedAt,
    image: absoluteUrl(locale, entry.heroMedia.url),
    author: { name: pick(entry.author.name, locale), url: absoluteUrl(locale, entry.author.url) },
  });
  const schemas: Record<string, unknown>[] = [
    articleSchema,
    breadcrumbSchema([
      { name: 'Excalicast', url: absoluteUrl(locale, '/') },
      { name: 'Blog', url: absoluteUrl(locale, '/blog') },
      { name: pick(entry.title, locale), url: absoluteUrl(locale, `/blog/${slug}`) },
    ]),
  ];
  return (
    <ContentShell locale={locale} contentType="blog" slug={slug}>
      <JsonLd data={schemas} />
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-3)' }}>
        {locale === 'zh' ? '发布' : 'Published'} {entry.date} · {locale === 'zh' ? '更新' : 'Updated'} {entry.updatedAt} · {pick(entry.author.name, locale)}
      </div>
      <div style={{ marginTop: 8 }}>
        <PageTitle>{pick(entry.title, locale)}</PageTitle>
      </div>
      <Lead>{pick(entry.intro, locale)}</Lead>
      {/* The visible hero and BlogPosting.image deliberately share one source. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/${locale}${entry.heroMedia.url}`}
        alt={pick(entry.heroMedia.alt, locale)}
        width={1200}
        height={630}
        loading="eager"
        decoding="async"
        style={{ display: 'block', width: '100%', height: 'auto', marginTop: 28, border: '2px solid var(--ink)', borderRadius: 14 }}
      />

      <SectionHeading>{locale === 'zh' ? '要点' : 'Key takeaways'}</SectionHeading>
      <ul style={{ paddingLeft: 20, color: 'var(--ink-2)' }}>
        {entry.keyTakeaways.map((takeaway, index) => (
          <li key={index} style={{ marginTop: 8, lineHeight: 1.65 }}>{pick(takeaway, locale)}</li>
        ))}
      </ul>

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

      <SectionHeading>{locale === 'zh' ? '参考来源' : 'References'}</SectionHeading>
      <SourceList sources={entry.sources} verifiedAt={entry.updatedAt} locale={locale} />

      <RelatedLinks refs={entry.related} locale={locale} />

      <CtaRow locale={locale} type="blog" slug={slug} />
    </ContentShell>
  );
}
