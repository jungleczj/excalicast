import { expect, test } from '@playwright/test';

const baseOrigin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3002').origin;

function addChromeInset(size: string, inset: { width: number; height: number }): string {
  const [width, height] = size.split('x').map((part) => Number(part));
  return `${width + inset.width}x${height + inset.height}`;
}

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
  await page.getByRole('button', { name: /新建录制/ }).first().click();
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
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /窗口/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();

  await expect.poll(() => page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__lastDisplayOptions ?? null;
  })).not.toBeNull();
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
  expect((options as { selfBrowserSurface?: string }).selfBrowserSurface).toBe('exclude');
  expect((options as { surfaceSwitching?: string }).surfaceSwitching).toBe('exclude');
});

test('non-whiteboard sources default to their native source frame without an aspect crop overlay', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__sourceFrameAcquired = true;
          const canvas = document.createElement('canvas');
          canvas.width = 1366;
          canvas.height = 768;
          const stream = canvas.captureStream(30);
          const [track] = stream.getVideoTracks();
          if (track) track.getSettings = () => ({ width: 1366, height: 768, frameRate: 30 });
          return stream;
        },
        getUserMedia: async () => new MediaStream(),
      },
    });
  });

  await page.goto('/app');
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /窗口/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();

  await expect.poll(() => page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__sourceFrameAcquired === true;
  })).toBe(true);
  await expect(page.locator('.crop-craft-overlay')).toHaveCount(0);
});

test('window capture uses a large dedicated live framing surface instead of whiteboard coordinates', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 720;
          return canvas.captureStream(30);
        },
        getUserMedia: async () => new MediaStream(),
      },
    });
  });

  await page.goto('/app');
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /窗口/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();

  const surface = page.getByTestId('display-source-framing-surface');
  const preview = page.getByTestId('display-source-live-preview');
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute('data-source-kind', 'window');
  await expect(surface).toHaveAttribute('data-preview-mode', 'live');
  const [previewBox, viewport] = await Promise.all([
    preview.boundingBox(),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
  ]);
  if (!previewBox) throw new Error('display source framing preview was not measured');
  expect(previewBox.width).toBeGreaterThanOrEqual(viewport.width * 0.8);
  expect(previewBox.height).toBeGreaterThanOrEqual(viewport.height * 0.6);
});

