import type { Metadata } from 'next';
import { buildAlternates } from './alternates';

/**
 * Standard metadata for a content page. Sets canonical + hreflang and mirrors
 * the page title/description into OpenGraph + Twitter so social/AI cards show
 * the page's own title (Next does not copy `title` into `openGraph` itself).
 * og:image is still inherited from the [locale]/opengraph-image route.
 */
export function pageMetadata(opts: {
  title: string;
  description: string;
  /** Path WITHOUT locale prefix, e.g. '/compare/excalicast-vs-loom'. */
  path: string;
  locale: string;
  ogType?: 'website' | 'article';
  publishedTime?: string;
}): Metadata {
  const { title, description, path, locale, ogType = 'website', publishedTime } = opts;
  return {
    title,
    description,
    alternates: buildAlternates(path, locale),
    openGraph: {
      title,
      description,
      type: ogType,
      ...(publishedTime ? { publishedTime } : {}),
    },
    twitter: { title, description },
  };
}
