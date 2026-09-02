import { expect, test } from '@playwright/test';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { BLOG_ENTRIES, COMPARE_ENTRIES, PILLAR_ENTRIES, USE_CASE_ENTRIES } from '@/content';
import { defaultLocale } from '@/i18n/config';
import { pageMetadata } from '@/lib/seo/meta';
import { organizationSchema, softwareApplicationSchema } from '@/lib/seo/schema';
import * as seoSchema from '@/lib/seo/schema';
import { FUNNEL_STEPS, KNOWN_EVENT_SET } from '@/lib/analytics/events';

test('private localized routes are blocked and public pricing is indexed', () => {
  const rules = robots().rules;
  const genericRule = Array.isArray(rules) ? rules.find((rule) => rule.userAgent === '*') : rules;
  const disallow = Array.isArray(genericRule?.disallow)
    ? genericRule.disallow
    : [genericRule?.disallow].filter(Boolean);

  for (const locale of ['en', 'zh']) {
    for (const path of ['app', 'library', 'export/', 'play/', 's/', 'admin/']) {
      expect(disallow).toContain(`/${locale}/${path}`);
    }
  }

  const urls = sitemap().map((entry) => entry.url);
  expect(urls).toContain('https://excalicast.cc/en/pricing');
  expect(urls).toContain('https://excalicast.cc/zh/pricing');
  expect(urls.some((url) => /\/(?:en|zh)\/(?:app|library|export|play|s|admin)(?:\/|$)/.test(url))).toBe(false);

  for (const entry of [...COMPARE_ENTRIES, ...USE_CASE_ENTRIES]) {
    const type = 'competitor' in entry ? 'compare' : 'use-cases';
    expect(urls).toContain(`https://excalicast.cc/en/${type}/${entry.slug}`);
    expect(urls).toContain(`https://excalicast.cc/zh/${type}/${entry.slug}`);
  }
  for (const entry of BLOG_ENTRIES) {
    expect(urls).toContain(`https://excalicast.cc/en/blog/${entry.slug}`);
    expect(urls).toContain(`https://excalicast.cc/zh/blog/${entry.slug}`);
  }
});

test('English is the default market and strategic entity pages are indexed', () => {
  expect(defaultLocale).toBe('en');

  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);
  for (const path of [
    '/about',
    '/excalidraw-recorder',
    '/whiteboard-recorder',
    '/event-based-recording',
  ]) {
    expect(urls).toContain(`https://excalicast.cc/en${path}`);
    expect(urls).toContain(`https://excalicast.cc/zh${path}`);
  }

  const homepage = entries.find((entry) => entry.url === 'https://excalicast.cc/en');
  expect(homepage?.lastModified).toBe('2026-08-26');
});

test('robots separates search discovery crawlers from model-training crawlers', () => {
  const rules = robots().rules;
  expect(Array.isArray(rules)).toBe(true);
  if (!Array.isArray(rules)) return;

  const userAgents = rules.map((rule) => rule.userAgent);
  expect(userAgents).toContain('OAI-SearchBot');
  expect(userAgents).toContain('PerplexityBot');
  for (const userAgent of ['GPTBot', 'CCBot']) {
    const rule = rules.find((item) => item.userAgent === userAgent);
    expect(rule?.disallow).toBe('/');
  }
});

test('brand schemas use stable entity ids and a canonical logo', () => {
  const organization = organizationSchema();
  const software = softwareApplicationSchema({
    locale: 'zh',
    description: '从多源录制到发布就绪成品的一站式工作流。',
    oneTimePrice: 4.99,
    proPrice: 9.99,
    maxPrice: 15.99,
    currency: 'USD',
  });

  expect(organization['@id']).toBe('https://excalicast.cc/#organization');
  expect(organization.logo).toBe('https://excalicast.cc/icon.png');
  expect(software['@id']).toBe('https://excalicast.cc/#software');
  expect(software.publisher).toEqual({ '@id': 'https://excalicast.cc/#organization' });
});

test('shared schema builders emit a connected brand graph and verifiable blog authorship', () => {
  const builders = seoSchema as unknown as {
    brandGraphSchema?: (input: {
      locale: string;
      description: string;
      oneTimePrice: number;
      proPrice: number;
      maxPrice: number;
      currency: string;
    }) => Record<string, unknown>;
    blogPostingSchema?: (input: {
      locale: string;
      slug: string;
      headline: string;
      description: string;
      publishedAt: string;
      updatedAt: string;
      image: string;
      author: { name: string; url: string };
    }) => Record<string, unknown>;
  };

  expect(builders.brandGraphSchema).toBeDefined();
  expect(builders.blogPostingSchema).toBeDefined();
  if (!builders.brandGraphSchema || !builders.blogPostingSchema) return;

  const graph = builders.brandGraphSchema({
    locale: 'en',
    description: 'A local-first visual explanation recorder.',
    oneTimePrice: 4.99,
    proPrice: 9.99,
    maxPrice: 15.99,
    currency: 'USD',
  });
  const nodes = graph['@graph'] as Array<Record<string, unknown>>;
  expect(nodes.map((node) => node['@id'])).toEqual(expect.arrayContaining([
    'https://excalicast.cc/#organization',
    'https://excalicast.cc/#website',
    'https://excalicast.cc/#software',
  ]));

  const article = builders.blogPostingSchema({
    locale: 'en',
    slug: 'event-based-recording',
    headline: 'Event-based recording',
    description: 'How operation streams become video.',
    publishedAt: '2026-06-01',
    updatedAt: '2026-08-26',
    image: 'https://excalicast.cc/en/opengraph-image',
    author: { name: 'Excalicast Editorial Team', url: 'https://excalicast.cc/en/about' },
  });
  expect(article['@type']).toBe('BlogPosting');
  expect(article.dateModified).toBe('2026-08-26');
  expect(article.author).toMatchObject({
    name: 'Excalicast Editorial Team',
    url: 'https://excalicast.cc/en/about',
  });
});

