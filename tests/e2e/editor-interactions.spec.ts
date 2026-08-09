import { expect, test } from '@playwright/test';

const baseOrigin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3002').origin;
const recordingId = 'e2e-editor-interactions';

test.use({
  locale: 'en-US',
  extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
});

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: baseOrigin, sameSite: 'Lax' }]);
  await page.goto('/en');
  await page.evaluate(async (id) => {
    localStorage.setItem('excalicast.seenAppIntro', '1');
    localStorage.setItem('excalicast_guest_id', 'e2e-editor-owner');

    const stores = [
      ['recordings', 'id'], ['snapshots', 'id'], ['audioChunks', 'id'], ['cameraChunks', 'id'],
      ['screenChunks', 'id'], ['cameraPositions', 'id'], ['binaryFiles', 'id'], ['workspaceShells', 'id'],
      ['libraryItems', 'id'], ['laserEvents', 'id'], ['localizedTracks', 'id'],
    ] as const;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onupgradeneeded = () => {
        const next = request.result;
        for (const [name, keyPath] of stores) {
          if (next.objectStoreNames.contains(name)) continue;
          const store = next.createObjectStore(name, { keyPath, autoIncrement: name !== 'recordings' && name !== 'libraryItems' });
          if (name !== 'recordings' && name !== 'libraryItems') store.createIndex('recordingId', 'recordingId');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      tx.objectStore('recordings').put({
        id,
        startedAt: Date.now(),
        durationMs: 12_000,
        hasAudio: false,
        hasCamera: false,
        status: 'done',
        ownerKey: 'e2e-editor-owner',
        title: 'Editor interaction fixture',
        setup: { framing: '16:9', croppingMode: 'follow_viewport', includeWorkspaceShell: false, camera: { enabled: false, sizePx: 160, shape: 'circle', position: 'bottom-right', backgroundRemoval: false }, source: { kind: 'whiteboard' } },
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);
  await page.goto(`/en/export/${recordingId}`);
  await expect(page.getByTestId('preview-resize-handle')).toBeVisible();
});

test('resizing the preview changes the shared height used by the preview window', async ({ page }) => {
  const preview = page.getByTestId('export-preview-stage');
  const workspace = page.getByTestId('export-preview-workspace');
  const timeline = page.getByTestId('editor-timeline');
  const initialPreview = await preview.boundingBox();
  const initialTimeline = await timeline.boundingBox();
  if (!initialPreview || !initialTimeline) throw new Error('editor layout was not measured');

  await page.getByRole('button', { name: 'Shrink preview' }).click();
  await expect.poll(async () => (await preview.boundingBox())?.height ?? Infinity).toBeLessThan(initialPreview.height);
  await expect.poll(async () => (await timeline.boundingBox())?.y ?? Infinity).toBeLessThan(initialTimeline.y);
  await expect.poll(async () => {
    const [stageBox, workspaceBox] = await Promise.all([preview.boundingBox(), workspace.boundingBox()]);
    return stageBox && workspaceBox ? workspaceBox.height - stageBox.height : Infinity;
  }).toBeCloseTo(16, 0);
});

test('a portrait preview fits beside the export panel without pushing the timeline out of view', async ({ page }) => {
  await page.locator('.editor-craft-ratio-card').filter({ hasText: '9:16' }).click();

  const preview = page.getByTestId('export-preview-stage');
  const timeline = page.getByTestId('editor-timeline');
  const main = page.locator('.editor-craft-main');
  await expect.poll(async () => {
    const box = await preview.boundingBox();
    return box ? box.height / box.width : 0;
  }).toBeCloseTo(16 / 9, 2);

  const [previewBox, timelineBox, mainBox] = await Promise.all([
    preview.boundingBox(),
    timeline.boundingBox(),
    main.boundingBox(),
  ]);
  if (!previewBox || !timelineBox || !mainBox) throw new Error('portrait editor layout was not measured');

  expect(previewBox.height).toBeLessThanOrEqual(560);
  expect(timelineBox.y).toBeGreaterThan(previewBox.y + previewBox.height);
  expect(timelineBox.y).toBeLessThan(mainBox.y + mainBox.height);
});

test('the user-selected preview height stays fixed while switching aspect ratios', async ({ page }) => {
  const preview = page.getByTestId('export-preview-stage');
  const workspace = page.getByTestId('export-preview-workspace');
  const timeline = page.getByTestId('editor-timeline');
  await page.getByRole('button', { name: 'Shrink preview' }).click();
  const initialPreview = await preview.boundingBox();
  const initialWorkspace = await workspace.boundingBox();
  const initialTimeline = await timeline.boundingBox();
  if (!initialPreview || !initialWorkspace || !initialTimeline) throw new Error('preview height was not measured');

  for (const ratio of ['9:16', '21:9', '1:1']) {
    await page.locator('.editor-craft-ratio-card').filter({ hasText: ratio }).click();
    await expect.poll(async () => (await preview.boundingBox())?.height ?? 0).toBeCloseTo(initialPreview.height, 0);
    await expect.poll(async () => (await workspace.boundingBox())?.height ?? 0).toBeCloseTo(initialWorkspace.height, 0);
    await expect.poll(async () => (await timeline.boundingBox())?.y ?? 0).toBeCloseTo(initialTimeline.y, 0);
  }
});

test('the preview can grow and keeps the enlarged height across ratios', async ({ page }) => {
  const preview = page.getByTestId('export-preview-stage');
  const before = await preview.boundingBox();
  if (!before) throw new Error('preview height was not measured');

  await page.getByRole('button', { name: 'Enlarge preview' }).click();
  await page.getByRole('button', { name: 'Enlarge preview' }).click();
  await expect.poll(async () => (await preview.boundingBox())?.height ?? 0).toBeGreaterThan(before.height);
  const enlargedBox = await preview.boundingBox();
  if (!enlargedBox) throw new Error('enlarged preview was not measured');

  for (const ratio of ['9:16', '21:9', '1:1']) {
    await page.locator('.editor-craft-ratio-card').filter({ hasText: ratio }).click();
    await expect.poll(async () => (await preview.boundingBox())?.height ?? 0).toBeCloseTo(enlargedBox.height, 0);
  }
});

test('export preview, timeline and keep-zoomed switch use scoped compact geometry', async ({ page }) => {
  const stageRadius = await page.getByTestId('export-preview-stage').evaluate((element) => getComputedStyle(element).borderRadius);
  const timelineRadius = await page.locator('.timeline-craft-panel').evaluate((element) => getComputedStyle(element).borderRadius);
  const switchBox = await page.getByRole('switch', { name: 'Always keep zoomed in' }).boundingBox();

  expect(stageRadius).toBe('18px');
  expect(timelineRadius).toBe('18px');
  expect(switchBox?.width).toBeCloseTo(40, 0);
  expect(switchBox?.height).toBeCloseTo(22, 0);
});

test('always keep zoomed in is off by default, remembered per ratio, and disabled by fit all', async ({ page }) => {
  const keepZoomed = page.getByRole('switch', { name: 'Always keep zoomed in' });
  const fitAll = page.locator('.editor-craft-segment-card').filter({ hasText: 'Fit all content' });
  const followViewport = page.locator('.editor-craft-segment-card').filter({ hasText: 'Follow my viewport' });

  await page.locator('.editor-craft-ratio-card').filter({ hasText: '9:16' }).click();
  await expect(keepZoomed).toHaveAttribute('aria-checked', 'false');
  await keepZoomed.click();
  await expect(keepZoomed).toHaveAttribute('aria-checked', 'true');
  await expect(followViewport).toHaveAttribute('data-active', 'true');

  await page.locator('.editor-craft-ratio-card').filter({ hasText: '1:1' }).click();
  await expect(keepZoomed).toHaveAttribute('aria-checked', 'false');
  await page.locator('.editor-craft-ratio-card').filter({ hasText: '9:16' }).click();
  await expect(keepZoomed).toHaveAttribute('aria-checked', 'true');

  await fitAll.click();
  await expect(keepZoomed).toHaveAttribute('aria-checked', 'false');
});

test('a display recording fills a newly selected portrait ratio without white bars', async ({ page }) => {
  await page.evaluate(async (id) => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('screen fixture canvas unavailable');
    context.fillStyle = '#176f87';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const stream = canvas.captureStream(12);
    const screenBlob = await new Promise<Blob>((resolve, reject) => {
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('screen fixture recorder failed'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      recorder.start();
      window.setTimeout(() => recorder.stop(), 250);
    });
    stream.getTracks().forEach((track) => track.stop());

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'screenChunks'], 'readwrite');
      const recordings = tx.objectStore('recordings');
      const request = recordings.get(id);
      request.onsuccess = () => {
        const source = { kind: 'desktop', sourceSize: { width: 160, height: 90 } };
        recordings.put({
          ...request.result,
          durationMs: 500,
          source,
          setup: { ...request.result.setup, source },
        });
      };
      tx.objectStore('screenChunks').add({ recordingId: id, index: 0, blob: screenBlob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);
  await page.reload();

  await page.locator('.editor-craft-ratio-card').filter({ hasText: '9:16' }).click();
  const fitAll = page.locator('.editor-craft-segment-card').filter({ hasText: 'Fit all content' });
  await expect(fitAll).toHaveAttribute('data-active', 'true');

  await expect.poll(async () => page.getByTestId('export-preview-stage').locator('canvas').evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext('2d');
    if (!context || element.width === 0 || element.height === 0) return 0;
    return context.getImageData(Math.floor(element.width / 2), 2, 1, 1).data[3];
  }), { timeout: 15_000 }).toBe(255);
  const topPixel = await page.getByTestId('export-preview-stage').locator('canvas').evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext('2d');
    if (!context) throw new Error('preview canvas unavailable');
    return Array.from(context.getImageData(Math.floor(element.width / 2), 2, 1, 1).data);
  });
  expect(topPixel[0], `top pixel ${topPixel.join(',')}`).toBeLessThan(60);
  expect(topPixel[1], `top pixel ${topPixel.join(',')}`).toBeGreaterThan(80);
  expect(topPixel[2], `top pixel ${topPixel.join(',')}`).toBeGreaterThan(100);

  await page.getByRole('switch', { name: 'Always keep zoomed in' }).click();
  await expect(page.getByTestId('cursor-tracking-status')).toBeVisible();
  await expect.poll(async () => page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains('cursorFocusTracks')) {
      db.close();
      return false;
    }
    const found = await new Promise<boolean>((resolve, reject) => {
      const request = db.transaction('cursorFocusTracks').objectStore('cursorFocusTracks').get(id);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return found;
  }, recordingId), { timeout: 15_000 }).toBe(true);
});

