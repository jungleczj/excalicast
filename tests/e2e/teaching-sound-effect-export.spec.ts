import { expect, test } from '@playwright/test';

import type { TeachingCompositionOperation } from '@/desktop/teachingCompositionExecutor';
import {
  buildRawExportMonoPcm,
  EXPORT_AUDIO_SAMPLE_RATE,
  RAW_CANONICAL_FALLBACK_MAX_DURATION_MS,
} from '@/services/exportAudio';
import {
  createEncoderCompatibleTeachingAudio,
  prepareTeachingSoundEffectExportAudio,
  TEACHING_AUDIO_EXPORT_CAPABILITIES,
} from '@/services/teachingSoundEffectExport';
import { prepareCanonicalExportAudioTimeline } from '@/services/exportPipeline';
import type {
  DecodedTeachingSoundEffect,
  TeachingSoundEffectAssetProvider,
} from '@/services/teachingSoundEffectMixer';
import { mixTeachingSoundEffects } from '@/services/teachingSoundEffectMixer';

const FRAME_MS = 1_000 / EXPORT_AUDIO_SAMPLE_RATE;
const CHECKSUM = 'c'.repeat(64);

function raw(samples: number[]) {
  return buildRawExportMonoPcm({
    channels: [Float32Array.from(samples)],
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    durationMs: samples.length * FRAME_MS,
    crossfadeMs: 0,
  });
}

function operation(overrides: Partial<TeachingCompositionOperation> = {}): TeachingCompositionOperation {
  return {
    operationId: 'teaching:sound-effect:0000:sfx-pop',
    operation: 'mix-sound-effect',
    track: 'sound-effect',
    asset: {
      assetId: 'sfx-pop',
      kind: 'sound-effect',
      catalogVersion: 'catalog-1',
      assetVersion: '1.0.0',
      checksumAlgorithm: 'sha256',
      checksum: CHECKSUM,
      localUri: 'file:///cache/sfx-pop.wav',
    },
    startMs: FRAME_MS,
    endMs: FRAME_MS * 3,
    trim: { sourceStartMs: 0, sourceEndMs: FRAME_MS * 2, playbackMode: 'once' },
    zOrder: 0,
    transition: { enterMs: 0, exitMs: 0, easing: 'easeInOutCubic' },
    content: [],
    audio: {
      gainDb: 0,
      gainCeilingDb: 0,
      ducking: {
        targetSourceTracks: ['mic', 'system'],
        attenuationDb: 0,
        attackMs: 0,
        releaseMs: 0,
      },
      mixesAsIndependentEffect: true,
    },
    ...overrides,
  };
}

function decoded(samples: number[]): DecodedTeachingSoundEffect {
  return {
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
    channelCount: 1,
    totalFrames: samples.length,
    chunks: [{ channels: [Float32Array.from(samples)] }],
  };
}

function provider(value: DecodedTeachingSoundEffect): TeachingSoundEffectAssetProvider {
  return { async loadLocalPcm() { return value; } };
}

test('advertises real sound-effect export support while visual operations remain unsupported', () => {
  expect(TEACHING_AUDIO_EXPORT_CAPABILITIES).toEqual({
    'motion-graphic': false,
    chart: false,
    'sound-effect': true,
  });
});

test('raw microphone plus system audio plus SFX receives only the mixer final normalization', async () => {
  const microphone = raw([0.6, 0.6, 0.2]);
  const system = raw([0.6, 0.1, 0.2, -0.25, 0.5]);
  const microphoneBefore = Array.from(microphone.samples);
  const systemBefore = Array.from(system.samples);

  const result = await prepareTeachingSoundEffectExportAudio({
    baseTracks: [
      { trackId: 'mic', kind: 'microphone', audio: microphone },
      { trackId: 'system', kind: 'system-audio', audio: system },
    ],
    operations: [operation()],
    assetProvider: provider(decoded([1, 0.5])),
  });

  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  const target = 10 ** (-1 / 20);
  const finalGain = target / 1.7;
  expect(result.audio.totalFrames).toBe(5);
  expect(result.audio.samples[0]).toBeCloseTo(1.2 * finalGain);
  expect(result.audio.samples[1]).toBeCloseTo(1.7 * finalGain);
  expect(result.audio.samples[2]).toBeCloseTo(0.9 * finalGain);
  expect(result.audio.samples[3]).toBeCloseTo(-0.25 * finalGain);
  expect(result.audio.samples[4]).toBeCloseTo(0.5 * finalGain);
  expect(result.audio.diagnostics.originalPeak).toBeCloseTo(1.7);
  expect(result.audio.diagnostics.normalizationPasses).toBe(1);
  expect(result.mixDiagnostics.baseMixPasses).toBe(1);
  expect(result.mixDiagnostics.normalizationPasses).toBe(1);
  expect(Array.from(microphone.samples)).toEqual(microphoneBefore);
  expect(Array.from(system.samples)).toEqual(systemBefore);
});

