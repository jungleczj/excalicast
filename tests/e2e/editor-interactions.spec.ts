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
  const regionValue = await preview.getAttribute('data-autozoom-region');
  await expect(page.getByTestId('autozoom-region')).toBeVisible();

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

  // 用同一 cover 算法把 wallpaper 单独绘制出来。AutoZoom 若错误作用于整张 target，
  // 这些角落像素会来自图片中心，而不是与原始背景逐像素一致。
  await expect.poll(() => previewCanvas.evaluate(async (node) => {
    const canvas = node as HTMLCanvasElement;
    if (canvas.width === 0 || canvas.height === 0) return false;
    const expected = document.createElement('canvas');
    expected.width = canvas.width;
    expected.height = canvas.height;
    const image = new Image();
    image.src = '/video-backgrounds/curated/bg-01-cyanotype-garden.png';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('fixture wallpaper did not load'));
    });
    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    expected.getContext('2d')?.drawImage(image, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);

    const actualPixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    const expectedPixels = expected.getContext('2d')?.getImageData(0, 0, expected.width, expected.height).data;
    if (!actualPixels || !expectedPixels) return false;
    const samples = [[24, 24], [canvas.width - 24, 24], [24, canvas.height - 24]];
    return samples.every(([x, y]) => {
      const i = (Math.round(y) * canvas.width + Math.round(x)) * 4;
      return Math.abs(actualPixels[i] - expectedPixels[i]) <= 3
        && Math.abs(actualPixels[i + 1] - expectedPixels[i + 1]) <= 3
        && Math.abs(actualPixels[i + 2] - expectedPixels[i + 2]) <= 3;
    });
  }), { timeout: 15_000 }).toBe(true);

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