test('comparison cluster and end-to-end pillar page expose GEO fields', () => {
  const comparisonSlugs = [
    'excalicast-vs-excalicord',
    'excalicast-vs-excalirec',
    'excalicast-vs-focusee',
    'excalicast-vs-explain-everything',
    'excalicast-vs-screenity',
  ];

  for (const slug of comparisonSlugs) {
    const entry = COMPARE_ENTRIES.find((item) => item.slug === slug);
    expect(entry, `${slug} must exist`).toBeTruthy();
    expect(entry?.directAnswer?.zh.length).toBeGreaterThan(40);
    expect(entry?.bestFor?.length).toBeGreaterThan(0);
    expect(entry?.notBestFor?.length).toBeGreaterThan(0);
    expect(entry?.facts?.length).toBeGreaterThanOrEqual(2);
    expect(entry?.sources?.length).toBeGreaterThan(0);
    expect(entry?.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }

  const pillar = USE_CASE_ENTRIES.find(
    (item) => item.slug === 'record-edit-publish-whiteboard-video',
  );
  expect(pillar).toBeTruthy();
  expect(pillar?.directAnswer?.zh).toContain('发布就绪');
  expect(pillar?.workflow?.length).toBeGreaterThanOrEqual(8);
  expect(pillar?.ctaPreset?.href).toBe('/app?source=whiteboard');
});

test('every blog post carries publication-grade provenance', () => {
  for (const entry of BLOG_ENTRIES) {
    expect(entry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.author.name.en.length).toBeGreaterThan(0);
    expect(entry.author.url).toBe('/about');
    expect(entry.sources.length).toBeGreaterThan(0);
    expect(entry.heroMedia.url).toMatch(/^\//);
    expect(entry.keyTakeaways.length).toBeGreaterThanOrEqual(2);
  }
});

test('Semrush opportunity pages cover each qualified keyword without cannibalization', () => {
  const clusters = [
    {
      slug: 'how-to-screen-record-on-windows-11',
      terms: ['how to screen record on pc', 'screen recorder windows 11', 'record screen windows 11'],
    },
    { slug: 'screencasting-guide', terms: ['screencasting'] },
    { slug: 'best-screen-recorder-for-mac', terms: ['screen recorder for mac'] },
    {
      slug: 'whiteboard-animation-and-hand-drawn-explainers',
      terms: ['whiteboard animation', 'animated explainer video', 'hand drawn animation'],
    },
  ];

  for (const cluster of clusters) {
    const entry = BLOG_ENTRIES.find((item) => item.slug === cluster.slug);
    expect(entry, `${cluster.slug} must exist`).toBeTruthy();
    const searchableCopy = [
      entry?.title.en,
      entry?.description.en,
      entry?.intro.en,
      ...(entry?.body.flatMap((block) => [
        block.heading?.en,
        ...block.paragraphs.map((paragraph) => paragraph.en),
      ]) ?? []),
    ].join(' ').toLowerCase();
    for (const term of cluster.terms) {
      expect(searchableCopy, `${cluster.slug} should cover ${term}`).toContain(term);
    }
    expect(entry?.body.length).toBeGreaterThanOrEqual(5);
    expect(entry?.faqs?.length).toBeGreaterThanOrEqual(3);
  }

  const allTerms = clusters.flatMap((cluster) => cluster.terms);
  expect(new Set(allTerms).size).toBe(allTerms.length);
});

test('new-site keyword expansion ships useful comparison clusters instead of doorway pages', () => {
  const softwareGuide = BLOG_ENTRIES.find(
    (item) => item.slug === 'whiteboard-animation-software-comparison',
  );
  expect(softwareGuide).toBeTruthy();
  const softwareCopy = [
    softwareGuide?.title.en,
    softwareGuide?.description.en,
    softwareGuide?.intro.en,
    ...(softwareGuide?.body.flatMap((block) => [
      block.heading?.en,
      ...block.paragraphs.map((paragraph) => paragraph.en),
    ]) ?? []),
  ].join(' ').toLowerCase();
  for (const term of [
    'whiteboard animation software comparison chart',
    'whiteboard animation software comparison',
    'whiteboard animation software',
    'best whiteboard animation software',
  ]) {
    expect(softwareCopy).toContain(term);
  }
  expect(softwareGuide?.body.length).toBeGreaterThanOrEqual(6);
  expect(softwareGuide?.faqs?.length).toBeGreaterThanOrEqual(4);
  expect(softwareGuide?.sources.length).toBeGreaterThanOrEqual(4);

  const snagit = COMPARE_ENTRIES.find((item) => item.slug === 'excalicast-vs-snagit');
  expect(snagit).toBeTruthy();
  expect(`${snagit?.title.en} ${snagit?.description.en}`.toLowerCase()).toContain(
    'snagit alternative',
  );
  expect(snagit?.directAnswer?.en).toContain('Snagit');
  expect(snagit?.bestFor?.length).toBeGreaterThanOrEqual(2);
  expect(snagit?.notBestFor?.length).toBeGreaterThanOrEqual(2);
  expect(snagit?.facts?.length).toBeGreaterThanOrEqual(2);
  expect(snagit?.sources?.length).toBeGreaterThanOrEqual(2);
  expect(snagit?.verifiedAt).toBe('2026-09-01');

  const screenStudio = COMPARE_ENTRIES.find(
    (item) => item.slug === 'excalicast-vs-screen-studio',
  );
  expect(
    `${screenStudio?.title.en} ${screenStudio?.description.en} ${screenStudio?.directAnswer?.en}`.toLowerCase(),
  ).toContain('screen studio alternative');
  expect(screenStudio?.sources?.length).toBeGreaterThanOrEqual(2);
  expect(screenStudio?.verifiedAt).toBe('2026-09-01');

  const urls = sitemap().map((entry) => entry.url);
  for (const path of [
    '/blog/whiteboard-animation-software-comparison',
    '/compare/excalicast-vs-snagit',
  ]) {
    expect(urls).toContain(`https://excalicast.cc/en${path}`);
    expect(urls).toContain(`https://excalicast.cc/zh${path}`);
  }
});

test('Bing-facing comparison metadata stays within stable length ranges', () => {
  for (const slug of ['excalicast-vs-loom', 'excalicast-vs-screen-studio']) {
    const entry = COMPARE_ENTRIES.find((item) => item.slug === slug);
    expect(entry, `${slug} must exist`).toBeTruthy();
    expect(entry?.title.en.length, `${slug} English title`).toBeLessThanOrEqual(60);
    expect(entry?.description.en.length, `${slug} English description`).toBeGreaterThanOrEqual(90);
    expect(entry?.description.en.length, `${slug} English description`).toBeLessThanOrEqual(145);
  }
});

test('content metadata does not append the Excalicast brand twice', () => {
  const title = 'Excalicast vs Loom for whiteboard videos';
  const metadata = pageMetadata({
    title,
    description: 'A source-checked comparison for visual explanation workflows.',
    path: '/compare/excalicast-vs-loom',
    locale: 'en',
  });

  expect(metadata.title).toEqual({ absolute: title });
});

test('pillar pages have compact search titles separate from their editorial H1', () => {
  const entries = PILLAR_ENTRIES as Array<{
    title: { en: string; zh: string };
    seoTitle?: { en: string; zh: string };
  }>;

  for (const entry of entries) {
    expect(entry.seoTitle, `${entry.title.en} needs a dedicated search title`).toBeDefined();
    expect(entry.seoTitle?.en.length).toBeLessThanOrEqual(50);
    expect(entry.seoTitle?.en).not.toBe(entry.title.en);
  }
});

test('homepage aligns the search promise and hero CTA with the recording workflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en');

  const title = await page.title();
  expect(title).toContain('Record Visual Explanations');
  expect(title.length).toBeLessThanOrEqual(60);
  expect(title.match(/Excalicast/gi)).toHaveLength(1);
  const description = await page.locator('meta[name="description"]').getAttribute('content');
  expect(description).toContain('no sign-up');
  expect(description?.length).toBeLessThanOrEqual(160);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('visual explanations');
  await expect(page.locator('.craft-hero-body')).toBeVisible();
  await expect(page.getByText('Free to start · No sign-up · No download')).toBeVisible();
  await expect(page.getByRole('link', { name: 'See how it works' })).toHaveAttribute(
    'href',
    '/en/whiteboard-recorder',
  );
});

test('organic acquisition events form a content-to-recording funnel', () => {
  for (const event of [
    'organic_landing_view',
    'content_page_view',
    'comparison_view',
    'comparison_cta_click',
    'recording_setup_open',
    'recording_source_selected',
  ]) {
    expect(KNOWN_EVENT_SET.has(event)).toBe(true);
  }

  expect(FUNNEL_STEPS).toEqual([
    'organic_landing_view',
    'content_cta_click',
    'recording_setup_open',
    'recording_source_selected',
    'recording_start',
    'recording_complete',
    'export_success',
  ]);
});
