import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for the screen-record pipeline (P1).
 *
 * Browser screen-capture APIs don't work in headless Chromium out of the box
 * (no displayed surface to capture). We stub `navigator.mediaDevices.getDisplayMedia`
 * with a canvas captureStream so the rest of the pipeline — liveComposite,
 * MediaRecorder, IndexedDB writes, navigation, download button enablement —
 * exercises with a real (synthetic) video stream.
 *
 * For mic/camera (getUserMedia), Chromium's `--use-fake-device-for-media-stream`
 * flag returns a synthetic video + silent audio without any user prompt.
 */

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',         // auto-grant getUserMedia
      '--use-fake-device-for-media-stream',     // synthetic video + silent audio
      // Helps if running in a real X session (no-op in pure headless):
      '--enable-usermedia-screen-capturing',
      '--auto-accept-this-tab-capture',
    ],
  },
});

/**
 * Install a stub for getDisplayMedia BEFORE any page script runs.
 * Returns a 1280×720 canvas stream that paints a moving color band.
 */
async function stubGetDisplayMedia(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    setInterval(() => {
      ctx.fillStyle = `hsl(${(frame * 4) % 360}, 70%, 50%)`;
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = 'white';
      ctx.font = '48px sans-serif';
      ctx.fillText(`E2E frame ${frame}`, 40, 120);
      frame++;
    }, 33);  // ~30fps
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = (canvas as any).captureStream(30) as MediaStream;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator.mediaDevices as any).getDisplayMedia = async () => stream;
  });
}

