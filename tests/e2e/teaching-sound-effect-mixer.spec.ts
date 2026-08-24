import { expect, test } from '@playwright/test';

import {
  mixTeachingSoundEffects,
  type DecodedTeachingSoundEffect,
  type TeachingSoundEffectAssetProvider,
  type TeachingSoundEffectCue,
} from '@/services/teachingSoundEffectMixer';

const ref = (id: string) => ({
  assetId: id,
  assetVersion: '1.0.0',
  checksum: 'a'.repeat(64),
  localUri: `file:///assets/${id}.wav`,
});

function provider(assets: Record<string, DecodedTeachingSoundEffect>): TeachingSoundEffectAssetProvider {
  return {
    async loadLocalPcm(asset) {
      const value = assets[asset.assetId];
      if (!value) throw new Error('missing_fixture_asset');
      return value;
    },
  };
}

function asset(sampleRate: number, channels: number[][]): DecodedTeachingSoundEffect {
  return {
    sampleRate,
    channelCount: channels.length,
    totalFrames: channels[0]?.length ?? 0,
    chunks: [{ channels: channels.map((channel) => Float32Array.from(channel)) }],
  };
}

function cue(overrides: Partial<TeachingSoundEffectCue> = {}): TeachingSoundEffectCue {
  return {
    cueId: 'cue-1',
    asset: ref('pop'),
    startMs: 0,
    endMs: 4,
    gainDb: 0,
    gainCeilingDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    ...overrides,
  };
}

test('mixes mono cues sample-accurately without mutating or duplicating the canonical base', async () => {
  const base = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
  const result = await mixTeachingSoundEffects({
    base: { sampleRate: 1_000, channelCount: 1, durationMs: 4, channels: [base] },
    cues: [cue({ startMs: 1, endMs: 3 })],
    assetProvider: provider({ pop: asset(1_000, [[0.5, 0.25, 0.75]]) }),
  });

  [0.1, 0.7, 0.55, 0.4].forEach((value, index) => expect(result.channels[0][index]).toBeCloseTo(value));
  [0.1, 0.2, 0.3, 0.4].forEach((value, index) => expect(base[index]).toBeCloseTo(value));
  expect(result.diagnostics.baseMixPasses).toBe(1);
  expect(result.diagnostics.normalizationPasses).toBe(1);
});

test('preserves stereo layout and sums overlapping cues deterministically', async () => {
  const input = {
    base: {
      sampleRate: 1_000,
      channelCount: 2,
      durationMs: 3,
      channels: [Float32Array.from([0, 0, 0]), Float32Array.from([0, 0, 0])],
    },
    cues: [
      cue({ cueId: 'a', asset: ref('a'), startMs: 0, endMs: 2, gainDb: -6, gainCeilingDb: -6 }),
      cue({ cueId: 'b', asset: ref('b'), startMs: 1, endMs: 3, gainDb: -6, gainCeilingDb: -6 }),
    ],
    assetProvider: provider({
      a: asset(1_000, [[1, 1], [0.5, 0.5]]),
      b: asset(1_000, [[0.5, 0.5], [1, 1]]),
    }),
  } as const;
  const first = await mixTeachingSoundEffects(input);
  const second = await mixTeachingSoundEffects({ ...input, cues: [...input.cues].reverse() });
  const gain = 10 ** (-6 / 20);

  expect(Array.from(first.channels[0])).toEqual(Array.from(second.channels[0]));
  expect(first.channels[0][0]).toBeCloseTo(gain);
  expect(first.channels[0][1]).toBeCloseTo(1.5 * gain);
  expect(first.channels[1][1]).toBeCloseTo(1.5 * gain);
});

test('clamps cues to recording bounds and trims the corresponding asset head and tail', async () => {
  const result = await mixTeachingSoundEffects({
    base: { sampleRate: 1_000, channelCount: 1, durationMs: 4, channels: [new Float32Array(4)] },
    cues: [cue({ startMs: -2, endMs: 6 })],
    assetProvider: provider({ pop: asset(1_000, [[1, 2, 3, 4, 5, 6, 7, 8]]) }),
  });
  [3, 4, 5, 6].forEach((value, index) => {
    expect(result.channels[0][index]).toBeCloseTo(value * result.diagnostics.finalGain);
  });
  expect(result.diagnostics.cues[0]).toMatchObject({ placedFrames: 4, trimmedHeadFrames: 2, trimmedTailFrames: 2 });
});

