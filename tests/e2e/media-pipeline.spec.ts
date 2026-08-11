import { expect, test } from '@playwright/test';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { LatestTaskRunner } from '@/lib/latestTaskRunner';
import { buildPrivateMediaPath, parseMediaSubmitPayload } from '@/lib/privateMedia';
import {
  createMp4AudioChunkBuffer,
  createMp4VideoChunkWriter,
  drainEncoderBackpressure,
  resolveWebCodecsAudioMode,
} from '@/services/webCodecsExport';
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
import {
  createSeekableDisplayFrameSource,
  waitForDisplaySourceStage,
  type DisplayFrameSource,
} from '@/services/displayFrameSource';
import { ChunkWriteBatcher } from '@/services/mediaRecorderHealth';
import { dataUrlToBlob } from '@/services/workspaceShellCapture';
import { resolveHighlightFrameState } from '@/services/highlightEffects';
import {
  buildLocalKeyPointMotions,
  alignKeyPointMotionLines,
  migrateKeyPointMotionSegment,
  resolveKeyPointDrawerLayout,
  resolveKeyPointDrawerState,
  tokenizeKeyPointLine,
} from '@/services/keyPointMotion';
import { parseKeyPointMotionResponse } from '@/services/keyPointMotionSchema';
import { resolveEnhancedAudioSelection } from '@/services/audioEnhancement';
import { projectHighlightAperture } from '@/services/editorEffectsRenderer';
import { assembleTimedPcm16Wav, hasAudiblePcm16Audio, parsePcm16Wav } from '@/lib/dubbingAudio';
import { moveSegment, normalizeSegmentSequence, outputToSource, sourceToOutput } from '@/utils/segments';
import type { EnhancedAudioTrack, HighlightEffectSegment, KeyPointMotionSegment } from '@/types/recording';

function createFloat32Wav(samples: Float32Array, sampleRate = 24_000): Uint8Array {
  const bytes = new Uint8Array(44 + samples.byteLength);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.byteLength, true);
  for (let index = 0; index < samples.length; index += 1) view.setFloat32(44 + index * 4, samples[index], true);
  return bytes;
}

test('Kokoro float32 WAV chunks are normalized into audible PCM16 dubbing audio', () => {
  const floatSamples = Float32Array.from({ length: 2_400 }, (_, index) => Math.sin(index / 24_000 * Math.PI * 2 * 440) * 0.35);
  const assembled = assembleTimedPcm16Wav([{ startMs: 250, wav: createFloat32Wav(floatSamples) }], 500);
  const parsed = parsePcm16Wav(assembled);

  expect(parsed.sampleRate).toBe(24_000);
  expect(parsed.channels).toBe(1);
  expect(parsed.durationMs).toBeCloseTo(500, 0);
  expect(hasAudiblePcm16Audio(assembled)).toBe(true);
});

test('highlight surround animation closes from the full frame toward the selected region', () => {
  const segment: HighlightEffectSegment = {
    id: 'hi-1',
    start: 1_000,
    end: 3_200,
    region: { x: 0.25, y: 0.2, width: 0.4, height: 0.3 },
    enabled: { spotlight: true, focusFrame: true, cursorHalo: true, textCallout: true },
    spotlightOpacity: 0.52,
    calloutText: 'One clear idea',
    transition: { enterMs: 600, exitMs: 420, easing: 'easeInOutCubic', preset: 'surround' },
    schemaVersion: 1,
  };

  const start = resolveHighlightFrameState(segment, 1_000);
  const middle = resolveHighlightFrameState(segment, 1_300);
  const hold = resolveHighlightFrameState(segment, 1_800);
  const exit = resolveHighlightFrameState(segment, 3_000);

  expect(start.aperture).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  expect(start.maskOpacity).toBe(0);
  expect(middle.aperture.x).toBeGreaterThan(0);
  expect(middle.aperture.x).toBeLessThan(segment.region.x);
  expect(hold.aperture).toEqual(segment.region);
  expect(hold.calloutOpacity).toBe(1);
  expect(exit.aperture.width).toBeGreaterThan(segment.region.width);
  expect(exit.maskOpacity).toBeLessThan(segment.spotlightOpacity);
});

