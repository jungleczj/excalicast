import { expect, test } from '@playwright/test';

test.use({ locale: 'zh-CN' });

test('web navigation exposes the stable macOS installer download endpoint', async ({ page }) => {
  await page.goto('/zh');
  const download = page.getByRole('link', { name: '下载 Mac 版' }).first();
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', '/api/desktop/download?platform=mac');
});

test('landing mobile menu keeps the macOS installer reachable by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh');

  const menu = page.locator('details.craft-mobile-menu');
  await menu.locator('summary').focus();
  await page.keyboard.press('Enter');

  const download = menu.getByRole('link', { name: '下载 Mac 版' });
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', '/api/desktop/download?platform=mac');
});

test('app mobile header exposes the macOS installer without overflowing the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh/library');

  const menuButton = page.getByRole('button', { name: '打开导航菜单' });
  await expect(menuButton).toBeVisible();
  await menuButton.click();

  const download = page.getByRole('link', { name: '下载 Mac 版' });
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', '/api/desktop/download?platform=mac');
  await expect(download).toBeInViewport();
});