test('legacy microphone-only recordings keep their duration and samples with no duplicated base', async () => {
  const microphone = raw([0.25, -0.5, 0.1, 0, 0.2]);
  const result = await prepareTeachingSoundEffectExportAudio({
    baseTracks: [{ trackId: 'legacy-mic', kind: 'microphone', audio: microphone }],
    operations: [operation({
      audio: {
        ...operation().audio!,
        ducking: { ...operation().audio!.ducking, targetSourceTracks: ['legacy-mic'] },
      },
    })],
    assetProvider: provider(decoded([0, 0])),
  });

  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  expect(Array.from(result.audio.samples)).toEqual(Array.from(microphone.samples));
  expect(result.audio.totalFrames).toBe(5);
});

test('returns explicit unsupported capability for visuals without claiming or loading a render', async () => {
  let loads = 0;
  const visual = {
    ...operation(),
    operationId: 'teaching:chart:0000:chart-bars',
    operation: 'render-chart',
    track: 'chart',
    asset: { ...operation().asset, assetId: 'chart-bars', kind: 'chart' },
    audio: undefined,
  } as TeachingCompositionOperation;
  const result = await prepareTeachingSoundEffectExportAudio({
    baseTracks: [{ trackId: 'mic', kind: 'microphone', audio: raw([0.1, 0.2, 0.3]) }],
    operations: [visual],
    assetProvider: { async loadLocalPcm() { loads += 1; return decoded([1]); } },
  });

  expect(result).toEqual({
    status: 'unsupported-capability',
    unsupported: [{
      operationId: 'teaching:chart:0000:chart-bars',
      kind: 'chart',
      capability: 'render-chart',
    }],
  });
  expect(loads).toBe(0);
});

test('rejects forged sound-effect identity, timing, gain, local refs, and duck targets before loading PCM', async () => {
  const invalid: Array<[string, TeachingCompositionOperation]> = [
    ['teaching_sfx_export_operation_invalid', operation({ track: 'chart' })],
    ['teaching_sfx_export_operation_invalid', operation({ trim: { sourceStartMs: 0, sourceEndMs: FRAME_MS, playbackMode: 'once' } })],
    ['teaching_sfx_export_operation_invalid', operation({ startMs: -1 })],
    ['teaching_sfx_export_operation_invalid', operation({ audio: { ...operation().audio!, gainDb: Number.NaN } })],
    ['teaching_sfx_non_local_asset', operation({ asset: { ...operation().asset, localUri: 'excalicast-asset://sfx-pop' } })],
    ['teaching_sfx_export_duck_targets_invalid', operation({
      audio: {
        ...operation().audio!,
        ducking: { ...operation().audio!.ducking, targetSourceTracks: ['mic'] },
      },
    })],
  ];
  for (const [message, candidate] of invalid) {
    let loads = 0;
    await expect(prepareTeachingSoundEffectExportAudio({
      baseTracks: [
        { trackId: 'mic', kind: 'microphone', audio: raw([0.2, 0.2, 0.2]) },
        { trackId: 'system', kind: 'system-audio', audio: raw([0.1, 0.1, 0.1]) },
      ],
      operations: [candidate],
      assetProvider: { async loadLocalPcm() { loads += 1; return decoded([1, 1]); } },
    })).rejects.toThrow(message);
    expect(loads).toBe(0);
  }
});

