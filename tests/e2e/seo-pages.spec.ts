import { expect, test } from '@playwright/test';

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

test('home page links to the strategic content cluster', async ({ page }) => {
  await page.goto('/zh');

  await expect(
    page.locator('a[href$="/use-cases/record-edit-publish-whiteboard-video"]'),
  ).toBeVisible();
  await expect(
    page.locator('a[href$="/compare/excalicast-vs-excalicord"]'),
  ).toBeVisible();
  await expect(
    page.locator('a[href$="/compare/excalicast-vs-excalidraw"]'),
  ).toBeVisible();
  await expect(
    page.locator('a[href$="/blog/one-recording-every-aspect-ratio"]'),
  ).toBeVisible();
});
