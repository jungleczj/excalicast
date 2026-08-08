import { expect, test } from '@playwright/test';

const fixture = {
  query: {
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-31T23:59:59.999Z',
    groupBy: 'locale',
    filters: {},
  },
  capped: false,
  paymentCoverage: 'client_confirmed',
  summary: { sessions: 100, pageViews: 100, ctaClicks: 42, ctr: 42, paid: 4 },
  funnel: [
    ['page_view', 100, 100, 58, 10000],
    ['cta_click', 42, 42, 28.6, 20000],
    ['recording_start', 30, 30, 16.7, 60000],
    ['recording_complete', 25, 25, 20, 10000],
    ['export_success', 20, 20, 25, 15000],
    ['checkout_start', 15, 15, 73.3, 30000],
    ['purchase_success', 4, 4, 0, null],
  ].map(([step, users, conversionRate, dropoffRate, medianMs]) => ({
    step,
    users,
    conversionRate,
    dropoffRate,
    duration: medianMs === null ? null : { medianMs, p75Ms: Number(medianMs) * 2, p90Ms: Number(medianMs) * 3 },
  })),
  paths: [{
    steps: ['page_view', 'cta_click', 'recording_start', 'recording_complete', 'export_success'],
    sessions: 20,
    paidConversionRate: 0,
    medianJourneyMs: 95000,
  }],
  segments: [{ key: 'zh', sessions: 70, pageViews: 70, ctaClicks: 32, ctr: 45.7, paid: 3, funnel: [] }],
  dimensions: {
    locale: ['en', 'zh'],
    entry_path: ['/zh'],
    source_kind: ['desktop', 'whiteboard'],
    content_type: ['compare'],
    campaign: ['launch'],
  },
  byEvent: [],
  daily: [],
};

test('admin conversion dashboard exposes filters, funnel quality metrics and aggregate paths', async ({ page }) => {
  await page.route('**/api/admin/analytics?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
  });

  await page.goto('/en/admin/analytics');
  await page.getByPlaceholder('ADMIN_SECRET').fill('test-secret');
  await page.getByRole('button', { name: 'Enter' }).click();

  await expect(page.getByRole('heading', { name: 'Conversion analytics' })).toBeVisible();
  await expect(page.getByLabel('From')).toBeVisible();
  await expect(page.getByLabel('To')).toBeVisible();
  await expect(page.getByLabel('Group by')).toBeVisible();
  await expect(page.getByLabel('Locale')).toBeVisible();
  await expect(page.getByTestId('metric-ctr')).toContainText('42.0%');
  await expect(page.getByRole('row', { name: /Page view 100/ })).toContainText('58.0%');
  await expect(page.getByRole('heading', { name: 'Aggregate behavior paths' })).toBeVisible();
  await expect(page.getByText('Client-confirmed payments')).toBeVisible();
});

test('admin conversion dashboard renders a useful empty state', async ({ page }) => {
  await page.route('**/api/admin/analytics?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...fixture,
        summary: { sessions: 0, pageViews: 0, ctaClicks: 0, ctr: 0, paid: 0 },
        funnel: fixture.funnel.map((step) => ({ ...step, users: 0 })),
        paths: [],
        segments: [],
      }),
    });
  });

  await page.goto('/en/admin/analytics');
  await page.getByPlaceholder('ADMIN_SECRET').fill('test-secret');
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByRole('status')).toContainText('No conversion data');
});

test('admin analytics API rejects missing and incorrect administrator credentials', async ({ request }) => {
  const missing = await request.get('/api/admin/analytics');
  const incorrect = await request.get('/api/admin/analytics', { headers: { 'x-admin-secret': 'incorrect' } });

  expect(missing.status()).toBe(403);
  expect(incorrect.status()).toBe(403);
});

test('page navigation records an aggregate page view and leave observation', async ({ page }) => {
  const events: string[] = [];
  await page.route('**/api/analytics', async (route) => {
    const body = route.request().postDataJSON() as { event?: string };
    if (body.event) events.push(body.event);
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/en');
  await expect.poll(() => events.filter((event) => event === 'page_view').length).toBeGreaterThanOrEqual(1);
  await page.goto('/en/pricing');

  await expect.poll(() => events.includes('journey_leave')).toBe(true);
  await expect.poll(() => events.filter((event) => event === 'page_view').length).toBeGreaterThanOrEqual(2);
});