test('selected area stays adjustable before recording and removes capture overlays before countdown', async ({ page }) => {
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
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /选定区域/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();

  const frame = page.getByTestId('display-source-crop-frame');
  const livePreview = page.getByTestId('display-source-live-preview');
  await expect(frame).toBeVisible();
  await expect(livePreview).toBeVisible();
  const before = await frame.getAttribute('data-crop');
  const box = await frame.boundingBox();
  if (!box) throw new Error('selection frame has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2 + 20);
  await page.mouse.up();
  await expect(frame).not.toHaveAttribute('data-crop', before ?? '');

  await page.getByRole('button', { name: /^开始倒计时$/ }).click();
  // 倒计时一开始隐藏 live preview 和选区辅助框，避免 display stream 录进递归画面/蓝色框。
  await expect(livePreview).toBeHidden();
  await expect(frame).toHaveCount(0, { timeout: 7_000 });
});

test('desktop capture preserves the camera position relative to the selected frame', async ({ page }) => {
  await page.addInitScript(() => {
    class InspectingMediaRecorder extends EventTarget {
      static isTypeSupported() { return true; }
      state: RecordingState = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(readonly stream: MediaStream, readonly options?: MediaRecorderOptions) {
        super();
      }
      start() {
        this.state = 'recording';
        const [track] = this.stream.getVideoTracks();
        const settings = track?.getSettings?.() ?? {};
        if (settings.width === 1280 && settings.height === 720) {
          (window as any).__displayRecorderCameraBubbleCountAtStart = document.querySelectorAll('[data-testid="camera-bubble"]').length;
        }
        window.setTimeout(() => this.ondataavailable?.({ data: new Blob(['chunk'], { type: this.options?.mimeType ?? 'video/webm' }) }), 20);
      }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        this.onstop?.();
        this.dispatchEvent(new Event('stop'));
      }
      pause() { if (this.state === 'recording') this.state = 'paused'; }
      resume() { if (this.state === 'paused') this.state = 'recording'; }
      requestData() {
        this.ondataavailable?.({ data: new Blob(['flush'], { type: this.options?.mimeType ?? 'video/webm' }) });
      }
    }
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: InspectingMediaRecorder,
    });
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: { requestWindow: async () => window },
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
        getUserMedia: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 320;
          return canvas.captureStream(24);
        },
      },
    });
  });

  await page.goto('/app');
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /整个桌面/ }).click();
  await page.getByRole('button', { name: /竖屏/ }).click();
  await page.getByRole('button', { name: /9:16/ }).click();
  await page.getByRole('radio', { name: /打开摄像头/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();
  const camera = page.getByTestId('camera-bubble');
  const frame = page.getByTestId('display-source-crop-frame');
  await expect(camera).toBeVisible();
  await expect(frame).toBeVisible();
  const [initialCameraBox, initialFrameBox] = await Promise.all([camera.boundingBox(), frame.boundingBox()]);
  if (!initialCameraBox || !initialFrameBox) throw new Error('camera or selected frame was not measurable');
  await page.mouse.move(initialCameraBox.x + initialCameraBox.width / 2, initialCameraBox.y + initialCameraBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(initialFrameBox.x + initialFrameBox.width / 2, initialFrameBox.y + initialFrameBox.height / 2);
  await page.mouse.up();
  const [cameraBox, frameBox] = await Promise.all([camera.boundingBox(), frame.boundingBox()]);
  if (!cameraBox || !frameBox) throw new Error('camera or selected frame was not measurable');
  const expected = {
    rx: (cameraBox.x - frameBox.x) / frameBox.width,
    ry: (cameraBox.y - frameBox.y) / frameBox.height,
    rs: cameraBox.width / Math.min(frameBox.width, frameBox.height),
  };

  await page.getByTestId('desktop-framing-controls').getByRole('button', { name: /^开始倒计时$/ }).click();
  await expect(page.getByTestId('camera-bubble')).toHaveCount(0, { timeout: 7_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__displayRecorderCameraBubbleCountAtStart), { timeout: 9_000 }).toBe(0);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Array<{ timestamp: number; rx: number; ry: number; rs: number }>>((resolve, reject) => {
      const request = db.transaction('cameraPositions', 'readonly').objectStore('cameraPositions').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.sort((a, b) => a.timestamp - b.timestamp)[0] ?? null;
  }), { timeout: 5_000 }).not.toBeNull();
  const event = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Array<{ timestamp: number; rx: number; ry: number; rs: number }>>((resolve, reject) => {
      const request = db.transaction('cameraPositions', 'readonly').objectStore('cameraPositions').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.sort((a, b) => a.timestamp - b.timestamp)[0];
  });
  expect(event.rx).toBeCloseTo(expected.rx, 2);
  expect(event.ry).toBeCloseTo(expected.ry, 2);
  expect(event.rs).toBeCloseTo(expected.rs, 2);
});

test('display recording lets the user include computer audio explicitly', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /整个桌面/ }).click();
  const computerAudio = page.getByRole('checkbox', { name: /录制电脑声音/ });
  await expect(computerAudio).toBeChecked();
  await computerAudio.uncheck();
  await expect(computerAudio).not.toBeChecked();
});

