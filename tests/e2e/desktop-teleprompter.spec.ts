import { expect, test } from '@playwright/test';

test.use({ locale: 'zh-CN' });

test('notch teleprompter mirrors web read-along progress without opening another microphone', async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      schemaVersion: 1,
      visible: true,
      script: '第一步，打开课程。第二步，讲解重点。',
      language: 'zh',
      mode: 'smart-readalong',
      dock: 'notch',
      microphoneSource: 'recording-session-pcm',
      fallback: 'constant-speed',
      excludeFromCapture: true,
      speed: 4,
      fontSize: 30,
      opacity: 0.92,
      currentWord: 1,
      recognitionStatus: 'listening',
      heard: '打开课程',
    };
    let microphoneRequests = 0;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          microphoneRequests += 1;
          return new MediaStream();
        },
      },
    });
    Object.defineProperty(window, '__teleprompterMicRequests', {
      get: () => microphoneRequests,
    });
    Object.defineProperty(window, 'excalicastDesktop', {
      configurable: true,
      value: {
        invoke: async () => state,
        subscribe: (_channel: string, listener: (payload: unknown) => void) => {
          queueMicrotask(() => listener(state));
          return () => undefined;
        },
      },
    });
  });

  await page.goto('/zh/notch');
  // Chinese scripts are segmented into individual word spans, so assert the
  // combined reader text instead of coupling the test to a specific segmenter.
  await expect(page.locator('.teleprompter-craft-dock')).toContainText('打开课程', { timeout: 15_000 });
  await expect(page.getByLabel('监听中')).toBeVisible();
  await page.getByRole('button', { name: '智能跟读' }).click();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as unknown as { __teleprompterMicRequests: number }).__teleprompterMicRequests)).toBe(0);
});
