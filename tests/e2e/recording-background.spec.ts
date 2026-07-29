import { expect, test } from '@playwright/test';

const baseOrigin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3002').origin;

test.use({
  locale: 'zh-CN',
  extraHTTPHeaders: {
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  },
});

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([
    {
      name: 'NEXT_LOCALE',
      value: 'zh',
      url: baseOrigin,
      sameSite: 'Lax',
    },
  ]);
  await page.addInitScript(() => {
    window.localStorage.setItem('excalicast.seenAppIntro', '1');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: async () => new MediaStream(),
        getUserMedia: async () => new MediaStream(),
      },
    });
  });
});

test('recording setup can select a video background', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await expect(page.getByText('视频背景').first()).toBeVisible();
  for (const label of [
    '蓝晒植物',
    '地中海窗影',
    '雾岭晨曦',
    '月光水纹',
    '赤陶拱廊',
    '极地柔光',
    '沙丘暮色',
    '星图浮雕',
    '矿物薄雾',
    '和纸远山',
    '浅海日光',
    '潮汐细鳞',
    '细密花织',
  ]) {
    await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  }
  await page.getByRole('button', { name: /自定义颜色/ }).click();
  await expect(page.getByRole('button', { name: /自定义颜色/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /蓝晒植物/ }).click();
  await expect(page.getByRole('button', { name: /蓝晒植物/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('recording-background-preview-frame')).toHaveCSS(
    'background-image',
    /bg-01-cyanotype-garden\.png/,
  );
});