test('display preview advances to later source frames while playback is running', async ({ page }) => {
  await page.evaluate(async (id) => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('screen fixture canvas unavailable');
    const paint = (color: string) => {
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
    };
    paint('#145f8a');
    const stream = canvas.captureStream(12);
    const screenBlob = await new Promise<Blob>((resolve, reject) => {
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('screen fixture recorder failed'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      recorder.start();
      const startedAt = performance.now();
      const repaint = window.setInterval(() => {
        paint(performance.now() - startedAt < 550 ? '#145f8a' : '#d94a3a');
      }, 40);
      window.setTimeout(() => {
        window.clearInterval(repaint);
        paint('#d94a3a');
        recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
      }, 1_200);
    });
    const fixtureUrl = URL.createObjectURL(screenBlob);
    const fixtureVideo = document.createElement('video');
    fixtureVideo.muted = true;
    fixtureVideo.src = fixtureUrl;
    await new Promise<void>((resolve, reject) => {
      fixtureVideo.onloadeddata = () => resolve();
      fixtureVideo.onerror = () => reject(new Error('fixture video failed to decode'));
    });
    await new Promise<void>((resolve) => {
      fixtureVideo.onseeked = () => resolve();
      fixtureVideo.currentTime = Math.min(0.9, Math.max(0, fixtureVideo.duration - 0.05));
    });
    const probe = document.createElement('canvas');
    probe.width = 160;
    probe.height = 90;
    const probeContext = probe.getContext('2d');
    probeContext?.drawImage(fixtureVideo, 0, 0);
    const [fixtureRed, fixtureGreen, fixtureBlue] = probeContext?.getImageData(80, 45, 1, 1).data ?? [0, 0, 0];
    URL.revokeObjectURL(fixtureUrl);
    if (!(fixtureRed > fixtureGreen && fixtureRed > fixtureBlue)) {
      throw new Error(`fixture did not contain the later red frame: ${fixtureRed},${fixtureGreen},${fixtureBlue}`);
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'screenChunks'], 'readwrite');
      const recordings = tx.objectStore('recordings');
      const request = recordings.get(id);
      request.onsuccess = () => {
        const source = { kind: 'desktop', sourceSize: { width: 160, height: 90 } };
        recordings.put({ ...request.result, durationMs: 1_200, source, setup: { ...request.result.setup, source } });
      };
      tx.objectStore('screenChunks').add({ recordingId: id, index: 0, blob: screenBlob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);
  await page.reload();

  const centerPixel = () => page.getByTestId('export-preview-stage').locator('canvas').evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context || canvas.width === 0 || canvas.height === 0) return [0, 0, 0, 0];
    return Array.from(context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data);
  });
  await expect.poll(async () => {
    const [red, green, blue] = await centerPixel();
    return blue > red && blue > green;
  }).toBe(true);
  await page.getByTestId('export-preview-play-toggle').click();
  await expect.poll(async () => {
    const [red, green, blue] = await centerPixel();
    return red > green && red > blue;
  }, { timeout: 5_000 }).toBe(true);
});

