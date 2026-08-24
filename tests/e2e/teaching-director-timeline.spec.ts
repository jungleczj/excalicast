import { expect, test } from '@playwright/test';

const baseOrigin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3001').origin;
const recordingId = 'e2e-teaching-director-timeline';

test.use({
  locale: 'en-US',
  extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
});

test('a ready one-click teaching plan appears on its corresponding editor tracks', async ({ context, page }) => {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: baseOrigin, sameSite: 'Lax' }]);
  await page.goto('/en');
  await page.evaluate(async (id) => {
    localStorage.setItem('excalicast.seenAppIntro', '1');
    localStorage.setItem('excalicast_guest_id', 'e2e-director-owner');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
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
        ownerKey: 'e2e-director-owner',
        title: 'One-click teaching film',
        teachingRecipeStatus: 'ready',
        teachingEditRecipe: {
          schemaVersion: 1,
          sourceRecordingId: id,
          teachingPackId: 'chatcut-teaching-core-v1',
          curatedAssetIds: ['key-points-drawer-01', 'chart-bars-01', 'teaching-pop-01'],
          placements: [
            { assetId: 'key-points-drawer-01', track: 'motion-graphics', startMs: 0, endMs: 3_200 },
            { assetId: 'chart-bars-01', track: 'chart', startMs: 4_000, endMs: 8_000 },
            { assetId: 'teaching-pop-01', track: 'sound-effect', startMs: 8_000, endMs: 8_420 },
          ],
        },
        setup: {
          framing: '16:9', croppingMode: 'follow_viewport', includeWorkspaceShell: false,
          camera: { enabled: false, sizePx: 160, shape: 'circle', position: 'bottom-right', backgroundRemoval: false },
          source: { kind: 'whiteboard' },
        },
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);

  await page.goto(`/en/export/${recordingId}`);
  const progress = page.getByTestId('desktop-director-progress');
  await expect(progress).toContainText('Ready to preview');
  await expect(progress).toContainText('3 materials placed');
  await expect(page.getByTestId('teaching-motion-track')).toContainText('key-points-drawer-01');
  await expect(page.getByTestId('teaching-chart-track')).toContainText('chart-bars-01');
  await expect(page.getByTestId('teaching-sound-track')).toContainText('teaching-pop-01');
  await expect(page.getByTestId('teaching-motion-segment')).toHaveCount(1);
  await expect(page.getByTestId('teaching-chart-segment')).toHaveCount(1);
  await expect(page.getByTestId('teaching-sound-segment')).toHaveCount(1);
});
