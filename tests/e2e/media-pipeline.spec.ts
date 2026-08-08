import { expect, test } from '@playwright/test';
import { LatestTaskRunner } from '@/lib/latestTaskRunner';
import { buildPrivateMediaPath, parseMediaSubmitPayload } from '@/lib/privateMedia';
import { drainEncoderBackpressure, resolveWebCodecsAudioMode } from '@/services/webCodecsExport';
import { resolveVideoRateControl } from '@/services/webCodecsExport';
import { PendingFocusRequests } from '@/services/cursorFocusTracker';
import { createExportDiagnostics } from '@/services/exportDiagnostics';
import { planExportFrameBatches } from '@/services/exportFrameBatches';
import { captureCameraPlacement, projectCameraPlacement } from '@/services/cameraPlacement';
import { planExportSegments, recoverMediaTask } from '@/services/mediaTaskDomain';
import { downsampleAudioPeaks } from '@/services/audioPeakTrack';
import { MediaTaskCoordinator } from '@/services/mediaTaskCoordinator';
import { resolvePreviewRenderSize } from '@/services/previewRenderPolicy';
import { RecordingLifecycleCoordinator } from '@/services/recordingLifecycle';
import { PreviewPlaybackRegistry } from '@/services/previewPlaybackRegistry';
import { resolveFrameTransform } from '@/services/frameTransform';
import { resolvePrivateUploadMode } from '@/services/privateMediaUpload';
import { DOWNLOAD_URL_REVOKE_DELAY_MS } from '@/services/exportPipeline';
import { MonotonicTimestampNormalizer, createMp4TimestampMapper } from '@/services/mediaTimestamps';
import { waitForDisplaySourceStage } from '@/services/displayFrameSource';
import { ChunkWriteBatcher } from '@/services/mediaRecorderHealth';
import { dataUrlToBlob } from '@/services/workspaceShellCapture';

test('MP4 mux timestamps keep DTS monotonic while preserving reordered H.264 PTS', () => {
  const mapTimestamp = createMp4TimestampMapper(15);
  const mapped = [0, 66_667, 133_334, 441_179, 394_739, 507_846].map(mapTimestamp);

  expect(mapped.map((sample) => sample.presentationTimestampUs)).toEqual([
    0, 66_667, 133_334, 441_179, 394_739, 507_846,
  ]);
  expect(mapped.map((sample) => sample.decodeTimestampUs)).toEqual([
    0, 66_667, 133_334, 200_001, 266_668, 333_335,
  ]);
  expect(mapped.map((sample) => sample.compositionTimeOffsetUs)).toEqual([
    0, 0, 0, 241_178, 128_071, 174_511,
  ]);
});

test('concatenated media timestamps are rebased across resets and duplicates', () => {
  const normalizer = new MonotonicTimestampNormalizer(33_333);
  const normalized = [0, 33_333, 66_666, 10_000, 10_000, 43_333].map((value) => normalizer.push(value));

  expect(normalized).toEqual([0, 33_333, 66_666, 99_999, 133_332, 166_665]);
  expect(normalized.every((value, index) => index === 0 || value > normalized[index - 1])).toBe(true);
});

test('display source startup reports the stalled stage instead of waiting forever', async () => {
  const never = new Promise<void>(() => undefined);
  await expect(waitForDisplaySourceStage('decoder_init', never, { timeoutMs: 10 }))
    .rejects.toEqual(expect.objectContaining({
      name: 'DisplaySourceStageError',
      stage: 'decoder_init',
      code: 'timeout',
    }));
});

test('display source startup responds to cancellation', async () => {
  const controller = new AbortController();
  const waiting = waitForDisplaySourceStage('metadata', new Promise<void>(() => undefined), {
    timeoutMs: 10_000,
    signal: controller.signal,
  });
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
});

test('recorder chunks are persisted in bounded batches with throughput metrics', async () => {
  const batches: Array<Array<{ index: number; bytes: number }>> = [];
  let now = 0;
  const writer = new ChunkWriteBatcher<{ index: number; bytes: number }>({
    batchSize: 3,
    flushIntervalMs: 60_000,
    sizeOf: (item) => item.bytes,
    now: () => now,
    writeBatch: async (items) => {
      now += 12;
      batches.push(items);
    },
  });

  writer.enqueue({ index: 0, bytes: 100 });
  writer.enqueue({ index: 1, bytes: 150 });
  writer.enqueue({ index: 2, bytes: 200 });
  writer.enqueue({ index: 3, bytes: 50 });
  await writer.flush();

  expect(batches.map((batch) => batch.map((item) => item.index))).toEqual([[0, 1, 2], [3]]);
  expect(writer.metrics()).toMatchObject({
    chunks: 4,
    bytes: 500,
    batches: 2,
    maxQueuedChunks: 3,
    totalWriteMs: 24,
  });
});

