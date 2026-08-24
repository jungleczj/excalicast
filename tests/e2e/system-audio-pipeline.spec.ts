import { expect, test } from '@playwright/test';
import { assembleRecordingAudioTracks } from '@/lib/db-client';
import {
  assembleRawCanonicalExportAudio,
  buildRawExportMonoPcm,
  concatenateRawCanonicalExportAudio,
  encodeFloat32Wav,
  EXPORT_AUDIO_SAMPLE_RATE,
  mixPreparedExportAudio,
  prepareRawExportAudio,
  RAW_CANONICAL_FALLBACK_MAX_DURATION_MS,
  TEACHING_SFX_RAW_CANONICAL_FALLBACK_LIMITS,
  type PreparedExportAudio,
  validateRawExportDurationBudget,
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
      normalizationPasses: 1,
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
  expect(mixed.diagnostics.normalizationPasses).toBe(1);
});

test('raw canonical assembly sums each independent source once without normalizing or mutating it', () => {
  const microphone = buildRawExportMonoPcm({
    channels: [Float32Array.of(0.9, 0.4)],
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    durationMs: 2 / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
  });
  const system = buildRawExportMonoPcm({
    channels: [Float32Array.of(0.9, -0.1, 0.25, 0, 0.5)],
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    durationMs: 5 / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
  });
  const beforeMicrophone = Array.from(microphone.samples);
  const beforeSystem = Array.from(system.samples);

  const raw = assembleRawCanonicalExportAudio([microphone, system]);

  expect(Array.from(raw.samples)).toEqual([
    1.7999999523162842,
    0.30000001192092896,
    0.25,
    0,
    0.5,
  ]);
  expect(raw.totalFrames).toBe(5);
  expect(raw.diagnostics.peak).toBeCloseTo(1.8);
  expect(raw.diagnostics.clippedSamples).toBe(1);
  expect(raw.diagnostics.appliedGainDb).toBe(0);
  expect(raw.diagnostics.normalizationPasses).toBe(0);
  expect(Array.from(microphone.samples)).toEqual(beforeMicrophone);
  expect(Array.from(system.samples)).toEqual(beforeSystem);
});

test('raw assembly and concatenation reject configured frame or byte budgets before output allocation', () => {
  const first = buildRawExportMonoPcm({
    channels: [Float32Array.of(0.1, 0.2, 0.3)],
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    durationMs: 3 / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
  });
  const second = buildRawExportMonoPcm({
    channels: [Float32Array.of(0.4, 0.5, 0.6)],
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    durationMs: 3 / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
  });

  expect(() => assembleRawCanonicalExportAudio(
    [first, second],
    undefined,
    { maxFrames: 2, maxBytes: 12 },
  )).toThrow('export_audio_raw_output_limit_exceeded');
  expect(() => concatenateRawCanonicalExportAudio(
    [first, second],
    0,
    undefined,
    { maxFrames: 5, maxBytes: 24 },
  )).toThrow('export_audio_raw_output_limit_exceeded');
});

test('raw build rejects oversized declared channel length before allocating or reading PCM', () => {
  const declaredOnly = { length: 3 } as Float32Array;
  expect(() => buildRawExportMonoPcm({
    channels: [declaredOnly],
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    durationMs: 1 / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    limits: { maxFrames: 2, maxBytes: 8 },
  })).toThrow('export_audio_raw_output_limit_exceeded');
  expect(() => buildRawExportMonoPcm({
    channels: [Float32Array.of(0.1)],
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    durationMs: 3 / EXPORT_AUDIO_SAMPLE_RATE * 1_000,
    limits: { maxFrames: 2, maxBytes: 8 },
  })).toThrow('export_audio_raw_output_limit_exceeded');
});

test('raw media preparation rejects metadata duration beyond its budget', async () => {
  const wav = encodeFloat32Wav(Float32Array.of(0.1, 0.2, 0.3));
  await expect(prepareRawExportAudio({
    blob: wav,
    limits: { maxFrames: 2, maxBytes: 8 },
  })).rejects.toThrow('export_audio_raw_output_limit_exceeded');
});

test('legacy raw build and metadata preflight do not inherit the teaching fallback duration cap', () => {
  const beyondTeachingFallbackSeconds = RAW_CANONICAL_FALLBACK_MAX_DURATION_MS / 1_000
    + 1 / EXPORT_AUDIO_SAMPLE_RATE;
  expect(() => validateRawExportDurationBudget(beyondTeachingFallbackSeconds)).not.toThrow();
  expect(() => validateRawExportDurationBudget(
    beyondTeachingFallbackSeconds,
    TEACHING_SFX_RAW_CANONICAL_FALLBACK_LIMITS,
  )).toThrow('export_audio_raw_output_limit_exceeded');
  expect(() => validateRawExportDurationBudget(
    (0xffff_ffff + 1) / EXPORT_AUDIO_SAMPLE_RATE,
    { maxFrames: Number.MAX_SAFE_INTEGER, maxBytes: Number.MAX_SAFE_INTEGER },
  )).toThrow('export_audio_raw_output_limit_exceeded');

  const raw = buildRawExportMonoPcm({
    channels: [Float32Array.of(0.25)],
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    durationMs: beyondTeachingFallbackSeconds * 1_000,
  });
  expect(raw.totalFrames).toBe(1);
  expect(raw.samples[0]).toBeCloseTo(0.25);
});
