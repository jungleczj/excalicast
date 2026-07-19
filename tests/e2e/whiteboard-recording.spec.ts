import { expect, test } from '@playwright/test';

const baseOrigin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3002').origin;

test.use({
  locale: 'zh-CN',
  extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
});

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'zh', url: baseOrigin, sameSite: 'Lax' }]);
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
});

test('starting a whiteboard recording immediately stores the existing drawing', async ({ page }) => {
  await page.goto('/app');
  await page.locator('.excalidraw').waitFor();

  const rectangleTool = page.getByTestId('toolbar-rectangle');
  await expect(rectangleTool).toBeVisible();
  // Excalidraw 的可视工具图标覆盖 radio input，浏览器使用时点的是同一个工具按钮。
  await rectangleTool.click({ force: true });
  await page.mouse.move(260, 250);
  await page.mouse.down();
  await page.mouse.move(520, 390, { steps: 8 });
  await page.mouse.up();

  await page.getByRole('button', { name: /开始录制/ }).first().click();
  await page.getByRole('button', { name: /开始（3 秒倒计时）/ }).click();
  await page.getByRole('button', { name: /^开始录制$/ }).click();

  await expect(page.getByText('暂停', { exact: true })).toBeVisible({ timeout: 9_000 });
  const elementCount = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction(['recordings', 'snapshots'], 'readonly');
    const recordings = await new Promise<Array<{ id: string; startedAt: number }>>((resolve, reject) => {
      const request = tx.objectStore('recordings').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as Array<{ id: string; startedAt: number }>);
    });
    const latest = recordings.sort((a, b) => b.startedAt - a.startedAt)[0];
    if (!latest) return 0;
    const snapshots = await new Promise<Array<{ recordingId: string; elements: unknown[] }>>((resolve, reject) => {
      const request = tx.objectStore('snapshots').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as Array<{ recordingId: string; elements: unknown[] }>);
    });
    return snapshots.find((snapshot) => snapshot.recordingId === latest.id)?.elements.length ?? 0;
  });
  expect(elementCount).toBeGreaterThan(0);

  // 真实停止并进入编辑器：断言导出预览 canvas 里存在黑色画笔像素，
  // 证明已有白板元素不只是写入 IndexedDB，而是确实被渲染出来。
  // 浮动录制条会持续有轻微的 Craft 入场动效，按钮本身始终可点。
  await page.getByRole('button', { name: '停止', exact: true }).click({ force: true });
  await page.waitForURL(/\/zh\/export\//, { timeout: 12_000 });
  const previewCanvas = page.getByTestId('export-preview-stage').locator('canvas');
  await expect(previewCanvas).toBeVisible();
  await expect.poll(() => previewCanvas.evaluate((canvas) => {
    const c = canvas as HTMLCanvasElement;
    if (c.width === 0 || c.height === 0) return 0;
    const pixels = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
    if (!pixels) return 0;
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 80 && pixels[i + 1] < 80 && pixels[i + 2] < 80 && pixels[i + 3] > 0) dark += 1;
    }
    return dark;
  }), { timeout: 12_000 }).toBeGreaterThan(100);
});
