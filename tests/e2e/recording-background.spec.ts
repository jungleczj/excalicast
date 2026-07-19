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
  await page.getByRole('button', { name: /开始录制/ }).first().click();
  await expect(page.getByText('视频背景').first()).toBeVisible();
  for (const label of ['纸感蓝', '柔和绿', '暖黄纸', '淡紫便笺', '深色纸面', '糖果流光', '柔粉花园', '粉彩薄雾', '极光雪原', '晨色山脊', '叶影纸面', '霓虹暮色']) {
    await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  }
  await page.getByRole('button', { name: /纸感蓝/ }).click();
  await expect(page.getByRole('button', { name: /纸感蓝/ })).toHaveAttribute('aria-pressed', 'true');
});
