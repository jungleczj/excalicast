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
      ['libraryItems', 'id'], ['laserEvents', 'id'],
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

test('resizing the preview container pushes the timeline down without zooming its content', async ({ page }) => {
  const preview = page.getByTestId('export-preview-stage');
  const timeline = page.getByTestId('editor-timeline');
  const initialPreview = await preview.boundingBox();
  const initialTimeline = await timeline.boundingBox();
  if (!initialPreview || !initialTimeline) throw new Error('editor layout was not measured');

  await page.getByTestId('preview-enlarge').click();
  await expect.poll(async () => (await preview.boundingBox())?.height ?? 0).toBeGreaterThan(initialPreview.height);
  await expect.poll(async () => (await timeline.boundingBox())?.y ?? 0).toBeGreaterThan(initialTimeline.y);
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
