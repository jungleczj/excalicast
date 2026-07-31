import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/alternates';

/**
 * Generates /robots.txt. Explicitly welcomes general crawlers AND the major
 * generative-AI crawlers (GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot,
 * Google-Extended) — this is part of the GEO strategy: we WANT AI engines to
 * read the site so they can cite excalicast.cc. Only private/app routes are
 * disallowed.
 */
export default function robots(): MetadataRoute.Robots {
  const privateSegments = ['app', 'library', 'export/', 'play/', 's/', 'admin/'];
  const localizedPrivateRoutes = ['en', 'zh'].flatMap((locale) =>
    privateSegments.map((segment) => `/${locale}/${segment}`),
  );
  const disallow = ['/api/', ...localizedPrivateRoutes];
  const aiBots = [
    'GPTBot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'PerplexityBot',
    'Perplexity-User',
    'ClaudeBot',
    'Claude-User',
    'Google-Extended',
    'Applebot-Extended',
    'CCBot',
  ];

  return {
    rules: [
      { userAgent: '*', allow: '/', disallow },
      ...aiBots.map((ua) => ({ userAgent: ua, allow: '/', disallow })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