test('desktop capture requests a detached recording controller before countdown', async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__desktopControlRequests = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__desktopControlOptions = null;
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: {
        requestWindow: async (options: unknown) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__desktopControlRequests += 1;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__desktopControlOptions = options;
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
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /整个桌面/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();

  await expect.poll(() => page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__desktopControlRequests;
  })).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__desktopControlOptions;
  })).toMatchObject({
    width: 560,
    height: 64,
    disallowReturnToOpener: true,
    preferInitialWindowPlacement: true,
  });
  await expect(page.getByTestId('desktop-framing-controls')).toBeVisible();
  await expect(page.getByTestId('framing-bar').getByText('取景中')).toBeVisible();
  await expect(page.getByTestId('framing-bar-hint')).toHaveCount(0);
  const framingBar = page.getByTestId('framing-bar');
  await expect.poll(() => framingBar.evaluate((element) => ({
    display: (element as HTMLElement).style.display,
    alignItems: (element as HTMLElement).style.alignItems,
    flexWrap: (element as HTMLElement).style.flexWrap,
  }))).toEqual({
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'nowrap',
  });
  const framingBounds = await framingBar.boundingBox();
  const startBounds = await framingBar.getByRole('button', { name: /^开始倒计时$/ }).boundingBox();
  const cancelBounds = await framingBar.getByRole('button', { name: /取消/ }).boundingBox();
  expect(framingBounds).not.toBeNull();
  expect(startBounds).not.toBeNull();
  expect(cancelBounds).not.toBeNull();
  expect((startBounds?.x ?? 0) + (startBounds?.width ?? 0)).toBeLessThanOrEqual((framingBounds?.x ?? 0) + (framingBounds?.width ?? 0));
  expect((cancelBounds?.x ?? 0) + (cancelBounds?.width ?? 0)).toBeLessThanOrEqual((framingBounds?.x ?? 0) + (framingBounds?.width ?? 0));

  await page.getByRole('button', { name: /^开始倒计时$/ }).click();
  await expect(page.getByTestId('desktop-countdown-controls')).toBeVisible();
  await expect(page.getByTestId('desktop-countdown-controls')).toHaveAttribute('data-countdown-mode', 'compact');
  await expect(page.getByTestId('desktop-recording-controls')).toHaveAttribute('data-docked', 'true');
  await expect.poll(() => page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__desktopControlRequests;
  })).toBe(1);
  const countdown = page.getByTestId('desktop-countdown-controls');
  const countdownSize = await countdown.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return `${Math.ceil(rect.width)}x${Math.ceil(rect.height)}`;
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.recordingControlsWindow)).toBe('docked');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.recordingControlsTargetSize)).toBe(countdownSize);
  await expect.poll(() => page.evaluate(() => ({
    htmlMargin: getComputedStyle(document.documentElement).margin,
    htmlPadding: getComputedStyle(document.documentElement).padding,
    bodyMargin: getComputedStyle(document.body).margin,
    bodyPadding: getComputedStyle(document.body).padding,
    overflow: getComputedStyle(document.body).overflow,
  }))).toEqual({
    htmlMargin: '0px',
    htmlPadding: '0px',
    bodyMargin: '0px',
    bodyPadding: '0px',
    overflow: 'hidden',
  });

  // 测试桩把 Document PiP host 指到当前 document，因此可直接验证脱离主录制条的控制动作。
  const dock = page.getByTestId('desktop-recording-controls-dock');
  await expect(dock).toBeVisible({ timeout: 9_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.recordingControlsWindow)).toBe('docked');
  const dockSize = await dock.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return `${Math.ceil(rect.width)}x${Math.ceil(rect.height)}`;
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.recordingControlsTargetSize)).toBe(dockSize);
  expect(dockSize).toBe(countdownSize);
  const pause = page.getByRole('button', { name: 'Pause recording' });
  await expect(pause).toBeEnabled();
  await pause.click();
  const resume = page.getByRole('button', { name: 'Resume recording' });
  await expect(resume).toBeEnabled();
  await resume.click();
  await expect(pause).toBeEnabled();
});

test('window capture also moves framing and recording controls outside the captured page', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: { requestWindow: async () => window },
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
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /窗口/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();

  await expect(page.getByTestId('desktop-framing-controls')).toBeVisible();
  await page.getByTestId('desktop-framing-controls').getByRole('button', { name: /^开始倒计时$/ }).click();
  await expect(page.getByTestId('desktop-countdown-controls')).toBeVisible();
  await expect(page.getByTestId('desktop-countdown-controls')).toHaveAttribute('data-countdown-mode', 'compact');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.recordingControlsWindow)).toBe('docked');

  const dock = page.getByTestId('desktop-recording-controls-dock');
  await expect(dock.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 9_000 });
  await expect(dock.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await expect(page.getByTestId('in-page-recording-bar')).toHaveCount(0);
});

