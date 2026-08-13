import { expect, test } from '@playwright/test';
import { AUDIO_RECORDING_BITS_PER_SECOND, MIC_CONSTRAINTS } from '@/services/audioRecorder';
import { ChunkWriteBatcher } from '@/services/mediaRecorderHealth';
import { RecordingResourceGate } from '@/services/recordingResourceGate';
import { buildRecordingDiagnosticReport } from '@/services/recordingDiagnostics';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test('slow IndexedDB writes expose pressure and persist every accepted chunk in order', async () => {
  const firstWrite = deferred<void>();
  const persisted: number[] = [];
  const pressure: string[] = [];
  let now = 1_000;
  const writer = new ChunkWriteBatcher<{ index: number; bytes: number }>({
    batchSize: 2,
    flushIntervalMs: 60_000,
    sizeOf: (item) => item.bytes,
    now: () => now,
    highWaterMark: { batches: 2, chunks: 4, bytes: 400 },
    criticalWaterMark: { batches: 4, chunks: 8, bytes: 800 },
    onPressure: (level) => pressure.push(level),
    writeBatch: async (items) => {
      if (items[0]?.index === 0) await firstWrite.promise;
      now += 10;
      persisted.push(...items.map((item) => item.index));
    },
  });

  for (let index = 0; index < 10; index += 1) writer.enqueue({ index, bytes: 100 });
  await Promise.resolve();

  expect(writer.metrics()).toMatchObject({
    pendingChunks: 10,
    pendingBytes: 1_000,
    persistedChunks: 0,
  });
  expect(pressure).toEqual(['high', 'critical']);

  const flush = writer.flush();
  firstWrite.resolve();
  await flush;

  expect(persisted).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(writer.metrics()).toMatchObject({
    pendingChunks: 0,
    pendingBytes: 0,
    persistedChunks: 10,
    persistedBytes: 1_000,
  });
});

test('recording gate is reference counted and resumes voluntary noncritical work without polling', async () => {
  const gate = new RecordingResourceGate();
  const releaseA = gate.acquire('recording-a');
  const releaseB = gate.acquire('recording-a');
  expect(gate.snapshot()).toMatchObject({ active: true, recordingIds: ['recording-a'] });

  let resumed = false;
  const waiting = gate.waitUntilIdle().then(() => { resumed = true; });
  releaseA();
  await Promise.resolve();
  expect(resumed).toBe(false);
  releaseB();
  await waiting;
  expect(resumed).toBe(true);
  expect(gate.isActive()).toBe(false);
});

test('recording diagnostics distinguish WAN from local traffic without retaining URLs or media', () => {
  const report = buildRecordingDiagnosticReport({
    recordingId: 'recording-1',
    startedAt: 1_000,
    endedAt: 4_000,
    tracks: {},
    resources: [
      { transferSize: 220, sameOrigin: true },
      { transferSize: 1_400, sameOrigin: false },
    ],
    longTasks: { count: 2, totalMs: 140, maxMs: 90 },
  });

  expect(report.network).toEqual({
    sameOriginRequests: 1,
    sameOriginBytes: 220,
    wanRequests: 1,
    wanBytes: 1_400,
  });
  expect(JSON.stringify(report)).not.toContain('https://');
  expect(JSON.stringify(report)).not.toContain('Blob');
});

test('recording quality remains at the current 48 kHz and 128 kbps baseline', () => {
  expect(MIC_CONSTRAINTS).toEqual({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: { ideal: 48_000 },
      channelCount: { ideal: 1 },
    },
  });
  expect(AUDIO_RECORDING_BITS_PER_SECOND).toBe(128_000);
});
