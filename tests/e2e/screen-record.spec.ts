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
    // Auto-dismiss any lingering alert dialogs (warning messages) that might
    // pop unexpectedly and block the modal interaction.
    page.on('dialog', (d) => void d.dismiss());
    await page.goto('/zh/app', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /开始录制/ }).first().click();
    await expect(page.getByRole('heading', { name: '开始录制' })).toBeVisible({ timeout: 10_000 });

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

test.describe('Screen recording — dual-stream architecture (v2)', () => {
  test('with camera: bubbleSource is overlay (browser surface), camera.webm separately recorded', async ({ page }) => {
    test.setTimeout(60_000);

    // Stub getDisplayMedia returning displaySurface=browser (camera path: PiP →
    // bubbleSource='overlay', camera.webm recorded for ffmpeg-overlay at export)
    await page.addInitScript(() => {
      // Fake screen stream from canvas + report displaySurface=browser
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      let f = 0;
      setInterval(() => {
        ctx.fillStyle = `hsl(${(f * 4) % 360}, 70%, 50%)`;
        ctx.fillRect(0, 0, 1280, 720);
        f++;
      }, 33);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = (canvas as any).captureStream(30) as MediaStream;
      const track = stream.getVideoTracks()[0];
      // Override getSettings to report browser surface
      const origGetSettings = track.getSettings.bind(track);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (track as any).getSettings = () => ({ ...origGetSettings(), displaySurface: 'browser' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator.mediaDevices as any).getDisplayMedia = async () => stream;

      // Stub requestPictureInPicture to succeed (we don't actually need a real
      // PiP window in headless Chromium — we just need handle.previewActive=true
      // so the bubbleSource heuristic picks 'overlay' as expected for 'browser'.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (HTMLVideoElement.prototype as any).requestPictureInPicture = async function () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return {} as any;
      };
    });

    // Dismiss any alerts
    page.on('dialog', async (d) => {
      if (d.type() === 'confirm') await d.accept();
      else await d.dismiss();
    });

    await page.goto('/zh/app', { waitUntil: 'domcontentloaded' });

    // Open modal + toggle camera on
    await page.getByRole('button', { name: /开始录制/ }).first().click();
    await expect(page.getByRole('heading', { name: '开始录制' })).toBeVisible({ timeout: 10_000 });
    await page.getByText('摄像头气泡').locator('..').locator('..').click();
    await page.getByRole('button', { name: '选择录制源' }).click();

    // Wait for recording bar
    await expect(page.getByLabel('停止', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3_000);
    await page.getByLabel('停止', { exact: true }).click();

    await expect(page).toHaveURL(/\/zh\/process\/[a-f0-9-]+$/, { timeout: 15_000 });

    // Verify BOTH chunk tables have data + metadata has bubbleSource='overlay'
    const stats = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Dexie = (await import('https://cdn.jsdelivr.net/npm/dexie@4/+esm' as any)).default;
      const db = new Dexie('excalicast');
      await db.open();
      const screenChunks = await db.table('screenChunks').toArray();
      const camChunks = await db.table('screenCameraChunks').toArray();
      const recordings = await db.table('screenRecordings').toArray();
      await db.close();
      const screenBytes = screenChunks.reduce((s: number, r: { blob: Blob }) => s + r.blob.size, 0);
      const camBytes = camChunks.reduce((s: number, r: { blob: Blob }) => s + r.blob.size, 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = recordings[0] as any;
      return {
        screenCount: screenChunks.length,
        screenBytes,
        camCount: camChunks.length,
        camBytes,
        bubbleSource: meta?.bubbleSource,
        displaySurface: meta?.displaySurface,
        hasCamera: meta?.hasCamera,
      };
    });

    // Screen track has bytes
    expect(stats.screenCount, 'expected screen chunks').toBeGreaterThan(0);
    expect(stats.screenBytes, 'expected screen bytes > 0').toBeGreaterThan(0);

    // bubbleSource should be 'overlay' because displaySurface='browser' + PiP active
    expect(stats.bubbleSource).toBe('overlay');
    expect(stats.displaySurface).toBe('browser');
    expect(stats.hasCamera).toBe(true);

    // Camera chunks should have data (separate recorder is active for 'overlay')
    expect(stats.camCount, 'expected camera chunks for overlay mode').toBeGreaterThan(0);
    expect(stats.camBytes, 'expected camera bytes > 0').toBeGreaterThan(0);

    // Process page should show position picker (4 anchor buttons) because
    // bubbleSource === 'overlay'
    await expect(page.getByRole('button', { name: '左上', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '右上', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '左下', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '右下', exact: true })).toBeVisible();
  });

  test('with camera + monitor surface: bubbleSource is in_screen (PiP baked into screen.webm)', async ({ page }) => {
    test.setTimeout(60_000);

    // Stub getDisplayMedia returning displaySurface=monitor
    await page.addInitScript(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      let f = 0;
      setInterval(() => {
        ctx.fillStyle = `hsl(${(f * 4) % 360}, 70%, 50%)`;
        ctx.fillRect(0, 0, 1920, 1080);
        f++;
      }, 33);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = (canvas as any).captureStream(30) as MediaStream;
      const track = stream.getVideoTracks()[0];
      const origGetSettings = track.getSettings.bind(track);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (track as any).getSettings = () => ({ ...origGetSettings(), displaySurface: 'monitor' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator.mediaDevices as any).getDisplayMedia = async () => stream;

      // PiP succeeds → monitor + PiP → bubbleSource='in_screen'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (HTMLVideoElement.prototype as any).requestPictureInPicture = async function () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return {} as any;
      };
    });

    page.on('dialog', async (d) => {
      if (d.type() === 'confirm') await d.accept();
      else await d.dismiss();
    });

    await page.goto('/zh/app', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /开始录制/ }).first().click();
    await expect(page.getByRole('heading', { name: '开始录制' })).toBeVisible({ timeout: 10_000 });
    await page.getByText('摄像头气泡').locator('..').locator('..').click();
    await page.getByRole('button', { name: '选择录制源' }).click();

    await expect(page.getByLabel('停止', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3_000);
    await page.getByLabel('停止', { exact: true }).click();

    await expect(page).toHaveURL(/\/zh\/process\/[a-f0-9-]+$/, { timeout: 15_000 });

    const stats = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Dexie = (await import('https://cdn.jsdelivr.net/npm/dexie@4/+esm' as any)).default;
      const db = new Dexie('excalicast');
      await db.open();
      const camChunks = await db.table('screenCameraChunks').toArray();
      const recordings = await db.table('screenRecordings').toArray();
      await db.close();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = recordings[recordings.length - 1] as any;
      return {
        camCount: camChunks.length,
        bubbleSource: meta?.bubbleSource,
        displaySurface: meta?.displaySurface,
      };
    });

    expect(stats.displaySurface).toBe('monitor');
    expect(stats.bubbleSource).toBe('in_screen');
    // In 'in_screen' mode we don't run a separate camera recorder
    // (bubbleSource decided before MediaRecorder creation)
    expect(stats.camCount, 'no camera recorder in in_screen mode').toBe(0);

    // Process page should show the "monitor recording" warning instead of position picker
    await expect(page.getByText(/「整个屏幕」录制下/)).toBeVisible();
    await expect(page.getByRole('button', { name: '左上', exact: true })).not.toBeVisible();
  });
});