test('workspace snapshots convert data URLs without issuing a fetch', async () => {
  const blob = dataUrlToBlob('data:image/png;base64,AQIDBA==');
  expect(blob.type).toBe('image/png');
  expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([1, 2, 3, 4]);
});

test('preview rendering never overlaps and coalesces queued work to the latest time', async () => {
  const started: number[] = [];
  const finished: number[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let active = 0;
  let maxActive = 0;

  const runner = new LatestTaskRunner<number>(async (timeMs) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    started.push(timeMs);
    if (timeMs === 100) await firstGate;
    active -= 1;
    finished.push(timeMs);
  });

  const first = runner.push(100);
  const superseded = runner.push(200);
  const latest = runner.push(300);
  releaseFirst?.();
  await Promise.all([first, superseded, latest]);

  expect(maxActive).toBe(1);
  expect(started).toEqual([100, 300]);
  expect(finished).toEqual([100, 300]);
});

test('preview rendering aborts obsolete work when a newer frame is requested', async () => {
  const completed: number[] = [];
  const aborted: number[] = [];
  let startedFirst: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => { startedFirst = resolve; });

  const runner = new LatestTaskRunner<number>(async (timeMs, signal) => {
    if (timeMs === 100) {
      startedFirst?.();
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          aborted.push(timeMs);
          resolve();
        }, { once: true });
      });
      return;
    }
    completed.push(timeMs);
  });

  const first = runner.push(100);
  await firstStarted;
  const latest = runner.push(300);
  await Promise.all([first, latest]);

  expect(aborted).toEqual([100]);
  expect(completed).toEqual([300]);
});

test('camera placement preserves a bottom-right edge anchor across output ratios', () => {
  const placement = captureCameraPlacement({
    contentRect: { x: 100, y: 50, width: 800, height: 450 },
    bubbleRect: { x: 748, y: 348, width: 140, height: 140 },
    edgeThresholdPx: 12,
  });
  expect(placement.anchorX).toBe('right');
  expect(placement.anchorY).toBe('bottom');

  const portrait = projectCameraPlacement(placement, { x: 40, y: 20, width: 360, height: 640 });
  expect(portrait.x + portrait.size).toBeCloseTo(394.6, 1);
  expect(portrait.y + portrait.size).toBeCloseTo(642.9, 1);
  expect(portrait.x).toBeGreaterThanOrEqual(40);
  expect(portrait.y).toBeGreaterThanOrEqual(20);
});

test('Auto quality uses constant-quality quantizers with a variable bitrate fallback', () => {
  expect(resolveVideoRateControl({
    width: 1920,
    height: 1080,
    fps: 15,
    quality: 'auto',
    quantizerSupported: true,
  })).toEqual({ bitrateMode: 'quantizer', quantizer: 23 });

  const fallback = resolveVideoRateControl({
    width: 1920,
    height: 1080,
    fps: 15,
    quality: 'auto',
    quantizerSupported: false,
  });
  expect(fallback.bitrateMode).toBe('variable');
  if (fallback.bitrateMode !== 'variable') throw new Error('expected variable bitrate fallback');
  expect(fallback.bitrate).toBeLessThan(3_000_000);
  expect(fallback.bitrate).toBeGreaterThanOrEqual(1_000_000);
});

test('unfinished media tasks resume from bounded export checkpoints', () => {
  expect(planExportSegments(27_500, 10_000)).toEqual([
    { index: 0, startMs: 0, endMs: 10_000 },
    { index: 1, startMs: 10_000, endMs: 20_000 },
    { index: 2, startMs: 20_000, endMs: 27_500 },
  ]);

  const recovered = recoverMediaTask({
    id: 'task-1',
    recordingId: 'recording-1',
    kind: 'export',
    status: 'running',
    progress: 0.42,
    createdAt: 1,
    updatedAt: 2,
    checkpoint: { segmentIndex: 3 },
    configSnapshot: { format: 'mp4' },
  }, 10);
  expect(recovered.status).toBe('paused');
  expect(recovered.updatedAt).toBe(10);
  expect(recovered.checkpoint).toEqual({ segmentIndex: 3 });
  expect(recovered.configSnapshot).toEqual({ format: 'mp4' });
});

