import { expect, test } from '@playwright/test';

test('desktop ink route mounts the full transparent Excalidraw surface', async ({ page }) => {
  await page.goto('/en/desktop-ink');

  const surface = page.getByTestId('desktop-ink-surface');
  await expect(surface).toBeVisible();
  await expect(surface).toHaveCSS('background-color', 'rgba(255, 255, 255, 0)');
  await expect(page.locator('.desktop-ink-overlay .excalidraw')).toBeVisible();
  await expect(page.locator('.desktop-ink-overlay .excalidraw canvas').first()).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Board opacity' })).toHaveValue('0');
  await expect(page.getByRole('slider', { name: 'Ink opacity' })).toHaveValue('100');

  const nativeLibrarySurface = page.locator([
    '.excalidraw .sidebar-triggers',
    '.excalidraw .default-sidebar-trigger',
    '.excalidraw .sidebar-trigger',
    '.excalidraw .layer-ui__library',
  ].join(',')).first();
  await expect(nativeLibrarySurface).toBeVisible();
});

test('full-board mode paints its independent translucent background', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      excalicastDesktop: {
        async invoke() {
          return {
            engine: 'excalidraw', toolSurface: 'full', mode: 'full-board',
            backgroundOpacity: 0.45, inkOpacity: 0.72, pointerPolicy: 'draw',
            visible: true, recordingActive: false,
          };
        },
        subscribe() { return () => undefined; },
      },
    });
  });
  await page.goto('/en/desktop-ink');

  const surface = page.getByTestId('desktop-ink-surface');
  await expect(surface).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.45)');
  await expect(page.locator('.desktop-ink-overlay .excalidraw canvas').first())
    .toHaveCSS('opacity', '0.72');
});

test('desktop workspace can open the native ink overlay without changing browser behavior', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ channel: string; payload?: unknown }> = [];
    Object.assign(window, {
      __desktopInkCalls: calls,
      excalicastDesktop: {
        async invoke(channel: string, payload?: unknown) {
          calls.push({ channel, payload });
          if (channel === 'ink.get-settings.v1') {
            return {
              engine: 'excalidraw', toolSurface: 'full', mode: 'ink',
              backgroundOpacity: 0, inkOpacity: 1, pointerPolicy: 'pass-through',
              visible: false,
            };
          }
          return {
            engine: 'excalidraw', toolSurface: 'full', mode: 'full-board',
            backgroundOpacity: 0.9, inkOpacity: 1, pointerPolicy: 'draw',
            visible: true,
          };
        },
        subscribe() { return () => undefined; },
      },
    });
  });
  await page.goto('/en/app');

  const skipOnboarding = page.getByRole('button', { name: 'Skip' });
  if (await skipOnboarding.isVisible()) await skipOnboarding.click();
  const launcher = page.getByTestId('desktop-ink-launcher');
  await expect(launcher).toBeVisible();
  await launcher.click();
  const calls = await page.evaluate(() => (
    (window as unknown as { __desktopInkCalls: Array<{ channel: string }> }).__desktopInkCalls
  ));
  expect(calls).toContainEqual(expect.objectContaining({ channel: 'ink.set-mode.v1' }));
});
