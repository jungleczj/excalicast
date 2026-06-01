import type { JSX } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo/meta';
import { ContentShell } from '@/components/content/ContentShell';
import { PageTitle, Lead } from '@/components/content/ContentPieces';
import { EntryList } from '@/components/content/EntryList';
import { COMPARE_ENTRIES, pick } from '@/content';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const zh = locale === 'zh';
  return pageMetadata({
    title: zh ? 'Excalicast 对比：白板录制工具替代方案' : 'Excalicast comparisons: whiteboard recorder alternatives',
    description: zh
      ? '把 Excalicast 和 Loom、tldraw、传统录屏对比，看看白板讲解场景该选哪个。'
      : 'Compare Excalicast with Loom, tldraw, and screen recording to pick the right tool for whiteboard explainers.',
    path: '/compare',
    locale,
  });
}

export default async function CompareIndex({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const zh = locale === 'zh';
  return (
    <ContentShell locale={locale}>
      <PageTitle>{zh ? '对比' : 'Compare'}</PageTitle>
      <Lead>
        {zh
          ? '看 Excalicast 与其他白板 / 录制工具的逐项对比，判断哪种最适合你的讲解。'
          : 'See how Excalicast stacks up against other whiteboard and recording tools, feature by feature.'}
      </Lead>
      <EntryList
        items={COMPARE_ENTRIES.map((e) => ({
          href: `/compare/${e.slug}`,
          title: pick(e.title, locale),
          description: pick(e.description, locale),
          meta: `Excalicast vs ${e.competitor}`,
        }))}
      />
    </ContentShell>
  );
}