test('stopping drains the recorder before the detached controller closes', async ({ page }) => {
  await page.addInitScript(() => {
    const writeOrder = (entry: string) => {
      const current = JSON.parse(window.localStorage.getItem('excalicast.test.controller-stop-order') ?? '[]') as string[];
      current.push(entry);
      window.localStorage.setItem('excalicast.test.controller-stop-order', JSON.stringify(current));
    };
    const host = {
      get document() { return window.document; },
      get closed() { return false; },
      close: () => writeOrder('controller-close'),
      addEventListener: window.addEventListener.bind(window),
    } as unknown as Window;
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: {
        requestWindow: async () => host,
      },
    });
    const originalStop = MediaRecorder.prototype.stop;
    MediaRecorder.prototype.stop = function stop(this: MediaRecorder) {
      writeOrder('media-recorder-stop');
      return originalStop.call(this);
    };
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
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /整个桌面/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();
  await page.getByRole('button', { name: /^开始倒计时$/ }).click();

  const stop = page.getByTestId('desktop-recording-controls-dock').getByRole('button', { name: 'Stop recording' });
  await expect(stop).toBeEnabled({ timeout: 9_000 });
  await stop.evaluate((element: HTMLElement) => element.click());
  await expect(page).toHaveURL(/\/zh\/export\//, { timeout: 12_000 });
  const order = await page.evaluate(() => JSON.parse(window.localStorage.getItem('excalicast.test.controller-stop-order') ?? '[]') as string[]);
  expect(order.indexOf('media-recorder-stop')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('controller-close')).toBeGreaterThan(order.indexOf('media-recorder-stop'));
});

test('stop navigates away from Saving recording within one second while media finalizes', async ({ page }) => {
  await page.addInitScript(() => {
    class SlowMediaRecorder extends EventTarget {
      static isTypeSupported() { return true; }
      state: RecordingState = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(readonly stream: MediaStream, readonly options?: MediaRecorderOptions) {
        super();
      }
      start() {
        this.state = 'recording';
        window.setTimeout(() => this.ondataavailable?.({ data: new Blob(['first'], { type: this.options?.mimeType ?? 'video/webm' }) }), 20);
      }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        window.setTimeout(() => {
          this.ondataavailable?.({ data: new Blob(['final'], { type: this.options?.mimeType ?? 'video/webm' }) });
          this.onstop?.();
          this.dispatchEvent(new Event('stop'));
        }, 1500);
      }
      pause() { if (this.state === 'recording') this.state = 'paused'; }
      resume() { if (this.state === 'paused') this.state = 'recording'; }
      requestData() {
        this.ondataavailable?.({ data: new Blob(['flush'], { type: this.options?.mimeType ?? 'video/webm' }) });
      }
    }
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: SlowMediaRecorder,
    });
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: { requestWindow: async () => window },
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
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /当前标签页/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();
  await page.getByRole('button', { name: /^开始倒计时$/ }).click();

  const stop = page.getByRole('button', { name: 'Stop recording' });
  await expect(stop).toBeEnabled({ timeout: 9_000 });
  const started = Date.now();
  await stop.click({ force: true });
  await expect.poll(() => page.evaluate(() => window.location.pathname), { timeout: 1000 }).toContain('/zh/export/');
  expect(Date.now() - started).toBeLessThan(1000);
});

