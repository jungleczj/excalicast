import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/alternates';

/**
 * Generates /robots.txt. Search/indexing and user-request fetchers may read
 * public marketing content, while model-training crawlers are opted out.
 * These are separate product choices: training access is not required for
 * ChatGPT, Perplexity or Claude search visibility.
 */
export default function robots(): MetadataRoute.Robots {
  const privateSegments = ['app', 'library', 'export/', 'play/', 's/', 'admin/'];
  const localizedPrivateRoutes = ['en', 'zh'].flatMap((locale) =>
    privateSegments.map((segment) => `/${locale}/${segment}`),
  );
  const disallow = ['/api/', ...localizedPrivateRoutes];
  const searchBots = [
    'OAI-SearchBot',
    'ChatGPT-User',
    'PerplexityBot',
    'Perplexity-User',
    'Claude-SearchBot',
    'Claude-User',
  ];
  const trainingBots = [
    'GPTBot',
    'ClaudeBot',
    'Google-Extended',
    'Applebot-Extended',
    'CCBot',
  ];

  return {
    rules: [
      { userAgent: '*', allow: '/', disallow },
      ...searchBots.map((ua) => ({ userAgent: ua, allow: '/', disallow })),
      ...trainingBots.map((ua) => ({ userAgent: ua, disallow: '/' })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