test('audio waveform downsampling preserves visible peaks and silence', () => {
  const samples = new Float32Array([0, 0.25, -1, 0.5, 0, 0, 0.2, -0.4]);
  expect(downsampleAudioPeaks([samples], 4)).toEqual([0.25, 1, 0, 0.4]);
});

test('media task continues after its page subscriber unmounts and replays progress on return', async () => {
  const persisted: Array<{ status: string; progress: number }> = [];
  let finish: ((value: Blob) => void) | undefined;
  const executor = new Promise<Blob>((resolve) => { finish = resolve; });
  const coordinator = new MediaTaskCoordinator({
    persist: async (task) => { persisted.push({ status: task.status, progress: task.progress }); },
    runExport: async (_input, report) => {
      report({ phase: 'encoding', ratio: 0.4 });
      return executor;
    },
  });

  const firstPageUpdates: number[] = [];
  const unsubscribe = coordinator.subscribe((tasks) => {
    firstPageUpdates.push(tasks[0]?.progress ?? 0);
  });
  const started = coordinator.startExport({
    recordingId: 'recording-1',
    configSnapshot: { format: 'mp4', aspectRatio: '16:9' },
  });
  unsubscribe();

  const returningPageUpdates: number[] = [];
  const unsubscribeReturningPage = coordinator.subscribe((tasks) => {
    returningPageUpdates.push(tasks[0]?.progress ?? 0);
  });
  expect(returningPageUpdates.at(-1)).toBe(0.4);

  finish?.(new Blob(['video']));
  const completed = await started;
  unsubscribeReturningPage();

  expect(completed.status).toBe('completed');
  expect(persisted.some((entry) => entry.status === 'running' && entry.progress === 0.4)).toBe(true);
  expect(persisted.at(-1)).toEqual({ status: 'completed', progress: 1 });
  expect(firstPageUpdates).toContain(0.4);
});

test('media task coordinator deduplicates concurrent exports for the same recording', async () => {
  let executions = 0;
  let finish: ((value: Blob) => void) | undefined;
  const executor = new Promise<Blob>((resolve) => { finish = resolve; });
  const coordinator = new MediaTaskCoordinator({
    persist: async () => undefined,
    runExport: async () => {
      executions += 1;
      return executor;
    },
  });
  const input = {
    recordingId: 'recording-1',
    configSnapshot: { format: 'mp4', aspectRatio: '16:9' },
  };

  const first = coordinator.startExport(input);
  const duplicate = coordinator.startExport(input);
  expect(first).toBe(duplicate);
  expect(executions).toBe(1);

  finish?.(new Blob(['video']));
  await first;
});

test('media task coordinator hydrates interrupted work as paused without losing checkpoints', () => {
  const coordinator = new MediaTaskCoordinator({
    persist: async () => undefined,
    runExport: async () => new Blob(),
    now: () => 50,
  });
  coordinator.hydrate([{
    id: 'task-1',
    recordingId: 'recording-1',
    kind: 'export',
    status: 'running',
    progress: 0.6,
    checkpoint: { segmentIndex: 4, processedFrames: 900 },
    configSnapshot: { format: 'mp4' },
    createdAt: 10,
    updatedAt: 20,
  }]);

  expect(coordinator.snapshot()).toMatchObject([{
    id: 'task-1',
    status: 'paused',
    progress: 0.6,
    checkpoint: { segmentIndex: 4, processedFrames: 900 },
    configSnapshot: { format: 'mp4' },
    updatedAt: 50,
  }]);
});

test('restarting a paused export keeps its task id and immutable config snapshot', async () => {
  const inputs: Array<{ recordingId: string; configSnapshot: object }> = [];
  const coordinator = new MediaTaskCoordinator({
    persist: async () => undefined,
    runExport: async (input) => {
      inputs.push(input);
      return new Blob(['done']);
    },
    now: () => 100,
    createId: () => 'new-task',
  });
  coordinator.hydrate([{
    id: 'paused-task', recordingId: 'recording-1', kind: 'export', status: 'paused',
    progress: 0.4, createdAt: 1, updatedAt: 2,
    configSnapshot: { format: 'mp4', aspectRatio: '16:9' },
  }]);
  const result = await coordinator.startExport({ recordingId: 'recording-1', configSnapshot: { format: 'webm' } });
  expect(result.id).toBe('paused-task');
  expect(inputs).toEqual([{ recordingId: 'recording-1', configSnapshot: { format: 'mp4', aspectRatio: '16:9' } }]);
});

