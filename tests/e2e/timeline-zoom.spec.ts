import { expect, test } from '@playwright/test';

const baseOrigin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3002').origin;
const recordingId = 'e2e-timeline-zoom';

test.use({
  locale: 'en-US',
  extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
});

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: baseOrigin, sameSite: 'Lax' }]);
  await page.goto('/en');
  await page.evaluate(() => {
    localStorage.setItem('excalicast.seenAppIntro', '1');
    localStorage.setItem('excalicast_guest_id', 'e2e-timeline-zoom-owner');
  });
  await page.goto('/en/library');
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('excalicast');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const ready = db.objectStoreNames.contains('audioPeakTracks')
      && db.objectStoreNames.contains('recordingThumbnails');
    db.close();
    return ready;
  }), { timeout: 15_000 }).toBe(true);
  await page.evaluate(async (id) => {

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const audioBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' });
    const write = (storeName: string, value: unknown) => new Promise<void>((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) {
        reject(new Error(`missing fixture store: ${storeName}; stores=${Array.from(db.objectStoreNames).join(',')}`));
        return;
      }
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await write('recordings', {
        id,
        startedAt: Date.now(),
        durationMs: 120_000,
        hasAudio: true,
        hasCamera: false,
        status: 'done',
        ownerKey: 'e2e-timeline-zoom-owner',
        title: 'Timeline zoom fixture',
        subtitleSrt: Array.from({ length: 24 }, (_, index) => {
          const start = index * 5;
          const end = start + 2;
          const clock = (seconds: number) => `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},000`;
          return `${index + 1}\n${clock(start)} --> ${clock(end)}\nCaption ${index + 1}\n`;
        }).join('\n'),
        setup: {
          framing: '16:9',
          croppingMode: 'follow_viewport',
          includeWorkspaceShell: false,
          camera: { enabled: false, sizePx: 160, shape: 'circle', position: 'bottom-right', backgroundRemoval: false },
          source: { kind: 'whiteboard' },
        },
      });
    await write('audioChunks', { recordingId: id, index: 0, blob: audioBlob });
    await write('audioPeakTracks', {
        id: `${id}:peaks`,
        recordingId: id,
        sourceSignature: `${audioBlob.size}:${audioBlob.type}:120000`,
        samplesPerSecond: 4,
        peaks: Array.from({ length: 480 }, (_, index) => 0.2 + ((index % 9) / 12)),
        createdAt: Date.now(),
      });
    db.close();
  }, recordingId);
  await page.goto(`/en/export/${recordingId}`);
  await expect(page.getByTestId('timeline-video-track')).toBeVisible();
});

test('imports multiple recordings from the basic toolbar into one persisted main track', async ({ page }) => {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const write = (value: unknown) => new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('recordings', 'readwrite');
      transaction.objectStore('recordings').put(value);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    const base = {
      startedAt: Date.now() - 1_000,
      hasAudio: false,
      hasCamera: false,
      status: 'done',
      ownerKey: 'e2e-timeline-zoom-owner',
      source: { kind: 'whiteboard' },
    };
    await write({ ...base, id: 'e2e-import-one', durationMs: 30_000, title: 'Imported lesson one' });
    await write({ ...base, id: 'e2e-import-two', durationMs: 45_000, title: 'Imported lesson two', startedAt: Date.now() - 2_000 });
    db.close();
  });

  const importButton = page.getByTestId('import-recordings');
  await expect(importButton).toBeVisible();
  await expect(importButton).toContainText('Import recording');
  await importButton.click();
  await expect(page.getByRole('dialog', { name: 'Import recordings' })).toBeVisible();
  await page.getByRole('option', { name: /Imported lesson one/ }).click();
  await page.getByRole('option', { name: /Imported lesson two/ }).click();
  await page.getByTestId('confirm-import-recordings').click();

  await expect(page.getByTestId('timeline-video-clip')).toHaveCount(3);
  // The initial playhead is at zero, so the chosen recordings lead the
  // original clip while preserving the user's selection order.
  await expect(page.getByTestId('timeline-video-clip').nth(0)).toHaveAttribute('data-recording-id', 'e2e-import-one');
  await expect(page.getByTestId('timeline-video-clip').nth(1)).toHaveAttribute('data-recording-id', 'e2e-import-two');
  await expect(page.getByTestId('timeline-video-clip').nth(2)).toHaveAttribute('data-recording-id', recordingId);
  await expect.poll(() => page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<{ mainTrack?: unknown[] } | undefined>((resolve, reject) => {
      const request = db.transaction('recordings', 'readonly').objectStore('recordings').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value?.mainTrack?.length ?? 0;
  }, recordingId)).toBe(3);
});