test('highlight region follows the same content transform as Autozoom without changing the frame', () => {
  const bounds = { x: 100, y: 50, width: 800, height: 450 };
  const projected = projectHighlightAperture(
    bounds,
    { x: 0.4, y: 0.35, width: 0.2, height: 0.2 },
    { scale: 2, cx: 0.5, cy: 0.5 },
  );

  expect(projected).toEqual({ x: 340, y: 140, width: 320, height: 180 });
  expect(bounds).toEqual({ x: 100, y: 50, width: 800, height: 450 });
});

test('local key point fallback creates chapter and interior drawers without copying caption sentences', () => {
  const motions = buildLocalKeyPointMotions([
    { index: 1, startMs: 0, endMs: 2_000, text: 'First, define the problem.' },
    { index: 2, startMs: 2_200, endMs: 5_500, text: 'Then compare the available options.' },
    { index: 3, startMs: 8_000, endMs: 11_000, text: 'Finally, choose the simplest reliable path.' },
  ], 12_000, 'en');

  expect(motions.length).toBeGreaterThanOrEqual(2);
  expect(motions[0]).toMatchObject({ kind: 'chapter_drawer', generationSource: 'local', enabled: true, schemaVersion: 3 });
  expect(motions.every((motion) => motion.lines?.length === 1)).toBe(true);
  expect(motions.slice(1).every((motion) => motion.kind === 'key_points_drawer')).toBe(true);
  expect(motions.flatMap((motion) => [motion.title, ...motion.bullets])).not.toContain('First, define the problem.');
  expect(motions.every((motion) => motion.start >= 0 && motion.end <= 12_000 && motion.end > motion.start)).toBe(true);
  expect(motions.slice(1).every((motion, index) => motion.start >= motions[index].end)).toBe(true);
});

test('AI key point response creates B at chapter openings and C for concise interior points', () => {
  const cues = [
    { index: 1, startMs: 0, endMs: 2_000, text: '先理解用户真正想解决的问题。' },
    { index: 2, startMs: 2_100, endMs: 5_000, text: '第一步是降低首次录制的操作门槛。' },
    { index: 3, startMs: 5_100, endMs: 8_000, text: '完成后提供即时反馈并支持一键发布。' },
  ];
  const motions = parseKeyPointMotionResponse(JSON.stringify({
    chapters: [{
      title: '增长路径',
      startCueIndex: 1,
      endCueIndex: 3,
      titleAnchorCueIndex: 1,
      openingPoints: [
        { text: '理解用户', anchorCueIndex: 1 },
      ],
      moments: [
        {
          startCueIndex: 2,
          endCueIndex: 3,
          points: [
            { text: '降低门槛', anchorCueIndex: 2 },
            { text: '即时反馈', anchorCueIndex: 3 },
            { text: '一键发布', anchorCueIndex: 3 },
            { text: '这是一整句不应进入画面的字幕内容', anchorCueIndex: 3 },
          ],
        },
      ],
    }],
  }), cues, 10_000, 'zh');

  expect(motions).toHaveLength(2);
  expect(motions[0]).toMatchObject({
    kind: 'chapter_drawer', title: '增长路径', bullets: ['理解用户'],
    sourceCueStart: 1, sourceCueEnd: 3, generationSource: 'deepseek', schemaVersion: 3,
  });
  expect(motions[0].lines).toEqual([
    expect.objectContaining({ role: 'title', text: '增长路径', anchorCueIndex: 1 }),
    expect.objectContaining({ role: 'point', text: '理解用户', anchorCueIndex: 1 }),
  ]);
  expect(motions[0].start).toBe(Math.max(0, motions[0].lines![0].revealAtMs - 150));
  expect(motions[1]).toMatchObject({
    kind: 'key_points_drawer', title: '降低门槛', bullets: ['即时反馈', '一键发布'],
    sourceCueStart: 2, sourceCueEnd: 3, generationSource: 'deepseek', schemaVersion: 3,
  });
  expect(motions.flatMap((motion) => [motion.title, ...motion.bullets])).not.toContain('这是一整句不应进入画面的字幕内容');
});

