import { expect, test } from '@playwright/test';

import { pollDesktopTeachingComposition } from '../../src/desktop/teachingCompositionJobClient';

const readySourceTracks = [{ trackId: 'microphone', kind: 'microphone' }];
const readyOperations = [{
  operationId: 'teaching:sound-effect:0000:lesson-pop',
  operation: 'mix-sound-effect',
  track: 'sound-effect',
  asset: {
    assetId: 'lesson-pop', kind: 'sound-effect', catalogVersion: 'catalog-v1',
    assetVersion: '1.0.0', checksumAlgorithm: 'sha256', checksum: 'a'.repeat(64),
    localUri: 'file:///tmp/lesson-pop.wav',
  },
  startMs: 500,
  endMs: 800,
  trim: { sourceStartMs: 0, sourceEndMs: 300, playbackMode: 'once' },
  zOrder: 0,
  transition: { enterMs: 0, exitMs: 0, easing: 'easeInOutCubic' },
  content: [],
  audio: {
    gainDb: -3, gainCeilingDb: -1,
    ducking: {
      targetSourceTracks: ['microphone'], attenuationDb: -8,
      attackMs: 80, releaseMs: 240,
    },
    mixesAsIndependentEffect: true,
  },
}];

test('native composition polling preserves pending and generating before a real ready manifest', async () => {
  const responses = [
    { state: 'pending' },
    { state: 'generating' },
    { state: 'ready', sourceTracks: readySourceTracks, operations: readyOperations },
  ];
  const reflected: string[] = [];
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  await expect(pollDesktopTeachingComposition({
    recordingId: 'native-composition-client',
    bridge: {
      async invoke(channel, payload) {
        calls.push({ channel, payload });
        return responses.shift();
      },
    },
    onStatus(status) { reflected.push(status.status); },
    wait: async () => undefined,
  })).resolves.toEqual({
    status: 'ready',
    sourceTracks: readySourceTracks,
    operations: readyOperations,
  });
  expect(reflected).toEqual(['pending', 'generating', 'ready']);
  expect(calls).toEqual(Array.from({ length: 3 }, () => ({
    channel: 'project.read-teaching-composition-export.v1',
    payload: { recordingId: 'native-composition-client' },
  })));
});

test('native composition polling preserves terminal unsupported and failed codes', async () => {
  for (const response of [
    { state: 'unsupported', code: 'teaching_composition_unsupported_capability' },
    { state: 'failed', code: 'teaching_composition_finalization_failed' },
  ]) {
    await expect(pollDesktopTeachingComposition({
      recordingId: 'native-composition-terminal',
      bridge: { async invoke() { return response; } },
      onStatus() {},
      wait: async () => { throw new Error('terminal_state_must_not_wait'); },
    })).resolves.toEqual({
      status: response.state,
      code: response.code,
      ...(response.state === 'failed' ? { retryable: false } : {}),
    });
  }
});

test('native composition polling rejects malformed state and abort races', async () => {
  await expect(pollDesktopTeachingComposition({
    recordingId: 'native-composition-invalid',
    bridge: { async invoke() { return { state: 'ready' }; } },
    onStatus() {},
  })).rejects.toThrow('desktop_teaching_composition_status_invalid');

  await expect(pollDesktopTeachingComposition({
    recordingId: 'native-composition-invalid',
    bridge: {
      async invoke() {
        return {
          state: 'ready',
          sourceTracks: readySourceTracks,
          operations: [{
            ...readyOperations[0],
            audio: {
              ...readyOperations[0].audio,
              ducking: {
                ...readyOperations[0].audio.ducking,
                targetSourceTracks: ['forged-track'],
              },
            },
          }],
        };
      },
    },
    onStatus() {},
  })).rejects.toThrow('desktop_teaching_composition_status_invalid');

  await expect(pollDesktopTeachingComposition({
    recordingId: 'native-composition-invalid',
    bridge: { async invoke() { return { state: 'ready', sourceTracks: readySourceTracks, operations: [] }; } },
    onStatus() {},
  })).rejects.toThrow('desktop_teaching_composition_status_invalid');

  await expect(pollDesktopTeachingComposition({
    recordingId: 'native-composition-invalid',
    bridge: { async invoke() { return { state: 'ready', code: 'forged', sourceTracks: readySourceTracks, operations: readyOperations }; } },
    onStatus() {},
  })).rejects.toThrow('desktop_teaching_composition_status_invalid');

  await expect(pollDesktopTeachingComposition({
    recordingId: 'native-composition-invalid',
    bridge: { async invoke() { return { state: 'pending', sourceTracks: readySourceTracks, operations: readyOperations }; } },
    onStatus() {},
  })).rejects.toThrow('desktop_teaching_composition_status_invalid');

  await expect(pollDesktopTeachingComposition({
    recordingId: 'native-composition-invalid',
    bridge: {
      async invoke() {
        return {
          state: 'unsupported', code: 'teaching_composition_unsupported_capability',
          sourceTracks: readySourceTracks, operations: readyOperations,
        };
      },
    },
    onStatus() {},
  })).rejects.toThrow('desktop_teaching_composition_status_invalid');

  const controller = new AbortController();
  let resolveInvoke!: (value: unknown) => void;
  const response = new Promise<unknown>((resolve) => { resolveInvoke = resolve; });
  const reflected: string[] = [];
  const polling = pollDesktopTeachingComposition({
    recordingId: 'native-composition-abort',
    bridge: { async invoke() { return response; } },
    signal: controller.signal,
    onStatus(status) { reflected.push(status.status); },
  });
  controller.abort();
  resolveInvoke({ state: 'pending' });
  await expect(polling).rejects.toThrow('desktop_teaching_composition_poll_aborted');
  expect(reflected).toEqual([]);
});

test('native composition reports renderer-unsupported visual operations instead of false ready', async () => {
  const visualOperation = {
    ...readyOperations[0],
    operation: 'render-chart',
    track: 'chart',
    asset: { ...readyOperations[0].asset, assetId: 'lesson-chart', kind: 'chart' },
    trim: { ...readyOperations[0].trim, playbackMode: 'hold-last-frame' },
    audio: undefined,
  };
  await expect(pollDesktopTeachingComposition({
    recordingId: 'native-composition-visual',
    bridge: {
      async invoke() {
        return { state: 'ready', sourceTracks: readySourceTracks, operations: [visualOperation] };
      },
    },
    onStatus() {},
  })).resolves.toEqual({
    status: 'unsupported',
    code: 'teaching_composition_renderer_capability_unsupported',
  });
});
