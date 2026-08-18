import type { JSX } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo/meta';
import { ContentShell } from '@/components/content/ContentShell';
import { PageTitle, Lead, HubLinks } from '@/components/content/ContentPieces';
import { EntryList } from '@/components/content/EntryList';
import { USE_CASE_ENTRIES, pick } from '@/content';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const zh = locale === 'zh';
  return pageMetadata({
    title: zh ? 'Excalicast 使用场景：白板录制怎么用' : 'Excalicast use cases: ways to record a whiteboard',
    description: zh
      ? '从录制白板讲座到异步架构讲解，看 Excalicast 在各场景下怎么用。'
      : 'From whiteboard lectures to async architecture walkthroughs, see how to use Excalicast.',
    path: '/use-cases',
    locale,
  });
}

export default async function UseCaseIndex({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const zh = locale === 'zh';
  return (
    <ContentShell locale={locale}>
      <PageTitle>{zh ? '使用场景' : 'Use cases'}</PageTitle>
      <Lead>
        {zh
          ? '一步步教你用 Excalicast 录制讲座、讲解和短视频。'
          : 'Step-by-step guides for recording lectures, walkthroughs, and short-form explainers with Excalicast.'}
      </Lead>
      <EntryList
        items={USE_CASE_ENTRIES.map((e) => ({
          href: `/use-cases/${e.slug}`,
          title: pick(e.title, locale),
          description: pick(e.description, locale),
        }))}
      />
      <HubLinks locale={locale} current="use-case" />
    </ContentShell>
  );
}
