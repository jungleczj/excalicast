import { expect, test } from '@playwright/test';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { BLOG_ENTRIES, COMPARE_ENTRIES, USE_CASE_ENTRIES } from '@/content';
import { organizationSchema, softwareApplicationSchema } from '@/lib/seo/schema';
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