test('provider failure and abort publish no partial audio and leave every base track unchanged', async () => {
  const microphone = raw([0.3, -0.3, 0.4]);
  const system = raw([0.2, 0.1, -0.1]);
  const before = [Array.from(microphone.samples), Array.from(system.samples)];
  let published: unknown;
  try {
    published = await prepareTeachingSoundEffectExportAudio({
      baseTracks: [
        { trackId: 'mic', kind: 'microphone', audio: microphone },
        { trackId: 'system', kind: 'system-audio', audio: system },
      ],
      operations: [operation()],
      assetProvider: { async loadLocalPcm() { throw new Error('local_decode_failed'); } },
    });
  } catch (error) {
    expect((error as Error).message).toBe('local_decode_failed');
  }
  expect(published).toBeUndefined();
  expect(Array.from(microphone.samples)).toEqual(before[0]);
  expect(Array.from(system.samples)).toEqual(before[1]);

  const controller = new AbortController();
  controller.abort();
  await expect(prepareTeachingSoundEffectExportAudio({
    baseTracks: [{ trackId: 'mic', kind: 'microphone', audio: microphone }],
    operations: [],
    assetProvider: provider(decoded([1])),
    signal: controller.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });
});

test('export pipeline routes typed teaching SFX options through the local provider into final PCM', async () => {
  let loads = 0;
  const result = await prepareCanonicalExportAudioTimeline({
    microphone: { trackId: 'mic', audio: raw([0.2, 0.2, 0.2, 0.2]) },
    systemAudio: { trackId: 'system', audio: raw([0.1, 0.1, 0.1, 0.1]) },
    teachingSoundEffects: {
      sourceTracks: [
        { trackId: 'mic', kind: 'microphone' },
        { trackId: 'system', kind: 'system-audio' },
      ],
      operations: [operation()],
      assetProvider: {
        async loadLocalPcm(assetRef) {
          loads += 1;
          expect(assetRef.localUri).toBe('file:///cache/sfx-pop.wav');
          return decoded([0.5, 0.25]);
        },
      },
    },
  });

  expect(loads).toBe(1);
  expect(result.diagnostics.normalizationPasses).toBe(1);
  expect(result.samples[0]).toBeCloseTo(0.3);
  expect(result.samples[1]).toBeCloseTo(0.8);
  expect(result.samples[2]).toBeCloseTo(0.55);
  expect(result.samples[3]).toBeCloseTo(0.3);
});

test('export pipeline fails closed when typed teaching input contains a visual operation', async () => {
  const visual = {
    ...operation(),
    operationId: 'teaching:chart:0000:chart-bars',
    operation: 'render-chart',
    track: 'chart',
    asset: { ...operation().asset, assetId: 'chart-bars', kind: 'chart' },
    audio: undefined,
  } as TeachingCompositionOperation;

  await expect(prepareCanonicalExportAudioTimeline({
    microphone: { trackId: 'mic', audio: raw([0.2, 0.2, 0.2]) },
    teachingSoundEffects: {
      sourceTracks: [{ trackId: 'mic', kind: 'microphone' }],
      operations: [visual],
      assetProvider: provider(decoded([1])),
    },
  })).rejects.toThrow('teaching_sfx_export_unsupported_capability:render-chart');
});

test('pure SFX export builds an out-duration silent base and requires no duck targets', async () => {
  const pureOperation = operation({
    audio: {
      ...operation().audio!,
      ducking: { ...operation().audio!.ducking, targetSourceTracks: [] },
    },
  });
  const result = await prepareCanonicalExportAudioTimeline({
    durationMs: FRAME_MS * 4,
    teachingSoundEffects: {
      sourceTracks: [],
      operations: [pureOperation],
      assetProvider: provider(decoded([0.5, 0.25])),
    },
  });

  expect(result.totalFrames).toBe(4);
  expect(Array.from(result.samples)).toEqual([0, 0.5, 0.25, 0]);

  await expect(prepareCanonicalExportAudioTimeline({
    durationMs: FRAME_MS * 4,
    teachingSoundEffects: {
      sourceTracks: [],
      operations: [operation()],
      assetProvider: provider(decoded([0.5, 0.25])),
    },
  })).rejects.toThrow('teaching_sfx_export_duck_targets_invalid');
});

test('encoder-compatible wrapping takes ownership of the exclusive mixer buffer without copying it', async () => {
  const rawBase = raw([0.2, 0.2]);
  const mixed = await mixTeachingSoundEffects({
    base: {
      sampleRate: rawBase.sampleRate,
      channelCount: 1,
      durationMs: rawBase.durationMs,
      channels: [rawBase.samples],
    },
    cues: [],
    assetProvider: provider(decoded([1])),
  });
  const audio = createEncoderCompatibleTeachingAudio(rawBase, mixed);

  expect(audio.samples).toBe(mixed.channels[0]);
});

test('export pipeline rejects malformed runtime teaching dependencies before PCM/provider work', async () => {
  const malformed = [
    {},
    { sourceTracks: null, operations: [], assetProvider: provider(decoded([1])) },
    { sourceTracks: [], operations: {}, assetProvider: provider(decoded([1])) },
    { sourceTracks: [], operations: [], assetProvider: {} },
    { sourceTracks: [null], operations: [], assetProvider: provider(decoded([1])) },
    {
      sourceTracks: [{ trackId: 'forged', kind: 'speaker' }],
      operations: [],
      assetProvider: provider(decoded([1])),
    },
  ];
  for (const teachingSoundEffects of malformed) {
    await expect(prepareCanonicalExportAudioTimeline({
      durationMs: FRAME_MS * 2,
      teachingSoundEffects: teachingSoundEffects as never,
    })).rejects.toThrow('teaching_sfx_export_runtime_input_invalid');
  }
});

test('nested operation corruption fails with stable validation errors instead of TypeError', async () => {
  const malformedRuntime = [null, 42, 'operation'];
  for (const malformed of malformedRuntime) {
    await expect(prepareCanonicalExportAudioTimeline({
      durationMs: FRAME_MS * 2,
      teachingSoundEffects: {
        sourceTracks: [],
        operations: [malformed] as never,
        assetProvider: provider(decoded([1])),
      },
    })).rejects.toThrow('teaching_sfx_export_runtime_input_invalid');
  }

  const malformedOperations = [
    {},
    { ...operation(), asset: null },
    { ...operation(), asset: {} },
    { ...operation(), audio: null },
    { ...operation(), audio: {} },
    { ...operation(), audio: { ...operation().audio, ducking: null } },
    { ...operation(), audio: { ...operation().audio, ducking: {} } },
    { ...operation(), trim: null },
    { ...operation(), transition: null },
  ];
  for (const malformed of malformedOperations) {
    await expect(prepareCanonicalExportAudioTimeline({
      durationMs: FRAME_MS * 4,
      teachingSoundEffects: {
        sourceTracks: [],
        operations: [malformed] as never,
        assetProvider: provider(decoded([1, 1])),
      },
    })).rejects.toThrow('teaching_sfx_export_operation_invalid');
  }
});

test('pure SFX output budget fails before local asset loading', async () => {
  let loads = 0;
  await expect(prepareCanonicalExportAudioTimeline({
    durationMs: FRAME_MS * 4,
    teachingSoundEffects: {
      sourceTracks: [],
      operations: [operation({
        audio: {
          ...operation().audio!,
          ducking: { ...operation().audio!.ducking, targetSourceTracks: [] },
        },
      })],
      assetProvider: {
        async loadLocalPcm() {
          loads += 1;
          return decoded([1, 1]);
        },
      },
      limits: { maxOutputBytes: 8 },
    },
  })).rejects.toThrow('export_audio_raw_output_limit_exceeded');
  expect(loads).toBe(0);
});

test('teaching SFX opts into the bounded fallback before timeline allocation or asset loading', async () => {
  let loads = 0;
  await expect(prepareCanonicalExportAudioTimeline({
    durationMs: RAW_CANONICAL_FALLBACK_MAX_DURATION_MS + FRAME_MS,
    teachingSoundEffects: {
      sourceTracks: [],
      operations: [operation({
        audio: {
          ...operation().audio!,
          ducking: { ...operation().audio!.ducking, targetSourceTracks: [] },
        },
      })],
      assetProvider: {
        async loadLocalPcm() {
          loads += 1;
          return decoded([1]);
        },
      },
    },
  })).rejects.toThrow('export_audio_raw_output_limit_exceeded');
  expect(loads).toBe(0);
});