test('timeline starts fitted and zooms its horizontal content from 1x to 32x', async ({ page }) => {
  const viewport = page.getByTestId('timeline-viewport');
  const content = page.getByTestId('timeline-content');

  await expect(page.getByTestId('timeline-zoom-value')).toHaveText('Fit');
  await expect(page.getByRole('button', { name: 'Zoom out timeline' })).toHaveAttribute('data-availability', 'prerequisite');
  await expect(page.getByRole('button', { name: 'Fit timeline' })).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in timeline' }).click();
  await expect(page.getByTestId('timeline-zoom-value')).toHaveText('2x');

  const dimensions = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="timeline-viewport"]');
    const content = document.querySelector<HTMLElement>('[data-testid="timeline-content"]');
    if (!viewport || !content) throw new Error('timeline zoom geometry unavailable');
    return { viewport: viewport.clientWidth, content: content.getBoundingClientRect().width };
  });
  expect(dimensions.content).toBeCloseTo(dimensions.viewport * 2, 0);

  await expect(viewport).toBeVisible();
  await expect(content).toBeVisible();
});

test('zoom buttons anchor on the playhead and stop at 32x', async ({ page }) => {
  const videoTrack = page.getByTestId('timeline-video-track');
  const trackBox = await videoTrack.boundingBox();
  if (!trackBox) throw new Error('timeline track was not measured');
  await page.mouse.click(trackBox.x + trackBox.width * 0.72, trackBox.y + trackBox.height / 2);

  const playhead = page.locator('.timeline-craft-playhead');
  const before = await playhead.boundingBox();
  if (!before) throw new Error('timeline playhead was not measured');
  await page.getByRole('button', { name: 'Zoom in timeline' }).click();
  const after = await playhead.boundingBox();
  if (!after) throw new Error('zoomed timeline playhead was not measured');
  expect(after.x).toBeCloseTo(before.x, 0);

  for (let index = 0; index < 4; index += 1) {
    await page.getByRole('button', { name: 'Zoom in timeline' }).click();
  }
  await expect(page.getByTestId('timeline-zoom-value')).toHaveText('32x');
  await expect(page.getByRole('button', { name: 'Zoom in timeline' })).toHaveAttribute('data-availability', 'prerequisite');

  await page.getByRole('button', { name: 'Fit timeline' }).click();
  await expect(page.getByTestId('timeline-zoom-value')).toHaveText('Fit');
  await expect.poll(() => page.getByTestId('timeline-viewport').evaluate((node) => node.scrollLeft)).toBe(0);
});

test('ctrl or command wheel zoom keeps the time under the pointer anchored', async ({ page }) => {
  const viewport = page.getByTestId('timeline-viewport');
  const box = await viewport.boundingBox();
  if (!box) throw new Error('timeline viewport was not measured');
  const pointerX = box.x + box.width * 0.68;
  const pointerY = box.y + box.height / 2;
  const before = await viewport.evaluate((node, clientX) => {
    const bounds = node.getBoundingClientRect();
    return ((node.scrollLeft + clientX - bounds.left) / node.scrollWidth) * 120_000;
  }, pointerX);

  await viewport.dispatchEvent('wheel', {
    clientX: pointerX,
    clientY: pointerY,
    deltaY: -100,
    ctrlKey: true,
  });
  await expect(page.getByTestId('timeline-zoom-value')).toHaveText('2x');
  const after = await viewport.evaluate((node, clientX) => {
    const bounds = node.getBoundingClientRect();
    return ((node.scrollLeft + clientX - bounds.left) / node.scrollWidth) * 120_000;
  }, pointerX);
  const millisecondsPerPixel = await viewport.evaluate((node) => 120_000 / node.scrollWidth);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(millisecondsPerPixel * 2);
});