test('export leaves Finishing recording when MediaRecorder never emits stop', async ({ page }) => {
  await page.addInitScript(() => {
    class HangingMediaRecorder extends EventTarget {
      static isTypeSupported() { return true; }
      state: RecordingState = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(readonly stream: MediaStream, readonly options?: MediaRecorderOptions) {
        super();
      }
      start() {
        this.state = 'recording';
        window.setTimeout(() => this.ondataavailable?.({ data: new Blob(['first'], { type: this.options?.mimeType ?? 'video/webm' }) }), 20);
      }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        // Browser bug simulation: no onstop callback and no Event('stop').
      }
      pause() { if (this.state === 'recording') this.state = 'paused'; }
      resume() { if (this.state === 'paused') this.state = 'recording'; }
      requestData() {
        this.ondataavailable?.({ data: new Blob(['flush'], { type: this.options?.mimeType ?? 'video/webm' }) });
      }
    }
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: HangingMediaRecorder,
    });
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: { requestWindow: async () => window },
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
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /当前标签页/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();
  await page.getByRole('button', { name: /^开始倒计时$/ }).click();

  const stop = page.getByRole('button', { name: 'Stop recording' });
  await expect(stop).toBeEnabled({ timeout: 9_000 });
  await stop.click({ force: true });
  await expect.poll(() => page.evaluate(() => window.location.pathname), { timeout: 1000 }).toContain('/zh/export/');
  await expect(page.getByText('正在完成录制…')).toHaveCount(0, { timeout: 5_000 });
});

test('display recording moves the complete toolbar outside the captured page', async ({ page }) => {
  test.setTimeout(60_000);
  const chromeInset = { width: 18, height: 40 };
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__desktopControlSizes = [] as string[];
    const chromeInset = { width: 18, height: 40 };
    let controlWidth = 560 + chromeInset.width;
    let controlHeight = 64 + chromeInset.height;
    const host = {
      get document() { return window.document; },
      get closed() { return false; },
      get outerWidth() { return controlWidth; },
      get outerHeight() { return controlHeight; },
      get innerWidth() { return Math.max(1, controlWidth - chromeInset.width); },
      get innerHeight() { return Math.max(1, controlHeight - chromeInset.height); },
      resizeTo: (width: number, height: number) => {
        controlWidth = width;
        controlHeight = height;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__desktopControlSizes.push(`${width}x${height}`);
      },
      addEventListener: window.addEventListener.bind(window),
      close: () => {},
    } as unknown as Window;
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: { requestWindow: async () => host },
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
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /整个桌面/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();
  await page.getByRole('button', { name: /^开始倒计时$/ }).click();

  const controller = page.getByTestId('desktop-recording-controls');
  await expect(controller).toHaveAttribute('data-docked', 'true', { timeout: 7_000 });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).alignItems)).toBe('flex-end');
  const dock = page.getByTestId('desktop-recording-controls-dock');
  await expect(dock).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Pause recording' })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  const dockSize = await dock.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return `${Math.ceil(rect.width)}x${Math.ceil(rect.height)}`;
  });
  const [dockTargetWidth, dockTargetHeight] = dockSize.split('x').map((part) => Number(part));
  expect(dockTargetWidth).toBeGreaterThan(0);
  expect(dockTargetHeight).toBeLessThanOrEqual(50);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.recordingControlsTargetSize)).toBe(dockSize);
  const dockOuterSize = await page.evaluate(() => document.documentElement.dataset.recordingControlsOuterTargetSize);
  const expectedDockOuterSize = addChromeInset(dockSize, chromeInset);
  expect(dockOuterSize).toBe(expectedDockOuterSize);
  await expect.poll(() => page.evaluate((size) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sizes = (window as any).__desktopControlSizes as string[];
    return sizes.includes(size);
  }, expectedDockOuterSize)).toBe(true);

  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__desktopControlSizes = [] as string[];
  });
  await dock.dispatchEvent('pointerover', { pointerType: 'mouse' });
  await expect(controller).toHaveAttribute('data-docked', 'false');

  const bar = controller.getByTestId('recording-bar');
  await expect(bar).toBeVisible();
  await expect.poll(() => bar.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('999px');
  await expect(bar.getByRole('button', { name: 'Pause recording' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await expect(page.getByTestId('in-page-recording-bar')).toHaveCount(0);

  // 独立 Document PiP 控制条根据真实内容尺寸动态恢复，外层窗口不再保留固定留白。
  // 展开态的完整可见内容 = RecordingBar + 右侧收起按钮，因此量 controller 总尺寸。
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.recordingControlsTargetSize ?? '')).not.toBe(dockSize);
  const fullTargetSize = await page.evaluate(() => document.documentElement.dataset.recordingControlsTargetSize ?? '');
  const [fullTargetWidth, fullTargetHeight] = fullTargetSize.split('x').map((part) => Number(part));
  expect(fullTargetWidth).toBeGreaterThan(dockTargetWidth);
  expect(fullTargetHeight).toBeGreaterThanOrEqual(dockTargetHeight);
  const fullOuterSize = await page.evaluate(() => document.documentElement.dataset.recordingControlsOuterTargetSize);
  const expectedFullOuterSize = addChromeInset(fullTargetSize, chromeInset);
  expect(fullOuterSize).toBe(expectedFullOuterSize);
  await expect.poll(() => page.evaluate((size) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sizes = (window as any).__desktopControlSizes as string[];
    return sizes.includes(size);
  }, expectedFullOuterSize)).toBe(true);

  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__desktopControlSizes = [] as string[];
  });
  await controller.dispatchEvent('pointerout', { pointerType: 'mouse' });
  await expect(page.getByTestId('desktop-recording-controls-dock')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.recordingControlsTargetSize)).toBe(dockSize);
  await expect.poll(() => page.evaluate((size) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sizes = (window as any).__desktopControlSizes as string[];
    return sizes.includes(size);
  }, expectedDockOuterSize)).toBe(true);
});

