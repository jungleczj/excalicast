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

test('stop navigates to the finalizing editor before delayed media recorders finish', async ({ page }) => {
  await page.addInitScript(() => {
    class DelayedMediaRecorder extends EventTarget {
      static isTypeSupported() { return true; }
      state: RecordingState = 'inactive';
      mimeType = 'audio/webm;codecs=opus';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      start() { this.state = 'recording'; }
      requestData() {}
      pause() { this.state = 'paused'; }
      resume() { this.state = 'recording'; }
      stop() {
        window.setTimeout(() => {
          this.state = 'inactive';
          this.dispatchEvent(new Event('stop'));
        }, 2_500);
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: DelayedMediaRecorder });
  });

  // Keep dev-server route compilation outside the timing assertion. Production
  // builds already contain this chunk; this test is about stop/navigation order.
  await page.request.get('/zh/export/e2e-route-warmup');
  await page.goto('/app');
  await page.locator('.excalidraw').waitFor();
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();
  await page.getByRole('button', { name: /^开始倒计时$/ }).click();
  await expect(page.getByText('暂停', { exact: true })).toBeVisible({ timeout: 9_000 });

  const recordingBar = page.getByTestId('in-page-recording-bar');
  await recordingBar.hover();
  await page.getByRole('button', { name: /停止|Stop recording/ }).evaluate((button: HTMLButtonElement) => button.click());

  await expect(page).toHaveURL(/\/zh\/export\//, { timeout: 2_000 });
  await expect(page.getByText('正在完成录制…')).toBeVisible({ timeout: 2_000 });
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

  await page.getByRole('button', { name: /新建录制/ }).first().click();
  // 选择视频背景后，仍必须导出实际白板，而不是只显示这张背景图。
  await page.getByTestId('recording-background-swatch-coral-silk').click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();
  await page.getByRole('button', { name: /^开始倒计时$/ }).click();

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
  // 白板录制条会自动收纳至右侧，悬停后在同一位置展开完整工具带。
  const recordingBar = page.getByTestId('in-page-recording-bar');
  await expect(recordingBar).toHaveAttribute('data-docked', 'true', { timeout: 4_000 });
  const dockBox = await page.getByTestId('recording-bar-side-dock').boundingBox();
  const viewport = page.viewportSize();
  const layoutViewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  if (!dockBox || !viewport) throw new Error('recording bar dock has no box');
  expect(Math.round(dockBox.x + dockBox.width)).toBeGreaterThanOrEqual(layoutViewportWidth - 2);
  expect(dockBox.y + dockBox.height).toBeGreaterThanOrEqual(viewport.height - 120);
  await recordingBar.hover();
  await expect(recordingBar).toHaveAttribute('data-docked', 'false');
  // 可见文案会随 locale 变化，但控件的可访问名称还包含英文 title。
  const stopButton = page.getByRole('button', { name: /停止|Stop recording/ });
  await stopButton.evaluate((button: HTMLButtonElement) => button.click());
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

test('whiteboard recording does not run workspace screenshots when shell capture is disabled', async ({ page }) => {
  await page.goto('/app');
  await page.locator('.excalidraw').waitFor();

  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();
  await page.getByRole('button', { name: /^开始倒计时$/ }).click();
  await expect(page.getByText('暂停', { exact: true })).toBeVisible({ timeout: 9_000 });

  // The old implementation started a 2x DOM screenshot loop for every recording,
  // even though includeWorkspaceShell defaults to false. Give that loop enough
  // time to run, then verify it stayed completely idle.
  await page.waitForTimeout(2_000);
  const shellCount = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction('workspaceShells', 'readonly');
    return await new Promise<number>((resolve, reject) => {
      const request = tx.objectStore('workspaceShells').count();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  });
  expect(shellCount).toBe(0);
});