test('scroll offset participates in scrub coordinates and only visible waveform and captions render', async ({ page }) => {
  const zoomIn = page.getByRole('button', { name: 'Zoom in timeline' });
  await zoomIn.click();
  await zoomIn.click();
  const viewport = page.getByTestId('timeline-viewport');
  await viewport.evaluate((node) => {
    node.scrollLeft = (node.scrollWidth - node.clientWidth) * 0.55;
    node.dispatchEvent(new Event('scroll'));
  });

  const viewportBox = await viewport.boundingBox();
  const rulerBox = await page.getByTestId('timeline-ruler').boundingBox();
  if (!viewportBox || !rulerBox) throw new Error('timeline scrub geometry unavailable');
  const expectedMs = await viewport.evaluate((node) => (
    ((node.scrollLeft + node.clientWidth / 2) / node.scrollWidth) * 120_000
  ));
  await page.mouse.click(viewportBox.x + viewportBox.width / 2, rulerBox.y + rulerBox.height / 2);
  const actualMs = Number(await page.getByTestId('timeline-current-time').getAttribute('data-playhead-ms'));
  const millisecondsPerPixel = await viewport.evaluate((node) => 120_000 / node.scrollWidth);
  expect(Math.abs(actualMs - expectedMs)).toBeLessThanOrEqual(millisecondsPerPixel * 2);

  const waveform = page.getByTestId('timeline-audio-waveform');
  await expect(waveform).toBeVisible();
  const [waveformBox, visibleStart, visibleEnd] = await Promise.all([
    waveform.boundingBox(),
    waveform.getAttribute('data-visible-start'),
    waveform.getAttribute('data-visible-end'),
  ]);
  if (!waveformBox || visibleStart == null || visibleEnd == null) throw new Error('visible waveform range unavailable');
  expect(waveformBox.width).toBeLessThanOrEqual(viewportBox.width);
  expect(Number(visibleStart)).toBeGreaterThan(0);
  expect(Number(visibleEnd) - Number(visibleStart)).toBeCloseTo(30_000, -2);

  const cueStarts = await page.getByTestId('timeline-caption-cue').evaluateAll((nodes) => (
    nodes.map((node) => Number(node.getAttribute('data-cue-start')))
  ));
  expect(cueStarts.length).toBeGreaterThan(0);
  expect(cueStarts.length).toBeLessThan(24);
  expect(Math.min(...cueStarts)).toBeGreaterThan(Number(visibleStart) - 6_000);
  expect(Math.max(...cueStarts)).toBeLessThan(Number(visibleEnd) + 6_000);
});

test('external playhead changes wait for active scrolling, then bring the playhead into view', async ({ page }) => {
  const zoomIn = page.getByRole('button', { name: 'Zoom in timeline' });
  await zoomIn.click();
  await zoomIn.click();
  const viewport = page.getByTestId('timeline-viewport');
  await viewport.evaluate((node) => {
    node.scrollLeft = node.clientWidth * 0.35;
    node.dispatchEvent(new Event('scroll'));
  });
  const userScrollLeft = await viewport.evaluate((node) => node.scrollLeft);

  const previewScrubber = page.getByTestId('export-preview-progress-scrubber');
  const scrubberBox = await previewScrubber.boundingBox();
  if (!scrubberBox) throw new Error('preview scrubber was not measured');
  await page.mouse.click(scrubberBox.x + scrubberBox.width * 0.92, scrubberBox.y + scrubberBox.height / 2);

  await page.waitForTimeout(80);
  expect(await viewport.evaluate((node) => node.scrollLeft)).toBeCloseTo(userScrollLeft, 0);
  await expect.poll(async () => {
    const viewportBox = await viewport.boundingBox();
    const playheadBox = await page.locator('.timeline-craft-playhead').boundingBox();
    return viewportBox && playheadBox
      ? playheadBox.x >= viewportBox.x && playheadBox.x <= viewportBox.x + viewportBox.width
      : false;
  }, { timeout: 1_500 }).toBe(true);
});

test('timeline zoom is session-only and resets to Fit after reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Zoom in timeline' }).click();
  await page.getByRole('button', { name: 'Zoom in timeline' }).click();
  await expect(page.getByTestId('timeline-zoom-value')).toHaveText('4x');
  await page.reload();
  await expect(page.getByTestId('timeline-zoom-value')).toHaveText('Fit');
});
