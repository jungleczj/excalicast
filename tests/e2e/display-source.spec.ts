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

test('selected area stays adjustable before recording and remains framed while recording', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 720;
          const stream = canvas.captureStream(30);
          const [track] = stream.getVideoTracks();
          if (track) track.getSettings = () => ({ width: 1280, height: 720, frameRate: 30 });
          return stream;
        },
        getUserMedia: async () => new MediaStream(),
      },
    });
  });

  await page.goto('/app');
  await page.getByRole('button', { name: /开始录制/ }).first().click();
  await page.getByRole('button', { name: /选定区域/ }).click();
  await page.getByRole('button', { name: /开始（3 秒倒计时）/ }).click();

  const frame = page.getByTestId('display-source-crop-frame');
  await expect(frame).toBeVisible();
  const before = await frame.getAttribute('data-crop');
  const box = await frame.boundingBox();
  if (!box) throw new Error('selection frame has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2 + 20);
  await page.mouse.up();
  await expect(frame).not.toHaveAttribute('data-crop', before ?? '');

  await page.getByRole('button', { name: /^开始录制$/ }).click();
  await expect(frame).toHaveAttribute('data-interactive', 'false', { timeout: 7_000 });
});

test('desktop capture requests a detached recording controller before countdown', async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__desktopControlRequests = 0;
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: {
        requestWindow: async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__desktopControlRequests += 1;
          return window;
        },
      },
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 720;
          const stream = canvas.captureStream(30);
          const [track] = stream.getVideoTracks();
          if (track) track.getSettings = () => ({ width: 1280, height: 720, frameRate: 30 });
          return stream;
        },
        getUserMedia: async () => new MediaStream(),
      },
    });
  });

  await page.goto('/app');
  await page.getByRole('button', { name: /开始录制/ }).first().click();
  await page.getByRole('button', { name: /整个桌面/ }).click();
  await page.getByRole('button', { name: /开始（3 秒倒计时）/ }).click();
  await page.getByRole('button', { name: /^开始录制$/ }).click();

  await expect.poll(() => page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__desktopControlRequests;
  })).toBe(1);

  // 测试桩把 Document PiP host 指到当前 document，因此可直接验证脱离主录制条的控制动作。
  const pause = page.getByRole('button', { name: 'Pause recording' });
  await expect(pause).toBeEnabled({ timeout: 9_000 });
  await pause.click();
  const resume = page.getByRole('button', { name: 'Resume recording' });
  await expect(resume).toBeEnabled();
  await resume.click();
  await expect(pause).toBeEnabled();

  await page.getByRole('button', { name: 'Stop recording' }).click({ force: true });
  await page.waitForURL(/\/zh\/export\//, { timeout: 12_000 });
});
