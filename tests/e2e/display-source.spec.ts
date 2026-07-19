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

test('recording setup can choose display capture sources', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: /开始录制/ }).first().click();
  await expect(page.getByText('录制来源')).toBeVisible();
  await page.getByRole('button', { name: /窗口/ }).click();
  await expect(page.getByRole('button', { name: /窗口/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/浏览器仍会显示系统选择器/)).toBeVisible();
});

test('display capture does not request fixed 1080p dimensions', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: async (options: unknown) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__lastDisplayOptions = options;
          const canvas = document.createElement('canvas');
          canvas.width = 1366;
          canvas.height = 768;
          const stream = canvas.captureStream(60);
          const [track] = stream.getVideoTracks();
          if (track) {
            track.getSettings = () => ({ width: 1366, height: 768, frameRate: 60 });
          }
          return stream;
        },
        getUserMedia: async () => new MediaStream(),
      },
    });
  });

  await page.goto('/app');
  await page.getByRole('button', { name: /开始录制/ }).first().click();
  await page.getByRole('button', { name: /窗口/ }).click();
  await page.getByRole('button', { name: /开始（3 秒倒计时）/ }).click();

  const options = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__lastDisplayOptions as {
      video?: { width?: unknown; height?: unknown; resizeMode?: unknown; frameRate?: unknown };
    };
  });
  expect(options.video?.width).toBeUndefined();
  expect(options.video?.height).toBeUndefined();
  expect(options.video?.resizeMode).toBe('none');
  expect(options.video?.frameRate).toEqual({ ideal: 60, max: 60 });
});