test('a short display recording exports through the local WebCodecs pipeline and reports diagnostics', async ({ page }) => {
  await page.evaluate(async (id) => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('export fixture canvas unavailable');
    context.fillStyle = '#176f87';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream(15);
    const screenBlob = await new Promise<Blob>((resolve, reject) => {
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('export fixture recorder failed'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      recorder.start();
      window.setTimeout(() => recorder.stop(), 450);
    });
    stream.getTracks().forEach((track) => track.stop());

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'screenChunks'], 'readwrite');
      const recordings = tx.objectStore('recordings');
      const request = recordings.get(id);
      request.onsuccess = () => {
        const source = { kind: 'desktop', sourceSize: { width: 160, height: 90 } };
        recordings.put({
          ...request.result,
          durationMs: 450,
          source,
          setup: { ...request.result.setup, source },
        });
      };
      tx.objectStore('screenChunks').add({ recordingId: id, index: 0, blob: screenBlob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);
  await page.reload();

  await page.locator('.editor-craft-ratio-card').filter({ hasText: '9:16' }).click();
  await page.locator('.editor-craft-setting-row').filter({ hasText: 'Resolution' }).locator('select').selectOption('sd');
  await page.locator('.editor-craft-setting-row').filter({ hasText: 'Format' }).locator('select').selectOption('webm');
  await page.locator('.editor-craft-setting-row').filter({ hasText: 'Frame rate' }).locator('select').selectOption('15');

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: /Render & download/ }).click();
  await download;
  await expect(page.getByTestId('export-diagnostics-summary')).toContainText('webcodecs-vp9');
  const diagnosticsDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostics JSON' }).click();
  const diagnosticsFile = await diagnosticsDownload;
  const diagnosticsStream = await diagnosticsFile.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of diagnosticsStream) chunks.push(Buffer.from(chunk));
  const report = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    breakdownMs?: Record<string, number>;
    decoderPaths?: { screen?: string };
  };
  expect(report.decoderPaths?.screen).toBe('mediabunny-stream');
  expect(report.breakdownMs?.background_blur_gpu).toBeGreaterThan(0);
});

