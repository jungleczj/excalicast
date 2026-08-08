import { expect, test } from '@playwright/test';
import { formatAutoEditProgress } from '@/components/editor/AutoEditControl';
import {
  AUTO_EDIT_ANALYZER_VERSION,
  createMemoryAutoEditCache,
  analyzeRecordingForAutoEdit,
  type AutoEditMediaTracks,
  type AutoEditProgress,
} from '@/services/autoEditAnalyzer';
import {
  analyzeSequentialSceneFrames,
  type SequentialSceneFrame,
} from '@/services/pysceneDetectAdapter';
import { analyzePcmChunksInWorker } from '@/services/autoEditAudioWorker';

function pixels(level: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(64 * 36 * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = level;
    data[index + 1] = level;
    data[index + 2] = level;
    data[index + 3] = 255;
  }
  return data;
}

async function* longSequentialFrames(params: {
  durationMs: number;
  stepMs: number;
  seen: number[];
}): AsyncGenerator<SequentialSceneFrame> {
  for (let timeMs = 0; timeMs <= params.durationMs; timeMs += params.stepMs) {
    params.seen.push(timeMs);
    yield {
      timeMs,
      pixels: pixels(timeMs >= params.durationMs / 2 ? 235 : 20),
    };
  }
}

test('20 minute scene analysis consumes frames in order and keeps sampled work bounded', async () => {
  const seen: number[] = [];
  const result = await analyzeSequentialSceneFrames(
    longSequentialFrames({ durationMs: 20 * 60_000, stepMs: 100, seen }),
    20 * 60_000,
  );

  expect(seen.length).toBeGreaterThan(10_000);
  expect(seen.every((value, index) => index === 0 || value >= seen[index - 1])).toBe(true);
  expect(result.diagnostics.coarseSamples).toBeLessThanOrEqual(600);
  expect(result.diagnostics.retainedFineSamples).toBeLessThanOrEqual(2_400);
  expect(result.diagnostics.refinedSamples).toBeLessThan(result.diagnostics.retainedFineSamples);
  expect(result.transitions.some((transition) => Math.abs(transition.timeMs - 10 * 60_000) < 5_000)).toBe(true);
});

