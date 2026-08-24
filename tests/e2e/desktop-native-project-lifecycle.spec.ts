import { expect, test } from '@playwright/test';

const baseOrigin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3001').origin;
const recordingId = 'e2e-native-project-lifecycle';

test.use({
  locale: 'en-US',
  extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
});

test('native project keeps metadata visible while real Director and composition lifecycles settle', async ({ context, page }) => {
  await page.route('**/api/me/tier', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tier: 'free' }),
  }));
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: baseOrigin, sameSite: 'Lax' }]);
  await page.addInitScript((id) => {
    (window as Window & {
      __nativeLifecycle?: { director: string; composition: string };
    }).__nativeLifecycle = { director: 'pending', composition: 'malformed' };
    const checkpoint = {
      owner: 'recording-manifest', reference: 'director/current.json',
      checkpointId: `director-${'a'.repeat(64)}`,
    };
    const director = (status: string) => ({
      recordingId: id,
      status,
      code: `director_job_${status}`,
      retryable: false,
      ...(status === 'ready' ? { checkpoint } : {}),
      evidence: {
        profile: 'Balanced', speechActivity: 'unavailable', speechIntervalCount: 0,
        preservedMedia: true, recoveredCheckpoint: false,
      },
    });
    Object.defineProperty(window, 'excalicastDesktop', {
      configurable: true,
      value: {
        async invoke(channel: string) {
          if (channel === 'project.recover.v1') {
            return { schemaVersion: 1, recordingId: id, state: 'ready', tracks: { screen: [] } };
          }
          if (channel === 'project.director-status.v1') {
            const lifecycle = (window as Window & {
              __nativeLifecycle?: { director: string; composition: string };
            }).__nativeLifecycle!;
            return director(lifecycle.director);
          }
          if (channel === 'project.read-teaching-composition-export.v1') {
            const state = (window as Window & {
              __nativeLifecycle?: { director: string; composition: string };
            }).__nativeLifecycle!.composition;
            const persistedState = sessionStorage.getItem('nativeCompositionLifecycle') ?? state;
            if (persistedState === 'malformed') return { state: 'ready', sourceTracks: [], operations: [] };
            return persistedState === 'ready' ? {
              state: persistedState,
              sourceTracks: [{ trackId: 'microphone', kind: 'microphone' }],
              operations: [{
                operationId: 'teaching:sound-effect:0000:lesson-pop',
                operation: 'mix-sound-effect', track: 'sound-effect',
                asset: {
                  assetId: 'lesson-pop', kind: 'sound-effect', catalogVersion: 'catalog-v1',
                  assetVersion: '1.0.0', checksumAlgorithm: 'sha256', checksum: 'a'.repeat(64),
                  localUri: 'file:///tmp/lesson-pop.wav',
                },
                startMs: 500, endMs: 800,
                trim: { sourceStartMs: 0, sourceEndMs: 300, playbackMode: 'once' },
                zOrder: 0,
                transition: { enterMs: 0, exitMs: 0, easing: 'easeInOutCubic' },
                content: [],
                audio: {
                  gainDb: -3, gainCeilingDb: -1,
                  ducking: { targetSourceTracks: ['microphone'], attenuationDb: -8, attackMs: 80, releaseMs: 240 },
                  mixesAsIndependentEffect: true,
                },
              }],
            } : { state: persistedState };
          }
          if (channel === 'ink.get-settings.v1') {
            return { mode: 'ink', pointerPolicy: 'pass-through', backgroundOpacity: 0, inkOpacity: 1, visible: false };
          }
          throw new Error(`unexpected_channel:${channel}`);
        },
        subscribe: () => () => undefined,
      },
    });
  }, recordingId);

  await page.goto('/en');
  await page.evaluate(async (id) => {
    localStorage.setItem('excalicast.seenAppIntro', '1');
    localStorage.setItem('excalicast_guest_id', 'e2e-native-lifecycle-owner');
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
        durationMs: 4_000,
        hasAudio: false,
        hasCamera: false,
        status: 'done',
        ownerKey: 'e2e-native-lifecycle-owner',
        title: 'Native lifecycle lesson',
        teachingRecipeStatus: 'pending',
        nativeProject: {
          schemaVersion: 1,
          storage: 'macos-videos',
          recordingId: id,
          captureState: 'ready',
          validationState: 'valid',
          exportStatus: 'ready',
          teachingComposition: { status: 'pending' },
          director: {
            recordingId: id,
            status: 'pending',
            code: 'director_job_pending',
            retryable: false,
            evidence: {
              profile: 'Balanced', speechActivity: 'unavailable', speechIntervalCount: 0,
              preservedMedia: true, recoveredCheckpoint: false,
            },
          },
        },
        setup: {
          framing: 'default', croppingMode: 'fit_all_content', includeWorkspaceShell: false,
          camera: { enabled: false, sizePx: 160, shape: 'circle', position: 'bottom-right', backgroundRemoval: false },
          source: { kind: 'desktop', displaySurface: 'monitor', captureSystemAudio: true },
          teachingRecipe: {
            schemaVersion: 1, enabled: true, teachingPackId: 'teaching-pack-1', selectedAssetIds: ['lesson-pop'],
          },
        },
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/en/export/${recordingId}`);
  const progress = page.getByTestId('desktop-director-progress');
  await expect(progress).toBeVisible();
  await expect(progress).toContainText('Automatic film creation stopped');
  await expect(progress).toContainText('teaching_composition_probe_error');
  await page.evaluate(() => {
    const lifecycle = (window as Window & {
      __nativeLifecycle?: { director: string; composition: string };
    }).__nativeLifecycle!;
    lifecycle.composition = 'pending';
  });
  await page.getByRole('button', { name: 'Retry composition' }).click();
  await expect(progress).toContainText('Waiting to understand the lesson');
  await page.evaluate(() => {
    const lifecycle = (window as Window & {
      __nativeLifecycle?: { director: string; composition: string };
    }).__nativeLifecycle!;
    lifecycle.director = 'generating';
    lifecycle.composition = 'generating';
  });
  await expect(progress).toContainText('Building the teaching film');
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
      request.onsuccess = () => store.put({ ...request.result, title: 'Concurrent title survives' });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recordingId);
  await page.evaluate(() => {
    const lifecycle = (window as Window & {
      __nativeLifecycle?: { director: string; composition: string };
    }).__nativeLifecycle!;
    lifecycle.director = 'ready';
    lifecycle.composition = 'ready';
  });
  await expect(progress).toContainText('Ready to preview');
  await expect(progress).toContainText('1 material placed');
  await expect(page.getByTestId('teaching-sound-track')).toContainText('lesson-pop');
  await page.evaluate(() => {
    (window as Window & { __previewScrollBehavior?: ScrollBehavior }).__previewScrollBehavior = undefined;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(arg?: boolean | ScrollIntoViewOptions) {
      if (typeof arg === 'object') {
        (window as Window & { __previewScrollBehavior?: ScrollBehavior }).__previewScrollBehavior = arg.behavior;
      }
    };
  });
  await page.getByRole('button', { name: 'Jump to preview' }).click();
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __previewScrollBehavior?: ScrollBehavior }
  ).__previewScrollBehavior)).toBe('auto');

  const persisted = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const tx = db.transaction('recordings', 'readonly');
      const request = tx.objectStore('recordings').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  }, recordingId);
  expect(persisted).toMatchObject({
    title: 'Concurrent title survives',
    teachingRecipeStatus: 'ready',
    nativeProject: { teachingComposition: { status: 'ready' } },
    teachingEditRecipe: {
      sourceRecordingId: recordingId,
      teachingPackId: 'teaching-pack-1',
      curatedAssetIds: ['lesson-pop'],
      placements: [{ assetId: 'lesson-pop', track: 'sound-effect', startMs: 500, endMs: 800 }],
    },
  });

  await page.evaluate(() => {
    const lifecycle = (window as Window & {
      __nativeLifecycle?: { director: string; composition: string };
    }).__nativeLifecycle!;
    lifecycle.composition = 'pending';
    sessionStorage.setItem('nativeCompositionLifecycle', 'pending');
  });
  await page.reload();
  await expect(progress).toContainText('Waiting to understand the lesson');
  await expect(page.getByTestId('teaching-sound-track')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('excalicast');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const tx = db.transaction('recordings', 'readonly');
      const request = tx.objectStore('recordings').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return {
      teachingRecipeStatus: value.teachingRecipeStatus,
      teachingEditRecipe: value.teachingEditRecipe ?? null,
    };
  }, recordingId)).toEqual({ teachingRecipeStatus: 'pending', teachingEditRecipe: null });
});