test('switching away from a custom recording ratio restores its original framing when returning', async ({ page }) => {
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      const store = tx.objectStore('recordings');
      const request = store.get(id);
      request.onsuccess = () => store.put({
        ...request.result,
        setup: {
          ...request.result.setup,
          framing: 'custom',
          customOutput: { width: 1000, height: 700 },
          cropWindow: { rx: 0.1, ry: 0.1, rw: 0.8, rh: 0.8 },
        },
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);
  await page.reload();

  const preview = page.getByTestId('export-preview-stage');
  const stageAspect = async () => {
    const box = await preview.boundingBox();
    return box ? box.width / box.height : 0;
  };
  await expect.poll(stageAspect).toBeCloseTo(10 / 7, 2);

  await page.locator('.editor-craft-ratio-card').filter({ hasText: '9:16' }).click();
  await expect.poll(stageAspect).toBeCloseTo(9 / 16, 2);
  await page.locator('.editor-craft-ratio-card').filter({ hasText: '3:2' }).click();
  await expect.poll(stageAspect).toBeCloseTo(10 / 7, 2);
});

test('a new portrait ratio starts fitted and remembers its own crop mode', async ({ page }) => {
  await page.locator('.editor-craft-ratio-card').filter({ hasText: '9:16' }).click();
  const fitAll = page.locator('.editor-craft-segment-card').filter({ hasText: 'Fit all content' });
  const followViewport = page.locator('.editor-craft-segment-card').filter({ hasText: 'Follow my viewport' });
  await expect(fitAll).toHaveAttribute('data-active', 'true');

  await followViewport.click();
  await expect(followViewport).toHaveAttribute('data-active', 'true');
  await page.locator('.editor-craft-ratio-card').filter({ hasText: '1:1' }).click();
  await expect(fitAll).toHaveAttribute('data-active', 'true');
  await page.locator('.editor-craft-ratio-card').filter({ hasText: '9:16' }).click();
  await expect(followViewport).toHaveAttribute('data-active', 'true');
});

test('all export ratios keep the preview chrome inside the stage', async ({ page }) => {
  const ratios = new Map([
    ['16:9', 16 / 9], ['4:3', 4 / 3], ['21:9', 2560 / 1080], ['16:10', 16 / 10], ['3:2', 3 / 2],
    ['9:16', 9 / 16], ['4:5', 4 / 5], ['3:4', 3 / 4], ['2:3', 2 / 3], ['1:1', 1],
  ]);
  const preview = page.getByTestId('export-preview-stage');

  for (const [ratio, expectedAspect] of ratios) {
    await page.locator('.editor-craft-ratio-card').filter({ hasText: ratio }).click();
    await expect.poll(async () => {
      const box = await preview.boundingBox();
      return box ? box.width / box.height : 0;
    }).toBeCloseTo(expectedAspect, 2);

    const bounds = await preview.evaluate((stage) => {
      const stageBox = stage.getBoundingClientRect();
      const controls = stage.querySelector<HTMLElement>('.export-preview-craft-controls')?.getBoundingClientRect();
      const resize = stage.querySelector<HTMLElement>('[data-testid="preview-resize-handle"]')?.getBoundingClientRect();
      return {
        stage: { left: stageBox.left, top: stageBox.top, right: stageBox.right, bottom: stageBox.bottom },
        controls: controls && { left: controls.left, top: controls.top, right: controls.right, bottom: controls.bottom },
        resize: resize && { left: resize.left, top: resize.top, right: resize.right, bottom: resize.bottom },
      };
    });
    for (const child of [bounds.controls, bounds.resize]) {
      if (!child) throw new Error(`${ratio} preview chrome was not measured`);
      expect(child.left).toBeGreaterThanOrEqual(bounds.stage.left);
      expect(child.top).toBeGreaterThanOrEqual(bounds.stage.top);
      expect(child.right).toBeLessThanOrEqual(bounds.stage.right);
      expect(child.bottom).toBeLessThanOrEqual(bounds.stage.bottom);
    }
  }
});

test('portrait preview does not create horizontal overflow on a mobile editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('.editor-craft-ratio-card').filter({ hasText: '9:16' }).click();

  const preview = page.getByTestId('export-preview-stage');
  await expect.poll(async () => {
    const box = await preview.boundingBox();
    return box ? box.width / box.height : 0;
  }).toBeCloseTo(9 / 16, 2);
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

test('a silent recording keeps an equal-height pale pink audio lane', async ({ page }) => {
  const videoTrack = page.getByTestId('timeline-video-track');
  const audioTrack = page.getByTestId('timeline-audio-track');
  await expect(audioTrack).toBeVisible();
  await expect(audioTrack).toHaveClass(/is-silent/);
  const [videoBox, audioBox] = await Promise.all([videoTrack.boundingBox(), audioTrack.boundingBox()]);
  if (!videoBox || !audioBox) throw new Error('timeline lanes were not measured');
  expect(Math.round(audioBox.height)).toBe(Math.round(videoBox.height));
});

test('dubbing tab is gated to Max members', async ({ page }) => {
  await page.getByRole('button', { name: 'Dubbing' }).click();
  await expect(page.getByText('Dubbing is a Max feature')).toBeVisible();
  await expect(page.getByRole('button', { name: /Upgrade to MAX/i })).toBeVisible();
});

test('generated English dubbing becomes the preview and export audio track', async ({ page }) => {
  await page.route('**/api/me/tier', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tier: 'max', status: 'active', currentPeriodEnd: null, loggedIn: true }),
  }));
  await page.route('**/api/dubbing/submit', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ jobId: 'mock-dubbing-job' }),
  }));
  await page.route('**/api/dubbing/status?**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'done', srtUrl: '/api/dubbing/result/mock-dubbing-job/subtitles.srt', audioUrl: '/api/dubbing/result/mock-dubbing-job/audio.wav', lipSync: 'skipped' }),
  }));
  await page.route('**/api/dubbing/result/mock-dubbing-job/subtitles.srt', async (route) => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    body: '1\n00:00:00,000 --> 00:00:03,000\nThis is the English narrated version.\n',
  }));
  await page.route('**/api/dubbing/result/mock-dubbing-job/audio.wav', async (route) => {
    const wav = new Uint8Array([
      82, 73, 70, 70, 38, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32,
      16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 128, 62, 0, 0,
      2, 0, 16, 0, 100, 97, 116, 97, 2, 0, 0, 0, 0, 0,
    ]);
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.from(wav) });
  });

  await page.evaluate(async (id) => {
    const sampleRate = 8_000;
    const sampleCount = sampleRate;
    const data = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(data);
    const write = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    write(0, 'RIFF');
    view.setUint32(4, 36 + sampleCount * 2, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, sampleCount * 2, true);
    for (let index = 0; index < sampleCount; index += 1) {
      const time = index / sampleRate;
      view.setInt16(44 + index * 2, Math.round(Math.sin(time * Math.PI * 440) * 0.25 * 32767), true);
    }

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'audioChunks'], 'readwrite');
      const recordings = tx.objectStore('recordings');
      const request = recordings.get(id);
      request.onsuccess = () => recordings.put({ ...request.result, hasAudio: true });
      tx.objectStore('audioChunks').add({ recordingId: id, index: 0, blob: new Blob([data], { type: 'audio/wav' }) });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);

  await page.reload();
  await page.getByRole('button', { name: 'Dubbing' }).click();
  await page.getByRole('button', { name: /Generate English version/i }).click();
  await expect(page.getByTestId('dubbing-active-track')).toContainText('English');
  await expect(page.getByTestId('export-preview-stage')).toHaveAttribute('data-localized-track', /localized-/);
  await expect(page.getByTestId('export-preview-audio')).toHaveAttribute('data-localized-audio', 'true');
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByTestId('export-panel-localized-note')).toContainText('English dubbed audio');
});