test('applies fades to the effect and a conservative non-multiplying duck envelope to base', async () => {
  const result = await mixTeachingSoundEffects({
    base: { sampleRate: 1_000, channelCount: 1, durationMs: 8, channels: [Float32Array.from({ length: 8 }, () => 1)] },
    cues: [cue({
      startMs: 2,
      endMs: 6,
      gainDb: -20,
      gainCeilingDb: -20,
      fadeInMs: 2,
      fadeOutMs: 2,
      ducking: { attenuationDb: -6, attackMs: 2, releaseMs: 2 },
    })],
    assetProvider: provider({ pop: asset(1_000, [[1, 1, 1, 1]]) }),
  });
  const duck = 10 ** (-6 / 20);
  const effect = 0.1;
  expect(result.channels[0][0]).toBeCloseTo(1);
  expect(result.channels[0][2]).toBeCloseTo((1 + duck) / 2 + effect / 2);
  expect(result.channels[0][3]).toBeCloseTo(duck + effect);
  expect(result.channels[0][5]).toBeCloseTo(duck + effect / 2);
  expect(result.channels[0][6]).toBeCloseTo((1 + duck) / 2);
  expect(result.channels[0][7]).toBeCloseTo(1);
});

test('continues duck attack from elapsed cue time when a cue starts before the recording', async () => {
  const result = await mixTeachingSoundEffects({
    base: { sampleRate: 1_000, channelCount: 1, durationMs: 4, channels: [Float32Array.of(1, 1, 1, 1)] },
    cues: [cue({
      startMs: -2,
      endMs: 2,
      ducking: { attenuationDb: -6, attackMs: 4, releaseMs: 0 },
    })],
    assetProvider: provider({ pop: asset(1_000, [[0, 0, 0, 0]]) }),
  });
  const duck = 10 ** (-6 / 20);
  expect(result.channels[0][0]).toBeCloseTo(1 - (1 - duck) * 0.75);
  expect(result.channels[0][1]).toBeCloseTo(duck);
  expect(result.channels[0][2]).toBeCloseTo(1);
});

test('releases monotonically from the attenuation actually reached by a cue shorter than attack', async () => {
  const result = await mixTeachingSoundEffects({
    base: { sampleRate: 1_000, channelCount: 1, durationMs: 6, channels: [Float32Array.of(1, 1, 1, 1, 1, 1)] },
    cues: [cue({
      endMs: 1,
      ducking: { attenuationDb: -12, attackMs: 4, releaseMs: 4 },
    })],
    assetProvider: provider({ pop: asset(1_000, [[0]]) }),
  });
  const duckTarget = 10 ** (-12 / 20);
  const reached = 1 - (1 - duckTarget) / 4;
  expect(result.channels[0][0]).toBeCloseTo(reached);
  expect(result.channels[0][1]).toBeCloseTo(reached + (1 - reached) / 4);
  expect(result.channels[0][1]).toBeGreaterThanOrEqual(result.channels[0][0]);
  expect(result.channels[0][2]).toBeGreaterThanOrEqual(result.channels[0][1]);
  expect(result.channels[0][3]).toBeGreaterThanOrEqual(result.channels[0][2]);
  expect(result.channels[0][4]).toBeCloseTo(1);
  expect(result.channels[0][5]).toBeCloseTo(1);
});

test('fades out at the actual asset endpoint when the asset is shorter than its scheduled cue', async () => {
  const result = await mixTeachingSoundEffects({
    base: { sampleRate: 1_000, channelCount: 1, durationMs: 6, channels: [new Float32Array(6)] },
    cues: [cue({ endMs: 6, fadeOutMs: 2 })],
    assetProvider: provider({ pop: asset(1_000, [[1, 1, 1, 1]]) }),
  });
  [1, 1, 1, 0.5, 0, 0].forEach((value, index) => expect(result.channels[0][index]).toBeCloseTo(value));
});

test('enforces cue gain ceiling and performs exactly one final anti-clipping normalization', async () => {
  const result = await mixTeachingSoundEffects({
    base: { sampleRate: 1_000, channelCount: 1, durationMs: 2, channels: [Float32Array.from([0.8, 0.2])] },
    cues: [cue({ endMs: 2, gainDb: 6, gainCeilingDb: -6 })],
    assetProvider: provider({ pop: asset(1_000, [[1, 1]]) }),
  });
  expect(result.diagnostics.cues[0].appliedGainDb).toBe(-6);
  expect(result.diagnostics.originalPeak).toBeCloseTo(0.8 + 10 ** (-6 / 20));
  expect(result.diagnostics.finalGain).toBeLessThan(1);
  expect(result.diagnostics.normalizationPasses).toBe(1);
  expect(result.diagnostics.peak).toBeCloseTo(10 ** (-1 / 20));
});