test('recording lifecycle survives view detachment and finalizes only once', async () => {
  let stops = 0;
  const session = {
    recordingId: 'recording-1',
    stop: async (status?: 'done' | 'interrupted') => {
      stops += 1;
      return { id: 'recording-1', status: status ?? 'done' };
    },
  };
  const lifecycle = new RecordingLifecycleCoordinator<typeof session>();
  lifecycle.attach(session);
  lifecycle.detachView();
  expect(lifecycle.activeSession()).toBe(session);

  const first = lifecycle.stop('done');
  const duplicate = lifecycle.stop('done');
  expect(first).toBe(duplicate);
  await first;
  expect(stops).toBe(1);
  expect(lifecycle.activeSession()).toBeNull();
});

test('recording lifecycle records an interrupted close distinctly from a normal stop', async () => {
  const statuses: Array<'done' | 'interrupted' | undefined> = [];
  const session = {
    recordingId: 'recording-1',
    stop: async (status?: 'done' | 'interrupted') => {
      statuses.push(status);
      return { id: 'recording-1', status: status ?? 'done' };
    },
  };
  const lifecycle = new RecordingLifecycleCoordinator<typeof session>();
  lifecycle.attach(session);
  await lifecycle.stop('interrupted');
  expect(statuses).toEqual(['interrupted']);
});

test('audio waveform downsampling preserves absolute peaks per time bucket', () => {
  const peaks = downsampleAudioPeaks(
    new Float32Array([0.1, -0.8, 0.4, 0.2, -0.3, 0.9, -0.1, 0.5]),
    4,
  );
  expect(peaks).toEqual([0.8, 0.4, 0.9, 0.5]);
});

test('preview playback intent is applied when the display source attaches after play starts', async () => {
  const calls: Array<{ playing: boolean; timeMs: number }> = [];
  const registry = new PreviewPlaybackRegistry();
  registry.setIntent('recording-1', true, 1_250);
  await registry.attach('recording-1', {
    setPlayback: async (playing, timeMs) => { calls.push({ playing, timeMs }); },
  });
  expect(calls).toEqual([{ playing: true, timeMs: 1_250 }]);

  registry.setIntent('recording-1', false, 2_000);
  expect(calls.at(-1)).toEqual({ playing: false, timeMs: 2_000 });
});

test('manual autozoom resolves a visible crop and clamps focus at the content edge', () => {
  expect(resolveFrameTransform({
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    zoom: { scale: 2, cx: 1, cy: 1 },
  })).toEqual({
    source: { x: 960, y: 540, width: 960, height: 540 },
    destination: { x: 0, y: 0, width: 1920, height: 1080 },
  });
});

test('private media paths are user scoped and large-job submit payloads contain no blobs', () => {
  expect(resolvePrivateUploadMode(7_999_999)).toBe('direct');
  expect(resolvePrivateUploadMode(8 * 1024 * 1024)).toBe('tus');
  expect(buildPrivateMediaPath('user-1', 'recording-1', 'asr', 'audio.webm'))
    .toBe('user-1/recording-1/jobs/asr/audio.webm');

  expect(parseMediaSubmitPayload({
    recordingId: 'recording-1',
    assetPath: 'user-1/recording-1/jobs/asr/audio.webm',
    bytes: 125_000_000,
    mimeType: 'audio/webm',
  })).toMatchObject({ recordingId: 'recording-1', bytes: 125_000_000 });

  expect(() => parseMediaSubmitPayload({ recordingId: 'recording-1', audio: new Blob(['x']) }))
    .toThrow('asset_path_required');

  const dubbing = parseMediaSubmitPayload({
    recordingId: 'recording-1',
    assetPath: 'user-1/recording-1/jobs/dubbing/audio.webm',
    bytes: 125_000_000,
    mimeType: 'audio/webm',
    cameraAssetPath: 'user-1/recording-1/jobs/dubbing/camera.webm',
    cameraBytes: 350_000_000,
    cameraMimeType: 'video/webm',
  });
  expect(dubbing.cameraAssetPath).toContain('/jobs/dubbing/');
  expect(dubbing.cameraBytes).toBe(350_000_000);
});

test('large export downloads retain their blob URL long enough for the browser to acquire it', () => {
  expect(DOWNLOAD_URL_REVOKE_DELAY_MS).toBeGreaterThanOrEqual(30_000);
});