test('generated subtitles repaint the preview immediately without a reload', async ({ page }) => {
  await page.route('**/api/me/tier', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tier: 'pro', status: 'active', currentPeriodEnd: null, loggedIn: true }),
  }));
  await page.route('**/api/asr/submit', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ jobId: 'mock-subtitle-job', mock: true }),
  }));
  await page.route('**/api/asr/status?**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'done',
      srt: '1\n00:00:00,000 --> 00:00:12,000\nSubtitles are visible immediately.\n',
    }),
  }));
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'audioChunks'], 'readwrite');
      const recordings = tx.objectStore('recordings');
      const request = recordings.get(id);
      request.onsuccess = () => recordings.put({ ...request.result, hasAudio: true });
      tx.objectStore('audioChunks').add({
        recordingId: id,
        index: 0,
        blob: new Blob([new Uint8Array(4_096)], { type: 'audio/webm' }),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);

  await page.reload();
  const stage = page.getByTestId('export-preview-stage');
  const canvas = stage.locator('canvas');
  await expect(stage).toHaveAttribute('data-has-subtitles', 'false');
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());

  await page.getByRole('button', { name: 'Captions' }).click();
  await page.getByRole('button', { name: 'Generate subtitles' }).click();
  await expect(page.getByText(/Subtitles attached to this recording/)).toBeVisible();
  await expect(stage).toHaveAttribute('data-has-subtitles', 'true');
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(before);
});

