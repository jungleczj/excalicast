import type { JSX } from 'react';
import { getCompareEntry, getUseCaseEntry, getBlogEntry, pick } from '@/content';
import type { ContentRef } from '@/content/types';
import { EntryList } from '@/components/content/EntryList';

const PATH_PREFIX: Record<ContentRef['type'], string> = {
  compare: '/compare',
  'use-case': '/use-cases',
  blog: '/blog',
};

/** Resolve a ContentRef to its localized title + href, or null if missing. */
function resolve(ref: ContentRef, locale: string): { href: string; title: string; description: string } | null {
  const entry =
    ref.type === 'compare'
      ? getCompareEntry(ref.slug)
      : ref.type === 'use-case'
        ? getUseCaseEntry(ref.slug)
        : getBlogEntry(ref.slug);
  if (!entry) return null;
  return {
    href: `${PATH_PREFIX[ref.type]}/${ref.slug}`,
    title: pick(entry.title, locale),
    description: pick(entry.description, locale),
  };
}

/**
 * Internal-linking block: renders cross-links to related content pages so
 * crawlers can traverse the hub-and-spoke graph and AI engines see related
 * coverage. Server Component. Renders nothing if no refs resolve.
 */
export function RelatedLinks({
  refs,
  locale,
}: {
  refs: ContentRef[] | undefined;
  locale: string;
}): JSX.Element | null {
  if (!refs?.length) return null;
  const items = refs.map((r) => resolve(r, locale)).filter((x): x is NonNullable<typeof x> => x !== null);
  if (items.length === 0) return null;

  return (
    <section>
      <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 44, marginBottom: 4 }}>
        {locale === 'zh' ? '相关阅读' : 'Related'}
      </h2>
      <EntryList items={items} />
    </section>
  );
}
