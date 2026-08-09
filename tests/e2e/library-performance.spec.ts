import { expect, test, type Page } from '@playwright/test';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

const OWNER_KEY = 'library-performance-owner';
const STALE_USER_ID = '00000000-0000-4000-8000-000000000099';

function authCookieName(): string {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://example.supabase.co';
  const projectRef = new URL(configured).hostname.split('.')[0] || 'example';
  return `sb-${projectRef}-auth-token`;
}

async function cacheRevokedSession(page: Page): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
  const payload = Buffer.from(JSON.stringify({
    aud: 'authenticated', exp: expiresAt, role: 'authenticated', sub: STALE_USER_ID,
  })).toString('base64url');
  const session = {
    access_token: `e30.${payload}.test-signature`,
    expires_at: expiresAt,
    refresh_token: 'stale-refresh-token',
    user: { id: STALE_USER_ID, email: 'stale@example.com', user_metadata: {} },
  };
  const cookieValue = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  await page.addInitScript(({ cookieName, value }) => {
    if (localStorage.getItem('inject-stale-auth-session') === 'yes') {
      document.cookie = `${cookieName}=${value}; Path=/; SameSite=Lax`;
    }
  }, { cookieName: authCookieName(), value: cookieValue });
  await page.evaluate(() => localStorage.setItem('inject-stale-auth-session', 'yes'));
}

async function recordingOwners(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate(async () => {
    const request = indexedDB.open('excalicast');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('recordings', 'readonly');
    const store = transaction.objectStore('recordings');
    const ids = ['library-recording-000', 'legacy-owner-recording'];
    const entries = await Promise.all(ids.map((id) => new Promise<[string, string | null]>((resolve, reject) => {
      const get = store.get(id);
      get.onsuccess = () => resolve([id, get.result?.ownerKey ?? null]);
      get.onerror = () => reject(get.error);
    })));
    db.close();
    return Object.fromEntries(entries);
  });
}

async function seedRecordings(page: Page, count: number, includeLegacy = false): Promise<void> {
  await page.route('**/auth/v1/**', async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"anonymous"}' });
  });
  await page.goto('/en');
  await page.evaluate((ownerKey) => localStorage.setItem('excalicast_guest_id', ownerKey), OWNER_KEY);
  await page.goto('/en/library');
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === 'excalicast')) return false;
    const request = indexedDB.open('excalicast');
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    if (!db) return false;
    const ready = db.objectStoreNames.contains('recordings');
    db.close();
    return ready;
  });

  await page.evaluate(async ({ ownerKey, recordingCount, withLegacy }) => {
    const request = indexedDB.open('excalicast', 140);
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
      if (withLegacy) {
        store.put({
          id: 'legacy-owner-recording',
          title: 'Legacy owner recording',
          startedAt: 20_000,
          durationMs: 30_000,
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
  }, { ownerKey: OWNER_KEY, recordingCount: count, withLegacy: includeLegacy });

  if (!includeLegacy) {
    await page.goto('/en/library');
    await expect(page.getByText('Library recording 0')).toBeVisible();
  }
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
  await page.route('**/auth/v1/**', async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"anonymous"}' });
  });
  await page.goto('/en/library');
  await expect(page.getByTestId('library-load-error')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Loading…')).toBeHidden();
});

test('loads the anonymous local library when auth initialization never settles', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (localStorage.getItem('block-auth') === 'yes' && url.includes('/auth/v1/user')) {
        return new Promise<Response>(() => undefined);
      }
      return originalFetch(input, init);
    };
  });
  await seedRecordings(page, 1);
  await page.evaluate(() => localStorage.setItem('block-auth', 'yes'));
  await page.reload();
  await expect(page.getByText('Library recording 0')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Loading…')).toBeHidden();
});

test('does not reassign guest or legacy rows for a revoked cached session', async ({ page }) => {
  await seedRecordings(page, 1, true);
  await page.unroute('**/auth/v1/**');

  let getUserRequests = 0;
  await page.route('**/auth/v1/**', async (route) => {
    if (route.request().url().includes('/auth/v1/user')) {
      getUserRequests += 1;
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"revoked"}' });
      return;
    }
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"unauthorized"}' });
  });
  await cacheRevokedSession(page);

  await page.reload();
  await expect.poll(() => getUserRequests, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.getByText('Library recording 0')).toBeVisible({ timeout: 10_000 });
  expect(await recordingOwners(page)).toEqual({
    'library-recording-000': OWNER_KEY,
    'legacy-owner-recording': null,
  });
});

test('leaves loading when a local IndexedDB query never settles', async ({ page }) => {
  await page.addInitScript(() => {
    const originalOpenCursor = IDBIndex.prototype.openCursor;
    IDBIndex.prototype.openCursor = function (...args) {
      if (this.name === '[ownerKey+startedAt]') return {} as IDBRequest<IDBCursorWithValue | null>;
      return originalOpenCursor.apply(this, args);
    };
  });
  await page.route('**/auth/v1/**', async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"anonymous"}' });
  });
  await page.goto('/en/library');
  await expect(page.getByTestId('library-load-error')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Loading…')).toBeHidden();
});

test('keeps local results visible when the cloud list rejects', async ({ page }) => {
  await seedRecordings(page, 1);
  await page.route('/api/me/tier', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tier: 'pro', status: 'active', currentPeriodEnd: null, loggedIn: true }),
    });
  });
  await page.route('/api/recordings/list', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"unavailable"}' });
  });
  await page.goto('/en/library');
  await expect(page.getByText('Library recording 0')).toBeVisible();
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