test('semantic key point lines reveal with their caption cue instead of the drawer start', () => {
  const segment: KeyPointMotionSegment = {
    id: 'semantic', start: 850, end: 12_800, kind: 'chapter_drawer', title: '章节开始', bullets: ['语义要点'],
    lines: [
      { id: 'title', role: 'title', text: '章节开始', anchorCueIndex: 1, revealAtMs: 1_000, matchKind: 'exact' },
      { id: 'point', role: 'point', text: '语义要点', anchorCueIndex: 8, revealAtMs: 10_000, matchKind: 'semantic' },
    ],
    placement: 'right', sourceCueStart: 1, sourceCueEnd: 8,
    transition: { enterMs: 280, exitMs: 420, easing: 'easeInOutCubic' },
    enabled: true, generationSource: 'deepseek', schemaVersion: 3,
  };

  const early = resolveKeyPointDrawerState(segment, 5_000, [2, 2]);
  const entering = resolveKeyPointDrawerState(segment, 10_070, [2, 2]);
  expect(early.lines[0].some((token) => token.opacity > 0)).toBe(true);
  expect(early.lines[1].every((token) => token.opacity === 0)).toBe(true);
  expect(entering.lines[1][0].opacity).toBeGreaterThan(0);
  expect(entering.lines[1][1].opacity).toBe(0);
});

test('line alignment refines exact text locally and bounds semantic cue timing', () => {
  const cues = [
    { index: 4, startMs: 8_000, endMs: 10_000, text: '先解释背景，然后立即发布作品。' },
    { index: 5, startMs: 10_000, endMs: 12_000, text: '这样最终能够更快完成成品。' },
  ];
  const lines = alignKeyPointMotionLines({
    segmentId: 'aligned',
    drafts: [
      { role: 'title', text: '立即发布', anchorCueIndex: 999 },
      { role: 'point', text: '交付提速', anchorCueIndex: 5 },
    ],
    cues,
    sourceCueStart: 4,
    sourceCueEnd: 5,
  });

  expect(lines[0]).toMatchObject({ anchorCueIndex: 4, matchKind: 'exact' });
  expect(lines[0].revealAtMs).toBeGreaterThan(8_000);
  expect(lines[0].revealAtMs).toBeLessThan(10_000);
  expect(lines[1]).toMatchObject({ anchorCueIndex: 5, matchKind: 'semantic' });
  expect(lines[1].revealAtMs).toBeGreaterThanOrEqual(10_080);
  expect(lines[1].revealAtMs).toBeLessThanOrEqual(10_320);
});

test('key point drawer state enters and exits through its own edge and staggers words upward', () => {
  const right: KeyPointMotionSegment = {
    id: 'right', start: 0, end: 3_000, kind: 'key_points_drawer', title: '降低门槛', bullets: ['即时反馈'],
    placement: 'right', sourceCueStart: 1, sourceCueEnd: 2,
    transition: { enterMs: 600, exitMs: 420, easing: 'easeInOutCubic' },
    enabled: true, generationSource: 'deepseek', schemaVersion: 2,
  };
  const left = { ...right, id: 'left', placement: 'left' as const };

  const rightEntering = resolveKeyPointDrawerState(right, 260, 4);
  const leftEntering = resolveKeyPointDrawerState(left, 260, 4);
  const rightExiting = resolveKeyPointDrawerState(right, 2_850, 4);
  expect(rightEntering.drawerTranslateX).toBeGreaterThan(0);
  expect(leftEntering.drawerTranslateX).toBeLessThan(0);
  expect(rightExiting.drawerTranslateX).toBeGreaterThan(0);
  expect(rightEntering.tokens[0].translateY).toBeLessThan(rightEntering.tokens[3].translateY);
  expect(rightEntering.tokens[0].opacity).toBeGreaterThan(rightEntering.tokens[3].opacity);

  expect(resolveKeyPointDrawerLayout({ x: 10, y: 20, width: 800, height: 450 }, 'right')).toEqual({
    x: 410, y: 20, width: 400, height: 450, axis: 'horizontal', edge: 'right',
  });
  expect(resolveKeyPointDrawerLayout({ x: 10, y: 20, width: 800, height: 450 }, 'top')).toEqual({
    x: 10, y: 20, width: 800, height: 203, axis: 'vertical', edge: 'top',
  });
});

