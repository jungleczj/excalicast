import { expect, test } from '@playwright/test';
import { assembleRecordingAudioTracks } from '@/lib/db-client';
import {
  EXPORT_AUDIO_SAMPLE_RATE,
  mixPreparedExportAudio,
  type PreparedExportAudio,
} from '@/services/exportAudio';

function prepared(samples: number[]): PreparedExportAudio {
  const peak = Math.max(0, ...samples.map((sample) => Math.abs(sample)));
  return {
    samples: Float32Array.from(samples),
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    channels: 1,
    totalFrames: samples.length,
    durationMs: samples.length / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    diagnostics: {
      sourceFrames: samples.length,
      outputFrames: samples.length,
      nonFiniteSamples: 0,
      clippedSamples: 0,
      peak,
      originalPeak: peak,
      appliedGainDb: 0,
    },
    getWavBlob: () => new Blob(),
    sourceKind: 'original',
  };
}

test('microphone and computer audio chunks remain independently addressable after persistence', async () => {
  const tracks = assembleRecordingAudioTracks(
    [
      { recordingId: 'recording-1', index: 0, blob: new Blob(['mic-0'], { type: 'audio/webm' }) },
      { recordingId: 'recording-1', index: 1, blob: new Blob(['mic-1'], { type: 'audio/webm' }) },
    ],
    [
      { recordingId: 'recording-1', index: 0, blob: new Blob(['system-0'], { type: 'audio/webm' }) },
      { recordingId: 'recording-1', index: 1, blob: new Blob(['system-1'], { type: 'audio/webm' }) },
    ],
  );

  expect(await tracks.audioBlob?.text()).toBe('mic-0mic-1');
  expect(await tracks.systemAudioBlob?.text()).toBe('system-0system-1');
  expect(tracks.audioBlob).not.toBe(tracks.systemAudioBlob);
});

test('legacy recordings without computer audio retain their microphone track', async () => {
  const tracks = assembleRecordingAudioTracks(
    [{ recordingId: 'legacy', index: 0, blob: new Blob(['legacy-mic'], { type: 'audio/webm' }) }],
    [],
  );

  expect(await tracks.audioBlob?.text()).toBe('legacy-mic');
  expect(tracks.systemAudioBlob).toBeNull();

  const microphone = prepared([0.25, -0.5, 0.1]);
  const mixed = mixPreparedExportAudio([microphone]);
  expect(Array.from(mixed.samples)).toEqual([0.25, -0.5, 0.10000000149011612]);
  expect(mixed.totalFrames).toBe(3);
  expect(mixed.diagnostics.appliedGainDb).toBe(0);
});

test('export mix keeps the longest source and applies one anti-clipping gain', () => {
  const mixed = mixPreparedExportAudio([
    prepared([0.9, 0.9]),
    prepared([0.9, -0.1, 0.4, -0.4, 0.2]),
  ]);

  expect(mixed.totalFrames).toBe(5);
  expect(mixed.samples[4]).toBeCloseTo(0.2 * (10 ** (-1 / 20) / 1.8));
  expect(mixed.diagnostics.originalPeak).toBeCloseTo(1.8);
  expect(mixed.diagnostics.clippedSamples).toBe(0);
  expect(mixed.diagnostics.peak).toBeLessThanOrEqual(1);
  expect(mixed.diagnostics.appliedGainDb).toBeLessThan(0);
});
