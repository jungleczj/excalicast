import type { JSX } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo/meta';
import { ContentShell } from '@/components/content/ContentShell';
import { PageTitle, Lead, HubLinks } from '@/components/content/ContentPieces';
import { EntryList } from '@/components/content/EntryList';
import { BLOG_ENTRIES, pick } from '@/content';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const zh = locale === 'zh';
  return pageMetadata({
    title: zh ? 'Excalicast 博客：白板录制技巧' : 'Excalicast blog: whiteboard recording guides',
    description: zh
      ? '关于白板录制、多比例导出和操作流采集的实用文章。'
      : 'Practical articles on whiteboard recording, multi-ratio export, and operation-stream capture.',
    path: '/blog',
    locale,
  });
}

export default async function BlogIndex({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const zh = locale === 'zh';
  const sorted = [...BLOG_ENTRIES].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ContentShell locale={locale}>
      <PageTitle>{zh ? '博客' : 'Blog'}</PageTitle>
      <Lead>
        {zh
          ? '关于白板录制与多比例导出的实用指南。'
          : 'Practical guides on recording whiteboards and exporting to every aspect ratio.'}
      </Lead>
      <EntryList
        items={sorted.map((e) => ({
          href: `/blog/${e.slug}`,
          title: pick(e.title, locale),
          description: pick(e.description, locale),
          meta: e.date,
        }))}
      />
      <HubLinks locale={locale} current="blog" />
    </ContentShell>
  );
}