test('key point tokenization reveals semantic words instead of whole lines', () => {
  expect(tokenizeKeyPointLine('降低门槛', 'zh')).toEqual(['降低', '门槛']);
  expect(tokenizeKeyPointLine('Ship publish ready videos', 'en')).toEqual(['Ship', 'publish', 'ready', 'videos']);
});

test('schema v1 key point cards migrate to schema v3 semantic drawers', () => {
  const migrated = migrateKeyPointMotionSegment({
    id: 'legacy', start: 100, end: 2_500, title: 'Opening', bullets: ['First'], kind: 'chapter_title', placement: 'right',
    sourceCueStart: 1, sourceCueEnd: 2, transition: { enterMs: 360, exitMs: 240, easing: 'easeInOutCubic' },
    enabled: true, generationSource: 'local', schemaVersion: 1,
  });

  expect(migrated).toMatchObject({ id: 'legacy', kind: 'chapter_drawer', schemaVersion: 3, placement: 'right' });
  expect(migrated.lines).toEqual([
    expect.objectContaining({ role: 'title', text: 'Opening', revealAtMs: 250, matchKind: 'fallback' }),
    expect.objectContaining({ role: 'point', text: 'First', revealAtMs: 430, matchKind: 'fallback' }),
  ]);
});

test('enhanced audio replaces the original only when the derived track is ready and matches the source', () => {
  const original = new Blob(['original'], { type: 'audio/webm' });
  const enhanced = new Blob(['enhanced'], { type: 'audio/wav' });
  const track: EnhancedAudioTrack = {
    id: 'noise-standard',
    recordingId: 'rec-1',
    sourceFingerprint: 'source-a',
    mode: 'standard',
    modelVersion: 'standard-v1',
    status: 'ready',
    durationMs: 4_000,
    audioBlob: enhanced,
    createdAt: 1,
  };

  expect(resolveEnhancedAudioSelection(original, [track], 'noise-standard', 'source-a')).toEqual({
    blob: enhanced,
    track,
  });
  expect(resolveEnhancedAudioSelection(original, [track], 'noise-standard', 'source-b')).toEqual({
    blob: original,
    track: undefined,
  });
  expect(resolveEnhancedAudioSelection(original, [{ ...track, status: 'failed' }], 'noise-standard', 'source-a')).toEqual({
    blob: original,
    track: undefined,
  });
});

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

test('MP4 export writer never passes reordered H.264 PTS through as DTS', () => {
  const writes: Array<{ pts: number; offset: number }> = [];
  const writer = createMp4VideoChunkWriter(15, {
    addVideoChunk: (_chunk, _meta, pts, offset) => writes.push({ pts, offset }),
  });

  for (const pts of [0, 66_667, 133_334, 441_179, 394_739, 507_846]) {
    writer({ timestamp: pts }, undefined);
  }

  const decodeTimestamps = writes.map(({ pts, offset }) => pts - offset);
  expect(decodeTimestamps).toEqual([0, 66_667, 133_334, 200_001, 266_668, 333_335]);
  expect(decodeTimestamps.every((value, index) => index === 0 || value > decodeTimestamps[index - 1])).toBe(true);
});