test('display recording keeps controls usable when the PiP host rejects resize', async ({ page }) => {
  await page.addInitScript(() => {
    const host = {
      get document() { return window.document; },
      get closed() { return false; },
      get outerWidth() { return 560; },
      get outerHeight() { return 64; },
      get innerWidth() { return 560; },
      get innerHeight() { return 64; },
      resizeTo: () => {
        throw new Error('resize rejected by browser');
      },
      addEventListener: window.addEventListener.bind(window),
      close: () => {},
    } as unknown as Window;
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: { requestWindow: async () => host },
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
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /整个桌面/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();
  await page.getByRole('button', { name: /^开始倒计时$/ }).click();

  const controller = page.getByTestId('desktop-recording-controls');
  await expect(controller).toHaveAttribute('data-docked', 'true', { timeout: 7_000 });
  await expect(controller).toHaveAttribute('data-resize-status', 'failed');

  const dock = page.getByTestId('desktop-recording-controls-dock');
  await expect(page.getByTestId('desktop-recording-controls-resize-note')).toHaveCount(0);
  await expect(dock.getByRole('button', { name: 'Pause recording' })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await dock.evaluate((element) => {
    element.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  });
  await expect(controller).toHaveAttribute('data-docked', 'true');
  await dock.getByRole('button', { name: 'Show recording controls' }).evaluate((element: HTMLElement) => element.click());
  await expect(controller).toHaveAttribute('data-docked', 'false');
});

test('current tab uses a frozen framing surface and keeps the in-page countdown path', async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__desktopControlRequests = 0;
    const host = {
      get document() { return window.document; },
      get closed() { return false; },
      addEventListener: window.addEventListener.bind(window),
      close: () => {},
    } as unknown as Window;
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: {
        requestWindow: async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__desktopControlRequests += 1;
          return host;
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
  await page.getByRole('button', { name: /新建录制/ }).first().click();
  await page.getByRole('button', { name: /当前标签页/ }).click();
  await page.getByRole('button', { name: /下一步：取景/ }).click();

  await expect(page.getByTestId('display-source-framing-surface')).toHaveAttribute('data-preview-mode', 'frozen');
  await expect(page.getByTestId('desktop-framing-controls')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__desktopControlRequests;
  })).toBe(0);

  await page.getByRole('button', { name: /^开始倒计时$/ }).click();
  await expect(page.getByTestId('desktop-countdown-controls')).toHaveCount(0);
  await expect(page.locator('.workspace-craft-countdown').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__desktopControlRequests;
  })).toBe(1);
});