test('sequential scene analysis stops promptly when aborted', async () => {
  const controller = new AbortController();
  let yielded = 0;
  async function* frames(): AsyncGenerator<SequentialSceneFrame> {
    for (let timeMs = 0; timeMs < 20 * 60_000; timeMs += 100) {
      yielded += 1;
      if (yielded === 12) controller.abort();
      yield { timeMs, pixels: pixels(20) };
    }
  }

  await expect(analyzeSequentialSceneFrames(frames(), 20 * 60_000, {
    signal: controller.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(yielded).toBeLessThan(20);
});

test('long audio RMS analysis yields the event loop and preserves silence windows', async () => {
  let timerFired = false;
  const timer = setTimeout(() => { timerFired = true; }, 0);
  async function* chunks(): AsyncGenerator<Float32Array[]> {
    for (let chunk = 0; chunk < 80; chunk += 1) {
      const samples = new Float32Array(1_000).fill(chunk >= 20 && chunk < 50 ? 0 : 0.35);
      yield [samples];
    }
  }

  const result = await analyzePcmChunksInWorker({
    chunks: chunks(),
    sampleRate: 1_000,
    durationMs: 80_000,
  });
  clearTimeout(timer);

  expect(result.workerUsed).toBe(typeof Worker !== 'undefined');
  expect(timerFired).toBe(true);
  expect(result.levels.slice(1_000, 2_500).every((level) => level <= -90)).toBe(true);
  expect(result.levels.slice(0, 900).some((level) => level > -20)).toBe(true);
});

test('scene analysis detects sparse high-contrast canvas capture frames', async () => {
  async function* frames(): AsyncGenerator<SequentialSceneFrame> {
    yield { timeMs: 20, pixels: pixels(15) };
    yield { timeMs: 740, pixels: pixels(220) };
    yield { timeMs: 1_460, pixels: pixels(70) };
  }
  const result = await analyzeSequentialSceneFrames(frames(), 2_180);
  expect(result.transitions.length).toBeGreaterThan(0);
  expect(result.transitions[0].timeMs).toBe(740);
});

test('progressive ChatCut emits silence first and keeps it when scene refinement fails', async () => {
  const audio = {
    duration: 10,
    length: 10_000,
    numberOfChannels: 1,
    sampleRate: 1_000,
    getChannelData: () => {
      const samples = new Float32Array(10_000).fill(0.35);
      samples.fill(0, 2_000, 4_000);
      return samples;
    },
  } as unknown as AudioBuffer;
  const media: AutoEditMediaTracks = {
    audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
    screenBlob: new Blob(['screen'], { type: 'video/webm' }),
    cameraBlob: null,
  };
  const stages: string[] = [];
  const partials: string[] = [];
  let loads = 0;

  const result = await analyzeRecordingForAutoEdit({
    recordingId: 'long-recording',
    durationMs: 10_000,
    preset: 'walkthrough',
    mediaSignature: 'fixture-v1',
    loadMedia: async () => { loads += 1; return media; },
    decodeAudio: async () => audio,
    detectScenes: async () => { throw new Error('scene decoder failed'); },
    onProgress: (stage) => stages.push(stage),
    onStageResult: (stage) => partials.push(stage),
  });

  expect(loads).toBe(1);
  expect(partials[0]).toBe('silence');
  expect(stages).toContain('reading');
  expect(stages).toContain('audio');
  expect(result.removedMs).toBeGreaterThan(0);
  expect(result.sceneStatus).toBe('failed');
  expect(result.segments).toEqual(expect.arrayContaining([
    expect.objectContaining({ start: 0 }),
  ]));
});

test('scene timeout returns the silence result even when the decoder ignores abort', async () => {
  const audio = {
    duration: 4,
    length: 4_000,
    numberOfChannels: 1,
    sampleRate: 1_000,
    getChannelData: () => new Float32Array(4_000).fill(0.3),
  } as unknown as AudioBuffer;
  const analysis = analyzeRecordingForAutoEdit({
    recordingId: 'hung-scene-recording',
    durationMs: 4_000,
    preset: 'walkthrough',
    mediaSignature: 'hung-v1',
    sceneTimeoutMs: 20,
    loadMedia: async () => ({
      audioBlob: new Blob(['audio']),
      screenBlob: new Blob(['screen']),
      cameraBlob: null,
    }),
    decodeAudio: async () => audio,
    detectScenes: async () => new Promise<never>(() => undefined),
  });

  const result = await Promise.race([
    analysis,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('analysis_did_not_timeout')), 250)),
  ]);
  expect(result.sceneStatus).toBe('timed_out');
});

test('cache key includes recording, media signature, and analyzer version', async () => {
  const cache = createMemoryAutoEditCache();
  const audio = {
    duration: 2,
    length: 2_000,
    numberOfChannels: 1,
    sampleRate: 1_000,
    getChannelData: () => new Float32Array(2_000).fill(0.4),
  } as unknown as AudioBuffer;
  let loads = 0;
  const run = () => analyzeRecordingForAutoEdit({
    recordingId: 'cached-recording',
    durationMs: 2_000,
    preset: 'walkthrough' as const,
    mediaSignature: 'media-a',
    cache,
    loadMedia: async () => {
      loads += 1;
      return {
        audioBlob: new Blob(['audio']),
        screenBlob: new Blob(['screen']),
        cameraBlob: null,
      };
    },
    decodeAudio: async () => audio,
    detectScenes: async () => [],
  });

  await run();
  await run();
  expect(loads).toBe(1);
  expect(cache.keys()).toEqual([
    `cached-recording::media-a::${AUTO_EDIT_ANALYZER_VERSION}`,
  ]);
});

test('AutoEdit control shows stage progress, ETA, and a cancel action', () => {
  const progress: AutoEditProgress = { stage: 'scene_coarse', progress: 0.42, etaMs: 12_000 };
  expect(formatAutoEditProgress(progress)).toEqual({
    stageLabel: 'Scene scan',
    percentLabel: '42%',
    etaLabel: '12s left',
    cancellable: true,
  });
  expect(formatAutoEditProgress(progress, 'zh')).toEqual({
    stageLabel: '场景粗扫',
    percentLabel: '42%',
    etaLabel: '剩余 12 秒',
    cancellable: true,
  });
});