test('real MP4 muxer accepts the reordered H.264 regression sequence', () => {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    fastStart: 'in-memory',
    video: { codec: 'avc', width: 1920, height: 1080 },
  });
  const writer = createMp4VideoChunkWriter(15, {
    addVideoChunk: (chunk, _meta, timestamp, compositionTimeOffset) => {
      muxer.addVideoChunkRaw(
        new Uint8Array([0, 0, 0, 1, chunk.index]),
        chunk.index === 0 ? 'key' : 'delta',
        timestamp,
        66_667,
        undefined,
        compositionTimeOffset,
      );
    },
  });

  expect(() => {
    [0, 66_667, 133_334, 441_179, 394_739, 507_846].forEach((timestamp, index) => {
      writer({ timestamp, index }, undefined);
    });
  }).not.toThrow();
});

test('MP4 audio chunks are sorted before muxing when AAC callbacks arrive out of order', () => {
  const writes: number[] = [];
  let lastTimestamp = -1;
  const buffer = createMp4AudioChunkBuffer({
    addAudioChunk: (_chunk, _meta, timestamp) => {
      if (timestamp <= lastTimestamp) {
        throw new Error(`non_monotonic_audio_timestamp:${lastTimestamp}:${timestamp}`);
      }
      lastTimestamp = timestamp;
      writes.push(timestamp);
    },
  });

  for (const timestamp of [0, 21_333, 42_667, 405_333, 362_667, 384_000, 426_667]) {
    buffer.push({ timestamp }, undefined);
  }

  expect(() => buffer.flush()).not.toThrow();
  expect(writes).toEqual([0, 21_333, 42_667, 362_667, 384_000, 405_333, 426_667]);
});

test('edited clip sequence preserves split boundaries and user-defined playback order', () => {
  const reordered = moveSegment([
    { start: 0, end: 4_000 },
    { start: 4_000, end: 8_000 },
    { start: 8_000, end: 12_000 },
  ], 0, 2);
  const sequence = normalizeSegmentSequence(reordered, 12_000);

  expect(sequence).toEqual([
    { start: 4_000, end: 8_000 },
    { start: 8_000, end: 12_000 },
    { start: 0, end: 4_000 },
  ]);
  expect(outputToSource(sequence, 500)).toBe(4_500);
  expect(sourceToOutput(sequence, 500)).toBe(8_500);
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

test('preview falls back to local decoding when an HTML video seek never completes', async () => {
  let currentTime = 0;
  const video = {
    muted: false,
    playsInline: false,
    preload: '',
    src: '',
    paused: true,
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
    duration: Number.POSITIVE_INFINITY,
    get currentTime() { return currentTime; },
    set currentTime(value: number) { currentTime = value; },
    onloadedmetadata: null,
    onloadeddata: null,
    onerror: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    pause: () => undefined,
    play: async () => undefined,
    removeAttribute: () => undefined,
    load: () => undefined,
  } as unknown as HTMLVideoElement;
  const fallbackFrame = { width: 1280, height: 720 } as unknown as CanvasImageSource;
  let fallbackCalls = 0;
  const fallback: DisplayFrameSource = {
    width: 1280,
    height: 720,
    decoderPath: 'mediabunny-stream',
    getFrameAt: async () => { fallbackCalls += 1; return fallbackFrame; },
    close: () => undefined,
  };
  const source = createSeekableDisplayFrameSource(new Blob(['non-seekable-webm']), {
    metadataTimeoutMs: 50,
    seekTimeoutMs: 5,
    videoFactory: () => video,
    objectUrlFactory: () => 'blob:test-display-source',
    revokeObjectUrl: () => undefined,
    fallbackFactory: async () => fallback,
  });
  video.onloadeddata?.(new Event('loadeddata'));

  await expect(source.setPlayback?.(true, 1_000)).resolves.toBeUndefined();
  await expect(source.getFrameAt(1_000)).resolves.toBe(fallbackFrame);
  expect(source.decoderPath).toBe('mediabunny-stream');
  expect(fallbackCalls).toBe(1);
  source.close();
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