test('a rounded camera selected before recording stays rounded in the export preview', async ({ page }) => {
  await page.evaluate(async (id) => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('camera fixture canvas unavailable');
    context.fillStyle = '#6d87a8';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f7d46d';
    context.beginPath();
    context.arc(48, 48, 26, 0, Math.PI * 2);
    context.fill();
    const stream = canvas.captureStream(12);
    const cameraBlob = await new Promise<Blob>((resolve, reject) => {
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('camera fixture recorder failed'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      recorder.start();
      window.setTimeout(() => {
        recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
      }, 180);
    });

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'cameraChunks'], 'readwrite');
      const recordings = tx.objectStore('recordings');
      const request = recordings.get(id);
      request.onsuccess = () => recordings.put({
        ...request.result,
        hasCamera: true,
        setup: {
          ...request.result.setup,
          camera: { ...request.result.setup.camera, enabled: true, shape: 'rounded' },
        },
      });
      tx.objectStore('cameraChunks').add({ recordingId: id, index: 0, blob: cameraBlob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);

  await page.reload();
  const camera = page.getByTestId('export-preview-camera');
  await expect(camera).toHaveAttribute('data-camera-shape', 'rounded');
  await expect(camera).not.toHaveCSS('border-radius', '50%');
});

test('a zoom can be dropped onto the dedicated zoom timeline and dragged in time', async ({ page }) => {
  const source = page.getByTestId('autozoom-drag-source');
  const lane = page.getByTestId('autozoom-track');
  await source.dragTo(lane, { targetPosition: { x: 120, y: 16 } });

  const zoom = page.getByTestId('autozoom-segment');
  await expect(zoom).toHaveCount(1);
  const before = await zoom.getAttribute('data-zoom-range');
  const box = await zoom.boundingBox();
  if (!box) throw new Error('autozoom segment has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2);
  await page.mouse.up();
  await expect(zoom).not.toHaveAttribute('data-zoom-range', before ?? '');
});

test('autozoom scale is editable directly on the timeline without the legacy bottom panel', async ({ page }) => {
  await page.getByTestId('autozoom-drag-source').dragTo(page.getByTestId('autozoom-track'), { targetPosition: { x: 160, y: 16 } });

  await page.getByTestId('autozoom-scale').click();
  const scale = page.getByTestId('autozoom-scale-input');
  await expect(scale).toBeVisible();
  await scale.fill('2.35');
  await scale.press('Enter');
  await expect(page.getByTestId('autozoom-segment')).toContainText('×2.4');
  await expect(page.getByText('Drag this purple segment on the timeline to set when detail comes forward.')).toHaveCount(0);
});

test('autozoom eases into and out of its scale instead of jumping at the segment edges', async ({ page }) => {
  const preview = page.getByTestId('export-preview-stage');
  const videoTrack = page.getByTestId('timeline-video-track');
  const track = await videoTrack.boundingBox();
  if (!track) throw new Error('video track was not measured');
  const scrub = async (fraction: number) => {
    await page.mouse.click(track.x + track.width * fraction, track.y + track.height / 2);
  };
  const scale = async () => Number(await preview.getAttribute('data-autozoom-scale'));

  // 通过真实的编辑器操作，在 1.2s 处新增默认 2.2s 的 Auto Zoom 片段。
  await scrub(0.1);
  await page.getByTestId('autozoom-drag-source').click();
  await expect(page.getByTestId('autozoom-segment')).toHaveCount(1);
  await expect(preview).toHaveAttribute('data-autozoom-scale', '1.000');

  // 片段开始后 200ms：正在缓慢放大，既不是 1× 也不是直接跳到目标倍率。
  await scrub(0.117);
  await expect.poll(scale).toBeGreaterThan(1);
  await expect.poll(scale).toBeLessThan(1.6);

  // 片段中段稳定到用户设定的目标倍率。
  await scrub(0.2);
  await expect.poll(scale).toBeCloseTo(1.6, 2);

  // 结束前 200ms：缓慢恢复，并在边界精确回到原倍率。
  await scrub(0.267);
  await expect.poll(scale).toBeGreaterThan(1);
  await expect.poll(scale).toBeLessThan(1.6);
  await scrub(0.284);
  await expect.poll(scale).toBeCloseTo(1, 2);
});

test('autozoom target can be framed directly in the preview and is retained for export', async ({ page }) => {
  const videoTrack = page.getByTestId('timeline-video-track');
  const track = await videoTrack.boundingBox();
  if (!track) throw new Error('video track was not measured');

  // 创建并选中一段 Auto Zoom 后，预览框会显示实际会被导出的 target crop。
  await page.mouse.click(track.x + track.width * 0.12, track.y + track.height / 2);
  await page.getByTestId('autozoom-drag-source').click();
  const preview = page.getByTestId('export-preview-stage');
  const region = page.getByTestId('autozoom-region');
  await expect(region).toBeVisible();
  const before = await preview.getAttribute('data-autozoom-region');
  const initial = await region.boundingBox();
  if (!initial) throw new Error('autozoom region was not measured');

  // 拖框改变焦点；右下角控制点缩放框，二者都会改变同一份导出参数。
  await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
  await page.mouse.down();
  await page.mouse.move(initial.x + initial.width / 2 + 46, initial.y + initial.height / 2 - 20);
  await page.mouse.up();
  await expect(preview).not.toHaveAttribute('data-autozoom-region', before ?? '');
  const moved = await region.boundingBox();
  if (!moved) throw new Error('moved autozoom region was not measured');
  const beforeResize = await preview.getAttribute('data-autozoom-region');
  await page.mouse.move(moved.x + moved.width - 2, moved.y + moved.height - 2);
  await page.mouse.down();
  await page.mouse.move(moved.x + moved.width - 54, moved.y + moved.height - 28);
  await page.mouse.up();
  await expect(preview).not.toHaveAttribute('data-autozoom-region', beforeResize ?? '');

  // 等待现有去抖持久化，刷新后仍显示相同的框选参数，导出会读取这一份 recording 数据。
  const expected = await preview.getAttribute('data-autozoom-region');
  await page.waitForTimeout(650);
  await page.reload();
  await expect(page.getByTestId('autozoom-region')).toBeVisible();
  await expect(page.getByTestId('export-preview-stage')).toHaveAttribute('data-autozoom-region', expected ?? '');
});

test('autozoom preview frames can be hidden without removing the zoom target', async ({ page }) => {
  const videoTrack = page.getByTestId('timeline-video-track');
  const track = await videoTrack.boundingBox();
  if (!track) throw new Error('video track was not measured');

  await page.mouse.click(track.x + track.width * 0.12, track.y + track.height / 2);
  await page.getByTestId('autozoom-drag-source').click();
  const preview = page.getByTestId('export-preview-stage');
  await expect(page.getByTestId('autozoom-region')).toBeVisible();
  await expect(preview).toHaveAttribute('data-autozoom-region', /\d/);
  const regionValue = await preview.getAttribute('data-autozoom-region');

  await page.getByTestId('toggle-preview-selection-overlays').click();
  await expect(page.getByTestId('autozoom-region')).toHaveCount(0);
  await expect(preview).toHaveAttribute('data-selection-overlays-hidden', 'true');
  await expect(preview).toHaveAttribute('data-autozoom-region', regionValue ?? '');

  await page.getByTestId('toggle-preview-selection-overlays').click();
  await expect(page.getByTestId('autozoom-region')).toBeVisible();
  await expect(preview).toHaveAttribute('data-autozoom-region', regionValue ?? '');
});

test('preview progress scrubber remains draggable while playback is running', async ({ page }) => {
  const preview = page.getByTestId('export-preview-stage');
  const play = page.getByTestId('export-preview-play-toggle');
  const scrubber = page.getByTestId('export-preview-progress-scrubber');

  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  const before = await preview.getAttribute('data-autozoom-scale');
  const box = await scrubber.boundingBox();
  if (!box) throw new Error('preview progress scrubber was not measured');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.up();

  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await expect.poll(async () => page.getByTestId('export-preview-play-toggle').getAttribute('aria-label')).toBe('Pause');
  expect(await preview.getAttribute('data-autozoom-scale')).toBe(before);
});

test('autozoom keeps the video background at its original scale in the export preview', async ({ page }) => {
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'snapshots'], 'readwrite');
      const recordings = tx.objectStore('recordings');
      const getRecording = recordings.get(id);
      getRecording.onsuccess = () => {
        const recording = getRecording.result;
        recordings.put({
          ...recording,
          setup: {
            ...recording.setup,
            videoBackground: { kind: 'preset', presetId: 'cyanotype-garden' },
          },
          autoZooms: [],
        });
      };
      tx.objectStore('snapshots').add({
        recordingId: id,
        timestamp: 0,
        elements: [{
          type: 'rectangle', id: 'zoom-fixture', x: 470, y: 300, width: 180, height: 110, angle: 0,
          strokeColor: '#111111', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 3,
          strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null,
          seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1,
          link: null, locked: false,
        }],
        appState: {
          viewBackgroundColor: '#ffffff', scrollX: 0, scrollY: 0, zoom: { value: 1 },
          width: 1280, height: 720, offsetLeft: 0, offsetTop: 0,
        },
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);

  await page.reload();
  const previewCanvas = page.getByTestId('export-preview-stage').locator('canvas');
  await expect(previewCanvas).toBeVisible();

  // 先取得未缩放时录制窗口上缘的像素。它属于窗口，而不是白板内容；开启 AutoZoom 后
  // 这些像素必须原封不动，证明没有把整张前景窗口当成缩放对象。
  await expect.poll(async () => previewCanvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    if (canvas.width === 0 || canvas.height === 0) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const x = Math.round(canvas.width * 0.5);
    const y = Math.round(canvas.height * 0.08) + 12;
    const pixel = Array.from(ctx.getImageData(x, y, 1, 1).data);
    // 首帧 canvas 已有尺寸但异步渲染尚未写入时是透明像素；等真正的窗口底色出现。
    return pixel[3] > 0 ? pixel : null;
  }), { timeout: 15_000 }).not.toBeNull();
  const unzoomedWindowPixels = await previewCanvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('preview context unavailable');
    const x = Math.round(canvas.width * 0.5);
    const y = Math.round(canvas.height * 0.08) + 12;
    return Array.from(ctx.getImageData(x, y, 1, 1).data);
  });
  const unzoomedBackgroundPixels = await previewCanvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('preview context unavailable');
    return [
      [4, 4],
      [canvas.width - 5, 4],
      [4, canvas.height - 5],
    ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
  });

  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      const recordings = tx.objectStore('recordings');
      const getRecording = recordings.get(id);
      getRecording.onsuccess = () => recordings.put({
        ...getRecording.result,
        autoZooms: [{ id: 'zoom-background-regression', start: 0, end: 12_000, scale: 2, cx: 0.5, cy: 0.5 }],
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);

  await page.reload();
  await expect(previewCanvas).toBeVisible();

  // AutoZoom 前后比较真实合成结果，不依赖任何旧的背景放大算法。
  await expect.poll(() => previewCanvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) return [];
    return [
      [4, 4],
      [canvas.width - 5, 4],
      [4, canvas.height - 5],
    ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
  }), { timeout: 15_000 }).toEqual(unzoomedBackgroundPixels);

  await expect.poll(async () => previewCanvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    if (canvas.width === 0 || canvas.height === 0) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const x = Math.round(canvas.width * 0.5);
    const y = Math.round(canvas.height * 0.08) + 12;
    return Array.from(ctx.getImageData(x, y, 1, 1).data);
  }), { timeout: 15_000 }).toEqual(unzoomedWindowPixels);
});