test('keeps the WebCodecs video path when direct browser audio encoding is unavailable', () => {
  expect(resolveWebCodecsAudioMode({
    hasAudio: true,
    audioEncoderAvailable: false,
    audioConfigSupported: false,
  })).toBe('remux');
  expect(resolveWebCodecsAudioMode({
    hasAudio: true,
    audioEncoderAvailable: true,
    audioConfigSupported: true,
  })).toBe('direct');
  expect(resolveWebCodecsAudioMode({
    hasAudio: false,
    audioEncoderAvailable: false,
    audioConfigSupported: false,
  })).toBe('none');
});

test('encoder backpressure does not depend on throttled page timers', async () => {
  let flushes = 0;
  await drainEncoderBackpressure({
    encodeQueueSize: 9,
    flush: async () => { flushes += 1; },
  }, 8);
  expect(flushes).toBe(1);

  await drainEncoderBackpressure({
    encodeQueueSize: 3,
    flush: async () => { flushes += 1; },
  }, 8);
  expect(flushes).toBe(1);
});

test('encoder backpressure aborts before touching a reclaimed codec', async () => {
  let flushes = 0;
  const controller = new AbortController();
  controller.abort();

  await expect(drainEncoderBackpressure({
    encodeQueueSize: 99,
    flush: async () => { flushes += 1; },
  }, 8, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(flushes).toBe(0);
});

test('export diagnostics reports stage timing, frame throughput, and remaining time', () => {
  let now = 0;
  const diagnostics = createExportDiagnostics({
    recordingId: 'recording-1',
    totalFrames: 100,
    now: () => now,
    wallClock: () => 1_000,
  });
  diagnostics.setEncoderPath('webcodecs-h264');
  diagnostics.setPhase('loading_media');
  now = 100;
  diagnostics.setPhase('rendering_frames');
  diagnostics.setDecodedSourceFrames(80);
  diagnostics.setProcessedFrames(25);
  diagnostics.setProgress(0.25);
  now = 1_100;

  const snapshot = diagnostics.snapshot();
  expect(snapshot.encoderPath).toBe('webcodecs-h264');
  expect(snapshot.processedFrames).toBe(25);
  expect(snapshot.decodedSourceFrames).toBe(80);
  expect(snapshot.throughputFps).toBeCloseTo(25, 4);
  expect(snapshot.estimatedRemainingMs).toBe(3_000);

  const report = diagnostics.complete();
  expect(report.stageDurationsMs.loading_media).toBe(100);
  expect(report.stageDurationsMs.rendering_frames).toBe(1_000);
  expect(report.elapsedMs).toBe(1_100);
});

test('software export batches bound JPEG residency without dropping tail frames', () => {
  const full = planExportFrameBatches(2_250, 15);
  expect(full).toHaveLength(15);
  expect(full[0]).toEqual({ start: 0, endExclusive: 150 });
  expect(full.at(-1)).toEqual({ start: 2_100, endExclusive: 2_250 });

  expect(planExportFrameBatches(317, 15)).toEqual([
    { start: 0, endExclusive: 150 },
    { start: 150, endExclusive: 300 },
    { start: 300, endExclusive: 317 },
  ]);
});

test('preview render budget follows visible pixels without changing the composition ratio', () => {
  expect(resolvePreviewRenderSize({
    compositionWidth: 1920,
    compositionHeight: 1080,
    displayWidth: 640,
    displayHeight: 360,
    devicePixelRatio: 2,
  })).toEqual({ width: 1280, height: 720 });

  expect(resolvePreviewRenderSize({
    compositionWidth: 1080,
    compositionHeight: 1920,
    displayWidth: 270,
    displayHeight: 480,
    devicePixelRatio: 2,
  })).toEqual({ width: 540, height: 960 });

  expect(resolvePreviewRenderSize({
    compositionWidth: 3840,
    compositionHeight: 2160,
    displayWidth: 1920,
    displayHeight: 1080,
    devicePixelRatio: 2,
  })).toEqual({ width: 1440, height: 810 });
});

test('cursor worker shutdown settles pending focus requests instead of hanging Autozoom', async () => {
  const pending = new PendingFocusRequests();
  const first = pending.create(1, 1200, 10_000);
  const second = pending.create(2, 1300, 10_000);

  pending.failAll();

  await expect(first).resolves.toEqual({ timestamp: 1200, x: 0.5, y: 0.5, confidence: 0 });
  await expect(second).resolves.toEqual({ timestamp: 1300, x: 0.5, y: 0.5, confidence: 0 });
  expect(pending.size).toBe(0);
});
