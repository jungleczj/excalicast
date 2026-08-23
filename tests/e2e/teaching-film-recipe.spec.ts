import { expect, test } from '@playwright/test';

const baseOrigin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3002').origin;

test.use({
  locale: 'en-US',
  extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
});

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: baseOrigin, sameSite: 'Lax' }]);
  await page.addInitScript(() => {
    window.localStorage.setItem('excalicast.seenAppIntro', '1');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => new MediaStream(),
        getDisplayMedia: async () => new MediaStream(),
      },
    });
  });
  await page.goto('/en/app');
  await page.getByRole('button', { name: /^New recording$/ }).first().click();
});

test('teaching film recipe preselects post-production materials without blocking recording setup', async ({ page }) => {
  const entry = page.getByRole('button', { name: /Teaching film recipe/ });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('aria-expanded', 'false');
  await expect(entry).toContainText('3 selected');

  await entry.click();
  await expect(entry).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('switch', { name: 'Create film automatically' })).toBeChecked();

  const motion = page.getByRole('button', { name: /Key-point motion/ });
  const chart = page.getByRole('button', { name: /Smart charts/ });
  const sound = page.getByRole('button', { name: /Teaching sound cues/ });
  await expect(motion).toHaveAttribute('aria-pressed', 'true');
  await expect(chart).toHaveAttribute('aria-pressed', 'true');
  await expect(sound).toHaveAttribute('aria-pressed', 'true');

  await chart.click();
  await expect(chart).toHaveAttribute('aria-pressed', 'false');
  await expect(entry).toContainText('2 selected');
  await expect(page.getByRole('button', { name: /Next: frame/ })).toBeVisible();
});
