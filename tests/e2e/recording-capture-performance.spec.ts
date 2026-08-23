import { expect, test } from '@playwright/test';
import {
  CapturePressureController,
  captureProfileFor,
  preferredVideoEncoderConfigs,
  selectCapturePipeline,
} from '../../src/services/recordingCapturePolicy';
import { prepareDisplayRecordingStream } from '../../src/services/displayCaptureRecorder';
import {
  loadScreenRecordingBlob,
  recoverCommittedMediaBlob,
  recordingMediaPath,
} from '../../src/services/recordingMediaStore';

test('adaptive capture caps a 4K display at 1440p30 instead of recording 4K60', () => {
  expect(captureProfileFor({ width: 3840, height: 2160, frameRate: 60 }, 'adaptive')).toEqual({
    width: 2560,
    height: 1440,
    frameRate: 30,
    videoBitsPerSecond: 14_000_000,
  });
});

test('motion capture allows 60fps only at 1080p', () => {
  expect(captureProfileFor({ width: 3840, height: 2160, frameRate: 120 }, 'motion-60')).toEqual({
    width: 1920,
    height: 1080,
    frameRate: 60,
    videoBitsPerSecond: 16_000_000,
  });
});

test('Mac encoder candidates prefer realtime hardware AVC before portable fallbacks', () => {
  expect(preferredVideoEncoderConfigs({
    width: 2560,
    height: 1440,
    frameRate: 30,
    videoBitsPerSecond: 14_000_000,
  })[0]).toMatchObject({
    codec: 'avc1.640033',
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'realtime',
    bitrateMode: 'variable',
  });
});

test('WebCodecs fast path requires encoder, track processor, OPFS and workers', () => {
  expect(selectCapturePipeline({
    videoEncoder: true,
    trackProcessor: true,
    opfs: true,
    worker: true,
  })).toBe('webcodecs-opfs');
  expect(selectCapturePipeline({
    videoEncoder: true,
    trackProcessor: true,
    opfs: false,
    worker: true,
  })).toBe('mediarecorder-fallback');
});

test('selected-area capture records the constrained source directly and defers crop to export', async () => {
  const stream = { getTracks: () => [] } as unknown as MediaStream;
  let createdElements = 0;
  const prepared = await prepareDisplayRecordingStream(stream, {
    kind: 'selected_area',
    sourceCropWindow: { rx: 0.1, ry: 0.2, rw: 0.5, rh: 0.4 },
  }, {
    createElement: () => {
      createdElements += 1;
      throw new Error('selected-area capture must not create a canvas');
    },
  });

  expect(prepared.stream).toBe(stream);
  expect(prepared.cleanup).toBeUndefined();
  expect(createdElements).toBe(0);
});

test('sustained encoder pressure degrades one level and never upgrades during a recording', () => {
  const controller = new CapturePressureController('A');
  const pressure = {
    encoderQueueSize: 3,
    pendingWriteBytes: 0,
    oldestWriteAgeMs: 0,
    mainThreadLagMs: 10,
    droppedFrames: 0,
  };

  expect(controller.observe(pressure, 1_000)).toEqual({ action: 'none', level: 'A' });
  expect(controller.observe(pressure, 2_100)).toEqual({ action: 'degrade', level: 'B' });
  expect(controller.observe({ ...pressure, encoderQueueSize: 0 }, 5_000)).toEqual({ action: 'none', level: 'B' });
});

test('the lowest capture level stops safely after ten seconds of unresolved pressure', () => {
  const controller = new CapturePressureController('D');
  const critical = {
    encoderQueueSize: 4,
    pendingWriteBytes: 70 * 1024 * 1024,
    oldestWriteAgeMs: 2_500,
    mainThreadLagMs: 120,
    droppedFrames: 10,
  };

  expect(controller.observe(critical, 10_000)).toEqual({ action: 'none', level: 'D' });
  expect(controller.observe(critical, 20_001)).toEqual({ action: 'stop', level: 'D' });
});

test('OPFS screen media is preferred over legacy IndexedDB chunks', async () => {
  expect(recordingMediaPath('recording-1', 'screen')).toBe('recordings/recording-1/screen.mp4');
  const opfsBlob = new Blob(['opfs'], { type: 'video/mp4' });
  const result = await loadScreenRecordingBlob({
    manifest: {
      pipeline: 'webcodecs-opfs',
      screen: {
        path: 'recordings/recording-1/screen.mp4',
        mimeType: 'video/mp4',
        bytes: 4,
        committedBytes: 4,
        fragments: 1,
        status: 'done',
      },
    },
    legacyChunks: [{ blob: new Blob(['legacy'], { type: 'video/webm' }) }],
    readOpfs: async () => opfsBlob,
  });

  expect(result).toBe(opfsBlob);
  expect(result?.type).toBe('video/mp4');
});

test('legacy screen chunks remain readable when OPFS is unavailable', async () => {
  const result = await loadScreenRecordingBlob({
    legacyChunks: [
      { blob: new Blob(['first'], { type: 'video/webm' }) },
      { blob: new Blob(['second'], { type: 'video/webm' }) },
    ],
    readOpfs: async () => null,
  });
  expect(await result?.text()).toBe('firstsecond');
  expect(result?.type).toBe('video/webm');
});

test('crash recovery discards an incomplete OPFS tail after the last committed fragment', async () => {
  const recovered = recoverCommittedMediaBlob(
    new Blob(['complete-tail'], { type: 'video/mp4' }),
    8,
    'video/mp4',
  );
  expect(await recovered.text()).toBe('complete');
  expect(recovered.type).toBe('video/mp4');
});
