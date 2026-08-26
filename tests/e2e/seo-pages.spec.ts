import { expect, test } from '@playwright/test';

test('root resolves to the English market without an HTTP hreflang header', async ({ page }) => {
  const response = await page.goto('/');

  await expect(page).toHaveURL(/\/en$/);
  expect(response?.headers().link).toBeUndefined();
});

test('pricing markdown exposes the same public pricing categories', async ({ request }) => {
  const response = await request.get('/pricing.md');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/markdown');
  const body = await response.text();
  expect(body).toContain('# Excalicast pricing');
  expect(body).toContain('Free');
  expect(body).toContain('One-time export');
  expect(body).toContain('Pro');
  expect(body).toContain('Max');
});

test('private app pages emit noindex metadata', async ({ page }) => {
  await page.goto('/en/app');

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/,
  );
});

test('Excalicord comparison is bilingual, canonical, sourced, and conversion-ready', async ({
  page,
}) => {
  for (const locale of ['en', 'zh']) {
    const path = `/${locale}/compare/excalicast-vs-excalicord`;
    await page.goto(path);

    await expect(page.locator('h1')).toContainText('Excalicast');
    await expect(page.locator('.content-craft-direct-answer')).toBeVisible();
    await expect(page.locator('a[href="https://www.excalicord.com/"]')).toBeVisible();
    await expect(page.locator('a[href$="/app?source=whiteboard"]').last()).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `https://excalicast.cc${path}`,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      'href',
      'https://excalicast.cc/en/compare/excalicast-vs-excalicord',
    );
    await expect(page.locator('link[rel="alternate"][hreflang="zh-CN"]')).toHaveAttribute(
      'href',
      'https://excalicast.cc/zh/compare/excalicast-vs-excalicord',
    );
    const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
    const parsed = schemas.flatMap((schema) => {
      const value = JSON.parse(schema) as { '@type'?: string } | Array<{ '@type'?: string }>;
      return Array.isArray(value) ? value : [value];
    });
    expect(parsed.some((schema) => schema['@type'] === 'FAQPage')).toBe(true);
    expect(parsed.some((schema) => schema['@type'] === 'BreadcrumbList')).toBe(true);
  }
});

test('pillar page exposes the complete publish-ready workflow', async ({ page }) => {
  await page.goto('/zh/use-cases/record-edit-publish-whiteboard-video');

  await expect(page.locator('h1')).toContainText('白板视频');
  await expect(page.locator('.content-craft-direct-answer')).toContainText('发布就绪');
  await expect(page.locator('.content-craft-step')).toHaveCount(10);
  await expect(page.locator('a[href$="/app?source=whiteboard"]').last()).toContainText(
    '端到端',
  );
  await expect(page.getByText('不会直接发布到第三方社交账号').first()).toBeVisible();
});

test('content CTA preserves attribution and preselects its recording source', async ({ page }) => {
  const analytics: Array<Record<string, unknown>> = [];
  await page.route('**/api/analytics', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    analytics.push(body);
    await route.fulfill({ status: 204 });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('excalicast.seenAppIntro', '1');
  });

  await page.goto('/zh/use-cases/record-edit-publish-whiteboard-video');
  await page.locator('a[href$="/app?source=whiteboard"]').last().click();
  await expect(page).toHaveURL(/\/zh\/app\?source=whiteboard$/);
  await expect.poll(() => analytics.some((item) => item.event === 'content_cta_click')).toBe(true);

  const click = analytics.find((item) => item.event === 'content_cta_click');
  expect(click?.locale).toBe('zh-CN');
  expect(click?.props).toMatchObject({
    entry_path: '/zh/use-cases/record-edit-publish-whiteboard-video',
    content_type: 'use-case',
    slug: 'record-edit-publish-whiteboard-video',
  });

  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await expect(page.getByRole('button', { name: /白板/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('signup keeps landing attribution including UTM content and term', async ({ page }) => {
  const analytics: Array<Record<string, unknown>> = [];
  await page.route('**/api/analytics', async (route) => {
    analytics.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 204 });
  });

  await page.goto('/en?utm_source=alternativeto&utm_medium=directory&utm_campaign=launch&utm_content=profile&utm_term=whiteboard+recorder&auth_event=signup');
  await expect.poll(() => analytics.some((item) => item.event === 'signup')).toBe(true);
  const signup = analytics.find((item) => item.event === 'signup');
  expect(signup?.props).toMatchObject({
    entry_path: '/en',
    utm_source: 'alternativeto',
    utm_content: 'profile',
    utm_term: 'whiteboard recorder',
  });
});

test('home page links to the strategic content cluster', async ({ page }) => {
  await page.goto('/en');

  for (const path of [
    '/excalidraw-recorder',
    '/whiteboard-recorder',
    '/event-based-recording',
    '/about',
  ]) {
    await expect(page.locator(`a[href$="${path}"]`).first()).toBeVisible();
  }
});

test('about page disambiguates the product and emits AboutPage schema', async ({ page }) => {
  await page.goto('/en/about');

  await expect(page.locator('h1')).toContainText('Excalicast');
  await expect(page.getByText('excalicast.cc', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('podcast', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('iOS app', { exact: false }).first()).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://excalicast.cc/en/about',
  );

  const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
  const types = schemas.flatMap((value) => {
    const parsed = JSON.parse(value) as Record<string, unknown> | Array<Record<string, unknown>>;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.flatMap((item) => {
      const graph = item['@graph'];
      return Array.isArray(graph)
        ? graph.map((node) => (node as Record<string, unknown>)['@type'])
        : [item['@type']];
    });
  });
  expect(types).toContain('AboutPage');
  expect(types).toContain('Organization');
  expect(types).toContain('SoftwareApplication');
});

test('three category pillars are answer-first, sourced and interconnected', async ({ page }) => {
  const paths = [
    '/excalidraw-recorder',
    '/whiteboard-recorder',
    '/event-based-recording',
  ];

  for (const path of paths) {
    await page.goto(`/en${path}`);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.content-craft-direct-answer')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'References' })).toBeVisible();
    await expect(page.locator('a[href$="/app?source=whiteboard"]').last()).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `https://excalicast.cc/en${path}`,
    );
    for (const related of paths.filter((item) => item !== path)) {
      await expect(page.locator(`a[href$="${related}"]`).first()).toBeVisible();
    }
  }
});