test('display-source Autozoom stays clipped inside the fixed recording frame', async ({ page }) => {
  await page.evaluate(async (id) => {
    const scene = document.createElement('canvas');
    scene.width = 320;
    scene.height = 180;
    const context = scene.getContext('2d');
    if (!context) throw new Error('display fixture canvas unavailable');
    context.fillStyle = '#ef3340';
    context.fillRect(0, 0, scene.width, scene.height);
    context.fillStyle = '#1438a6';
    context.fillRect(160, 0, 160, 180);
    const stream = scene.captureStream(12);
    const screenBlob = await new Promise<Blob>((resolve, reject) => {
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('display fixture recorder failed'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      recorder.start();
      window.setTimeout(() => recorder.stop(), 350);
    });
    stream.getTracks().forEach((track) => track.stop());

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'screenChunks'], 'readwrite');
      const recordings = tx.objectStore('recordings');
      const getRecording = recordings.get(id);
      getRecording.onsuccess = () => {
        const recording = getRecording.result;
        const source = { kind: 'desktop', sourceSize: { width: 320, height: 180 } };
        recordings.put({
          ...recording,
          durationMs: 350,
          source,
          setup: {
            ...recording.setup,
            source,
            videoBackground: { kind: 'preset', presetId: 'cyanotype-garden' },
          },
          autoZooms: [{ id: 'display-zoom', start: 0, end: 350, scale: 2.4, cx: 0.75, cy: 0.5 }],
        });
      };
      tx.objectStore('screenChunks').add({ recordingId: id, index: 0, blob: screenBlob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);

  await page.reload();
  const videoTrack = page.getByTestId('timeline-video-track');
  const trackBox = await videoTrack.boundingBox();
  if (!trackBox) throw new Error('display timeline was not measured');
  await page.mouse.click(trackBox.x + trackBox.width * 0.5, trackBox.y + trackBox.height / 2);
  const canvas = page.getByTestId('export-preview-stage').locator('canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((node) => {
    const element = node as HTMLCanvasElement;
    const context = element.getContext('2d');
    if (!context || element.width === 0 || element.height === 0) return false;
    const corners = [
      [4, 4], [element.width - 5, 4],
      [4, element.height - 5], [element.width - 5, element.height - 5],
    ];
    return corners.every(([x, y]) => {
      const pixel = context.getImageData(x, y, 1, 1).data;
      return pixel[3] > 0 && !(pixel[0] > 210 && pixel[1] < 90 && pixel[2] < 100)
        && !(pixel[2] > 120 && pixel[0] < 80);
    });
  }), { timeout: 15_000 }).toBe(true);
});