test('fails atomically for unsupported layouts, invalid PCM, bounds, and abort', async () => {
  const base = { sampleRate: 1_000, channelCount: 1, durationMs: 2, channels: [new Float32Array(2)] };
  await expect(mixTeachingSoundEffects({
    base,
    cues: [cue({ endMs: 2 })],
    assetProvider: provider({ pop: asset(2_000, [[1, 1]]) }),
  })).rejects.toThrow('teaching_sfx_unsupported_sample_rate');
  await expect(mixTeachingSoundEffects({
    base,
    cues: [cue({ endMs: 2 })],
    assetProvider: provider({ pop: asset(1_000, [[Number.NaN, 1]]) }),
  })).rejects.toThrow('teaching_sfx_non_finite_sample');
  await expect(mixTeachingSoundEffects({
    base,
    cues: [cue({ endMs: 2 })],
    assetProvider: provider({ pop: asset(1_000, [[1, 1], [1, 1]]) }),
  })).rejects.toThrow('teaching_sfx_unsupported_channel_layout');
  await expect(mixTeachingSoundEffects({
    base,
    cues: [cue({ endMs: 2, asset: { ...ref('pop'), localUri: 'https://example.com/pop.wav' } })],
    assetProvider: provider({ pop: asset(1_000, [[1, 1]]) }),
  })).rejects.toThrow('teaching_sfx_non_local_asset');
  await expect(mixTeachingSoundEffects({
    base,
    cues: [cue(), cue({ cueId: 'cue-2' })],
    assetProvider: provider({ pop: asset(1_000, [[1, 1]]) }),
    limits: { maxCues: 1 },
  })).rejects.toThrow('teaching_sfx_cue_limit_exceeded');
  await expect(mixTeachingSoundEffects({
    base,
    cues: [cue({ endMs: 2 })],
    assetProvider: provider({ pop: asset(1_000, [[1, 1]]) }),
    limits: { maxAssetBytes: 4 },
  })).rejects.toThrow('teaching_sfx_asset_limit_exceeded');
  await expect(mixTeachingSoundEffects({
    base,
    cues: [],
    assetProvider: provider({}),
    limits: { maxTotalSamples: 1 },
  })).rejects.toThrow('teaching_sfx_sample_limit_exceeded');
  await expect(mixTeachingSoundEffects({
    base,
    cues: [cue({ startMs: Number.MAX_VALUE / 4, endMs: Number.MAX_VALUE / 2 })],
    assetProvider: provider({ pop: asset(1_000, [[1, 1]]) }),
  })).rejects.toThrow('teaching_sfx_invalid_cue_frames');
  await expect(mixTeachingSoundEffects({
    base,
    cues: [cue({ endMs: 2, fadeInMs: Number.MAX_VALUE })],
    assetProvider: provider({ pop: asset(1_000, [[1, 1]]) }),
  })).rejects.toThrow('teaching_sfx_invalid_cue_frames');
  await expect(mixTeachingSoundEffects({
    base,
    cues: [cue({
      endMs: 2,
      ducking: { attenuationDb: -6, attackMs: Number.MAX_VALUE, releaseMs: 0 },
    })],
    assetProvider: provider({ pop: asset(1_000, [[1, 1]]) }),
  })).rejects.toThrow('teaching_sfx_invalid_cue_frames');
  await expect(mixTeachingSoundEffects({
    base: { ...base, durationMs: Number.MAX_VALUE },
    cues: [],
    assetProvider: provider({}),
  })).rejects.toThrow('teaching_sfx_invalid_duration_frames');
  const controller = new AbortController();
  controller.abort();
  await expect(mixTeachingSoundEffects({
    base,
    cues: [],
    assetProvider: provider({}),
    signal: controller.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });
  const duringDecode = new AbortController();
  await expect(mixTeachingSoundEffects({
    base,
    cues: [cue({ endMs: 2 })],
    assetProvider: {
      async loadLocalPcm() {
        return {
          sampleRate: 1_000,
          channelCount: 1,
          totalFrames: 2,
          chunks: (async function* () {
            yield { channels: [Float32Array.of(1)] };
            duringDecode.abort();
            yield { channels: [Float32Array.of(1)] };
          }()),
        };
      },
    },
    signal: duringDecode.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(Array.from(base.channels[0])).toEqual([0, 0]);
});

test('publishes no result and leaves base unchanged when a later asset fails after an earlier one materializes', async () => {
  const baseSamples = Float32Array.of(0.25, -0.25, 0.5, -0.5);
  const loaded: string[] = [];
  let published: Awaited<ReturnType<typeof mixTeachingSoundEffects>> | undefined;
  try {
    published = await mixTeachingSoundEffects({
      base: { sampleRate: 1_000, channelCount: 1, durationMs: 4, channels: [baseSamples] },
      cues: [
        cue({ cueId: 'first', asset: ref('a'), startMs: 0, endMs: 2 }),
        cue({ cueId: 'second', asset: ref('b'), startMs: 2, endMs: 4 }),
      ],
      assetProvider: {
        async loadLocalPcm(localRef) {
          loaded.push(localRef.assetId);
          if (localRef.assetId === 'a') return asset(1_000, [[1, 1]]);
          return { sampleRate: 1_000, channelCount: 1, totalFrames: 2, chunks: [] };
        },
      },
    });
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('teaching_sfx_asset_frame_count_mismatch');
  }
  expect(loaded).toEqual(['a', 'b']);
  expect(published).toBeUndefined();
  expect(Array.from(baseSamples)).toEqual([0.25, -0.25, 0.5, -0.5]);
});
