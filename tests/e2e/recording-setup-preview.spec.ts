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

test('new recording keeps a live preview in the left pane', async ({ page }) => {
  const preview = page.getByTestId('recording-background-preview');
  const frame = page.getByTestId('recording-background-preview-frame');
  await expect(preview).toBeVisible();
  await expect(page.locator('.recording-setup-preview-pane')).toBeVisible();
  await expect(page.getByTestId('recording-background-preview-whiteboard')).toBeVisible();

  await page.getByTestId('recording-background-swatch-coral-silk').click();
  await expect(frame).toHaveCSS('background-image', /coral-silk\.png/);

  await page.getByRole('radio', { name: /Use camera/ }).click();
  await expect(preview).toHaveAttribute('data-camera-enabled', 'true');

  const camera = page.getByTestId('recording-background-preview-camera');
  await expect(camera).toHaveAttribute('data-size', '160');
  await page.locator('input[type="range"]').fill('480');
  await expect(camera).toHaveAttribute('data-size', '480');

  await page.getByRole('button', { name: 'Rounded' }).click();
  await expect(camera).toHaveAttribute('data-shape', 'rounded');
  await page.getByRole('button', { name: 'top-left' }).click();
  await expect(camera).toHaveAttribute('data-position', 'top-left');
});

test('preview projection shadow stays soft over video backgrounds', async ({ page }) => {
  await page.getByTestId('recording-background-swatch-coral-silk').click();
  const surface = page.getByTestId('recording-background-preview-surface');
  await expect(surface).toBeVisible();
  await expect(surface).toHaveCSS('box-shadow', /rgba\(23, 28, 33, 0\.1\).*rgba\(23, 28, 33, 0\.05\)/);
});

test('framing start strip uses the same dark pill language as the recording bar', async ({ page }) => {
  await page.getByRole('button', { name: /Next: frame/ }).click();
  const bar = page.getByTestId('framing-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveCSS('background-color', 'rgba(18, 19, 20, 0.93)');
  await expect(bar).toHaveCSS('border-radius', '999px');
  await expect(bar.getByText('FRAMING')).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Start countdown' })).toBeVisible();
});