test('portrait Fit All reveals one continuous wallpaper around a landscape display source', async ({ page }) => {
  await page.evaluate(async (id) => {
    const scene = document.createElement('canvas');
    scene.width = 320;
    scene.height = 180;
    const context = scene.getContext('2d');
    if (!context) throw new Error('display fixture canvas unavailable');
    context.fillStyle = '#ef3340';
    context.fillRect(0, 0, scene.width, scene.height);
    const stream = scene.captureStream(12);
    const screenBlob = await new Promise<Blob>((resolve, reject) => {
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('display fixture recorder failed'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      recorder.start();
      window.setTimeout(() => recorder.stop(), 350);
    });
    stream.getTracks().forEach((track) => track.stop());

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'screenChunks'], 'readwrite');
      const recordings = tx.objectStore('recordings');
      const getRecording = recordings.get(id);
      getRecording.onsuccess = () => {
        const recording = getRecording.result;
        const source = { kind: 'desktop', sourceSize: { width: 320, height: 180 } };
        recordings.put({
          ...recording,
          durationMs: 350,
          source,
          setup: {
            ...recording.setup,
            framing: '9:16',
            croppingMode: 'fit_all_content',
            source,
            videoBackground: { kind: 'preset', presetId: 'cyanotype-garden' },
          },
          autoZooms: [],
        });
      };
      tx.objectStore('screenChunks').add({ recordingId: id, index: 0, blob: screenBlob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);

  await page.reload();
  const stage = page.getByTestId('export-preview-stage');
  await expect(stage).toHaveCSS('background-image', /bg-01-cyanotype-garden\.png/);
  const canvas = stage.locator('canvas');
  await expect(canvas).toBeVisible();

  await expect.poll(() => canvas.evaluate(async (node) => {
    const actual = node as HTMLCanvasElement;
    if (actual.width === 0 || actual.height === 0) return false;
    const actualContext = actual.getContext('2d');
    if (!actualContext) return false;

    const wallpaper = new Image();
    wallpaper.src = '/video-backgrounds/curated/bg-01-cyanotype-garden.png';
    await new Promise<void>((resolve, reject) => {
      wallpaper.onload = () => resolve();
      wallpaper.onerror = () => reject(new Error('fixture wallpaper did not load'));
    });
    const expected = document.createElement('canvas');
    expected.width = actual.width;
    expected.height = actual.height;
    const expectedContext = expected.getContext('2d');
    if (!expectedContext) return false;
    const sourceAspect = wallpaper.naturalWidth / wallpaper.naturalHeight;
    const targetAspect = actual.width / actual.height;
    if (sourceAspect > targetAspect) {
      const sourceWidth = wallpaper.naturalHeight * targetAspect;
      expectedContext.drawImage(
        wallpaper,
        (wallpaper.naturalWidth - sourceWidth) / 2,
        0,
        sourceWidth,
        wallpaper.naturalHeight,
        0,
        0,
        actual.width,
        actual.height,
      );
    } else {
      const sourceHeight = wallpaper.naturalWidth / targetAspect;
      expectedContext.drawImage(
        wallpaper,
        0,
        (wallpaper.naturalHeight - sourceHeight) / 2,
        wallpaper.naturalWidth,
        sourceHeight,
        0,
        0,
        actual.width,
        actual.height,
      );
    }

    // The sample is inside the fixed recording window, but above the contained
    // 16:9 source. It must reveal the same wallpaper already painted underneath.
    const x = Math.round(actual.width * 0.5);
    const y = Math.round(actual.height * 0.12);
    const actualPixel = actualContext.getImageData(x, y, 1, 1).data;
    const expectedPixel = expectedContext.getImageData(x, y, 1, 1).data;
    return [0, 1, 2].every((channel) => Math.abs(actualPixel[channel] - expectedPixel[channel]) <= 4)
      && actualPixel[3] === 255;
  }), { timeout: 15_000 }).toBe(true);
});

test('auto edit removes locally detected silence and can be undone', async ({ page }) => {
  await page.evaluate(async (id) => {
    const sampleRate = 8_000;
    const durationSeconds = 12;
    const sampleCount = sampleRate * durationSeconds;
    const data = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(data);
    const write = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    write(0, 'RIFF');
    view.setUint32(4, 36 + sampleCount * 2, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, sampleCount * 2, true);
    for (let index = 0; index < sampleCount; index += 1) {
      const time = index / sampleRate;
      const speaking = (time > 0.8 && time < 2.3) || (time > 5.1 && time < 6.8) || (time > 9.2 && time < 10.6);
      const amplitude = speaking ? Math.sin(time * Math.PI * 440) * 0.32 : 0;
      view.setInt16(44 + index * 2, Math.round(amplitude * 32767), true);
    }

    // 三个高对比画面，作为本地 PySceneDetect 自适应转场检测的输入。
    const sceneCanvas = document.createElement('canvas');
    sceneCanvas.width = 160;
    sceneCanvas.height = 90;
    const sceneContext = sceneCanvas.getContext('2d');
    if (!sceneContext) throw new Error('scene canvas unavailable');
    const sceneStream = sceneCanvas.captureStream(12);
    const screenBlob = await new Promise<Blob>((resolve, reject) => {
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(sceneStream, { mimeType: 'video/webm' });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('screen recorder failed'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      const paint = (color: string) => {
        sceneContext.fillStyle = color;
        sceneContext.fillRect(0, 0, sceneCanvas.width, sceneCanvas.height);
      };
      recorder.start();
      paint('#112b55');
      window.setTimeout(() => paint('#f06f55'), 720);
      window.setTimeout(() => paint('#d9e8a4'), 1_440);
      window.setTimeout(() => {
        recorder.stop();
        sceneStream.getTracks().forEach((track) => track.stop());
      }, 2_180);
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'audioChunks', 'screenChunks'], 'readwrite');
      const recordings = tx.objectStore('recordings');
      const request = recordings.get(id);
      request.onsuccess = () => recordings.put({ ...request.result, hasAudio: true });
      tx.objectStore('audioChunks').add({ recordingId: id, index: 0, blob: new Blob([data], { type: 'audio/wav' }) });
      tx.objectStore('screenChunks').add({ recordingId: id, index: 0, blob: screenBlob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);

  await page.reload();
  await page.getByTestId('autoedit-standard').click();
  await expect(page.getByTestId('autoedit-result')).toContainText(/removed/i, { timeout: 15_000 });
  await expect(page.getByTestId('autoedit-scene-aware')).toContainText(/PySceneDetect.*[1-9] transition/i, { timeout: 15_000 });
  await expect(page.getByTestId('autoedit-undo')).toBeVisible();
  await page.getByTestId('autoedit-undo').click();
  await expect(page.getByTestId('autoedit-result')).toHaveCount(0);
});
