import type { MetadataRoute } from 'next';
import { locales } from '@/i18n/config';
import { SITE_URL } from '@/lib/seo/alternates';
import { allContentRoutes } from '@/content';

/**
 * Generates /sitemap.xml. Enumerates every locale × indexable route (marketing
 * + programmatic content) with hreflang alternates so Google/Bing index both
 * language versions and understand they correspond. The /app, /library and /s
 * routes are intentionally excluded (Client-only, no SEO value / private).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: { path: string; lastModified: string; priority: number }[] = [
    { path: '/', lastModified: '2026-06-01', priority: 1 },
    { path: '/pricing', lastModified: '2026-07-30', priority: 0.8 },
    { path: '/terms', lastModified: '2026-06-01', priority: 0.3 },
    { path: '/privacy', lastModified: '2026-06-01', priority: 0.3 },
    { path: '/refund', lastModified: '2026-06-01', priority: 0.3 },
  ];

  const contentRoutes = allContentRoutes().map((r) => ({
    path: r.path,
    lastModified: r.lastModified,
    priority: r.path.split('/').length > 2 ? 0.7 : 0.6,
  }));

  const all = [...staticRoutes, ...contentRoutes];

  const langUrl = (loc: string, path: string) =>
    `${SITE_URL}/${loc}${path === '/' ? '' : path}`;

  return all.flatMap((route) =>
    locales.map((loc) => ({
      url: langUrl(loc, route.path),
      lastModified: route.lastModified,
      changeFrequency: 'weekly' as const,
      priority: route.priority,
      alternates: {
        languages: {
          'zh-CN': langUrl('zh', route.path),
          en: langUrl('en', route.path),
          'x-default': langUrl('en', route.path),
        },
      },
    })),
  );
}
