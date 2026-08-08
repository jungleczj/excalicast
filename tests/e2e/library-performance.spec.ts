import { expect, test, type Page } from '@playwright/test';

const OWNER_KEY = 'library-performance-owner';

async function seedRecordings(page: Page, count: number): Promise<void> {
  await page.route('https://example.supabase.co/**', async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"anonymous"}' });
  });
  await page.goto('/en');
  await page.evaluate((ownerKey) => localStorage.setItem('excalicast_guest_id', ownerKey), OWNER_KEY);
  await page.goto('/en/library');
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    return databases.some((database) => database.name === 'excalicast');
  });

  await page.evaluate(async ({ ownerKey, recordingCount }) => {
    const request = indexedDB.open('excalicast');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('recordings', 'readwrite');
      const store = transaction.objectStore('recordings');
      store.clear();
      for (let index = 0; index < recordingCount; index += 1) {
        store.put({
          id: `library-recording-${String(index).padStart(3, '0')}`,
          ownerKey,
          title: `Library recording ${index}`,
          startedAt: 10_000 - index,
          durationMs: 60_000 + index,
          hasAudio: false,
          hasCamera: false,
          status: 'done',
        });
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, { ownerKey: OWNER_KEY, recordingCount: count });

  await page.goto('/en/library');
  await expect(page.getByText('Library recording 0')).toBeVisible();
}

test('paginates local recording summaries without duplicate cursor rows', async ({ page }) => {
  await seedRecordings(page, 65);

  await expect(page.locator('.library-craft-card')).toHaveCount(30);

  const loadMore = page.getByTestId('library-load-more');
  await loadMore.click();
  await expect(page.locator('.library-craft-card')).toHaveCount(60);
  await loadMore.click();
  await expect(page.locator('.library-craft-card')).toHaveCount(65);

  const ids = await page.locator('[data-recording-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-recording-id')),
  );
  expect(new Set(ids).size).toBe(65);
  await expect(loadMore).toBeHidden();
});

test('leaves loading and exposes an error state when the local database fails', async ({ page }) => {
  await page.addInitScript(() => {
    const originalOpenCursor = IDBIndex.prototype.openCursor;
    const originalGetAll = IDBIndex.prototype.getAll;
    const shouldFail = (index: IDBIndex) => index.name === '[ownerKey+startedAt]';
    IDBIndex.prototype.openCursor = function (...args) {
      if (shouldFail(this)) throw new DOMException('local read failed', 'UnknownError');
      return originalOpenCursor.apply(this, args);
    };
    IDBIndex.prototype.getAll = function (...args) {
      if (shouldFail(this)) throw new DOMException('local read failed', 'UnknownError');
      return originalGetAll.apply(this, args);
    };
  });
  await page.route('https://example.supabase.co/**', async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"anonymous"}' });
  });
  await page.goto('/en/library');
  await expect(page.getByTestId('library-load-error')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Loading…')).toBeHidden();
});

test('v14 migrates inline thumbnails and adds the owner/start index', async ({ page }) => {
  await page.goto('/robots.txt');
  await page.evaluate(async ({ ownerKey }) => {
    localStorage.setItem('excalicast_guest_id', ownerKey);
    const request = indexedDB.open('excalicast', 130);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        request.result.createObjectStore('recordings', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      tx.objectStore('recordings').put({
        id: 'legacy-thumbnail-recording',
        ownerKey,
        title: 'Legacy thumbnail',
        startedAt: 1234,
        durationMs: 1000,
        hasAudio: false,
        hasCamera: false,
        status: 'done',
        lastFrameThumbnail: 'data:image/png;base64,iVBORw0KGgo=',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { ownerKey: OWNER_KEY });

  await page.goto('/en/library');
  await expect(page.getByText('Legacy thumbnail')).toBeVisible();
  const migrated = await page.evaluate(async () => {
    const request = indexedDB.open('excalicast');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(['recordings', 'recordingThumbnails'], 'readonly');
    const recording = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const get = tx.objectStore('recordings').get('legacy-thumbnail-recording');
      get.onsuccess = () => resolve(get.result as Record<string, unknown> | undefined);
      get.onerror = () => reject(get.error);
    });
    const thumbnail = await new Promise<{ blob?: Blob } | undefined>((resolve, reject) => {
      const get = tx.objectStore('recordingThumbnails').get('legacy-thumbnail-recording');
      get.onsuccess = () => resolve(get.result as { blob?: Blob } | undefined);
      get.onerror = () => reject(get.error);
    });
    const hasCompoundIndex = tx.objectStore('recordings').indexNames.contains('[ownerKey+startedAt]');
    db.close();
    return {
      version: db.version,
      inlineRemoved: recording?.lastFrameThumbnail === undefined,
      thumbnailBytes: thumbnail?.blob?.size ?? 0,
      hasCompoundIndex,
    };
  });
  expect(migrated).toEqual({
    version: 140,
    inlineRemoved: true,
    thumbnailBytes: 8,
    hasCompoundIndex: true,
  });
});