test.describe('Screen recording — happy path', () => {
  test('start → modal → record ~3s → stop → process page → download enabled', async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    // Collect any unhandled console errors + alert dialogs for diagnostics
    const consoleErrors: string[] = [];
    const alerts: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('dialog', async (d) => {
      alerts.push(`${d.type()}: ${d.message()}`);
      if (d.type() === 'confirm') await d.accept();
      else await d.dismiss();
    });

    await stubGetDisplayMedia(page);

    await page.goto('/zh/app', { waitUntil: 'domcontentloaded' });

    // The "开始录制" button on the workspace
    const startBtn = page.getByRole('button', { name: /开始录制/ }).first();
    await expect(startBtn).toBeVisible({ timeout: 10_000 });
    await startBtn.click();

    // Setup modal: header
    await expect(page.getByRole('heading', { name: '开始录制' })).toBeVisible();

    // Defaults: mic on, sysAudio off, camera off — just confirm.
    await page.getByRole('button', { name: '选择录制源' }).click();

    // After choosing source: the floating ScreenRecordingBar shows. The Stop
    // button has aria-label="停止".
    const stopBtn = page.getByLabel('停止', { exact: true });
    try {
      await expect(stopBtn).toBeVisible({ timeout: 10_000 });
    } catch (err) {
      // Diagnostics: surface any alert / console errors that explain why
      // startScreenRecording failed.
      throw new Error(
        `Stop button never appeared.\nAlerts: ${JSON.stringify(alerts)}\n` +
          `Console errors: ${consoleErrors.slice(-10).join('\n')}`,
      );
    }

    // Let MediaRecorder accumulate ~3 chunks (~3 seconds at 1s chunk interval)
    await page.waitForTimeout(3_000);

    // Stop recording
    await stopBtn.click();

    // Process page reached
    await expect(page).toHaveURL(/\/zh\/process\/[a-f0-9-]+$/, { timeout: 15_000 });

    // <video> element rendered with a non-empty src (Blob URL)
    const video = page.locator('video');
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('src', /^blob:/);

    // CRITICAL REGRESSION CHECK — the previous failure mode was MediaRecorder
    // emitting empty chunks while everything LOOKED fine. Verify the actual
    // bytes in IndexedDB are non-zero.
    const chunkStats = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Dexie = (await import('https://cdn.jsdelivr.net/npm/dexie@4/+esm' as any)).default;
      const db = new Dexie('excalicast');
      await db.open();
      const rows = await db.table('screenChunks').toArray();
      const totalBytes = rows.reduce((s: number, r: { blob: Blob }) => s + r.blob.size, 0);
      await db.close();
      return { count: rows.length, totalBytes };
    });
    expect(chunkStats.count, `expected at least 1 chunk in IndexedDB but got ${chunkStats.count}`).toBeGreaterThan(0);
    expect(chunkStats.totalBytes, `expected non-zero recorded bytes; chunks=${chunkStats.count}`).toBeGreaterThan(0);

    // Format picker present (use unique sub-text to disambiguate from the
    // "下载 MP4" download button)
    await expect(page.getByRole('button', { name: /MP4.*最广兼容/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /MOV.*Mac/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /WebM.*体积/ })).toBeVisible();

    // Download button is enabled — we don't actually trigger download here
    // (would require ffmpeg.wasm to complete which is slow in CI). Just check
    // the button is rendered and clickable.
    const dlBtn = page.getByRole('button', { name: /下载 MP4/ });
    await expect(dlBtn).toBeVisible();
    await expect(dlBtn).toBeEnabled();

    // Filter console for noise that's not real (Excalidraw / ffmpeg load warnings) —
    // surface only "Failed to" / TypeError style messages.
    const fatal = consoleErrors.filter((e) =>
      /TypeError|ReferenceError|Failed to fetch|Cannot read/i.test(e)
      && !/ffmpeg/i.test(e),  // ffmpeg.wasm sometimes logs noise during load
    );
    expect(fatal, `unexpected fatal errors:\n${fatal.join('\n')}`).toHaveLength(0);

    // For diagnostics on failure, attach console output
    await testInfo.attach('console-errors.txt', {
      body: consoleErrors.join('\n'),
      contentType: 'text/plain',
    });
  });

  test('discard button removes the recording', async ({ page }) => {
    test.setTimeout(45_000);
    await stubGetDisplayMedia(page);
    // Auto-handle dialogs: confirm prompts get accepted (so 丢弃 proceeds),
    // alert dialogs get dismissed (mic-denied warnings etc.).
    page.on('dialog', (d) => {
      if (d.type() === 'confirm') void d.accept();
      else void d.dismiss();
    });
    await page.goto('/zh/app', { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: /开始录制/ }).first().click();
    await page.getByRole('button', { name: '选择录制源' }).click();

    // Wait for recording bar
    const stopBtn = page.getByLabel('停止', { exact: true });
    await expect(stopBtn).toBeVisible({ timeout: 10_000 });

    // Discard button (Trash icon, aria-label=丢弃)
    await page.getByLabel('丢弃', { exact: true }).click();

    // Should stay on /app (NOT navigate to /process). Allow up to 10s because
    // handle.stop() polls the chunk DB for up to 5s before completing.
    await expect(page).toHaveURL(/\/zh\/app$/, { timeout: 15_000 });

    // The 开始录制 button is back (same polling slack as above)
    await expect(page.getByRole('button', { name: /开始录制/ }).first())
      .toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Screen recording — setup modal', () => {
  test('modal closes on Cancel without starting any capture', async ({ page }) => {
    await stubGetDisplayMedia(page);

    // Track if getDisplayMedia was called
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__gdmCalled = false;
      const orig = navigator.mediaDevices.getDisplayMedia;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator.mediaDevices as any).getDisplayMedia = async (c: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__gdmCalled = true;
        return orig.call(navigator.mediaDevices, c as DisplayMediaStreamOptions);
      };
    });

    await page.goto('/zh/app', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /开始录制/ }).first().click();
    await expect(page.getByRole('heading', { name: '开始录制' })).toBeVisible();

    // Click 取消
    await page.getByRole('button', { name: '取消' }).click();

    await expect(page.getByRole('heading', { name: '开始录制' })).not.toBeVisible();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const called = await page.evaluate(() => (window as any).__gdmCalled);
    expect(called).toBe(false);
  });

  test('toggle camera + sysAudio reflects in selected state', async ({ page }) => {
    await stubGetDisplayMedia(page);
    await page.goto('/zh/app', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /开始录制/ }).first().click();
    await expect(page.getByRole('heading', { name: '开始录制' })).toBeVisible();

    // The three toggle rows in the modal: 麦克风 / 系统音频 / 摄像头气泡
    // Default: 麦克风 on, others off.
    // Selected style adds border-primary-600 bg-primary-50.
    const micBtn = page.getByText('麦克风').locator('..').locator('..');
    const sysBtn = page.getByText('系统音频').locator('..').locator('..');
    const camBtn = page.getByText('摄像头气泡').locator('..').locator('..');

    await expect(micBtn).toHaveClass(/border-primary-600/);
    await expect(sysBtn).not.toHaveClass(/border-primary-600/);
    await expect(camBtn).not.toHaveClass(/border-primary-600/);

    await camBtn.click();
    await expect(camBtn).toHaveClass(/border-primary-600/);

    await sysBtn.click();
    await expect(sysBtn).toHaveClass(/border-primary-600/);

    await micBtn.click();
    await expect(micBtn).not.toHaveClass(/border-primary-600/);
  });
});
