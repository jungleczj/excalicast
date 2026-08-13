import { expect, test } from '@playwright/test';
import * as exportPipeline from '@/services/exportPipeline';

type FailureDecision = {
  action: 'fail' | 'software_reencode';
  error: Error;
  stage?: string;
};

function classify(error: unknown): FailureDecision {
  const implementation = (exportPipeline as typeof exportPipeline & {
    classifyWebCodecsFailure?: (failure: unknown) => FailureDecision;
  }).classifyWebCodecsFailure;
  if (!implementation) {
    return { action: 'software_reencode', error: new Error('missing WebCodecs failure classification') };
  }
  return implementation(error);
}

test('audio preparation errors stay structured and cannot trigger video software re-encoding', async () => {
  const normalize = (exportPipeline as typeof exportPipeline & {
    normalizeExportPreparation?: <T>(preparation: Promise<T> | null) => Promise<T> | null;
  }).normalizeExportPreparation;
  const preparedAudio = normalize
    ? normalize(Promise.reject({ name: 'DataError', message: 'export_audio_decode_failed' }))
    : Promise.reject({ name: 'DataError', message: 'export_audio_decode_failed' });
  const execution = preparedAudio!.catch((cause) => {
    throw {
      exportFailureKind: 'deterministic_input',
      stage: 'audio_preparation',
      cause,
    };
  });

  const failure = await execution.catch((error) => error);
  const decision = classify(failure);
  expect(decision.action).toBe('fail');
  expect(decision.error.message).toBe('export_audio_decode_failed');
});

test('resolved audio preparation is reusable without decoding twice', async () => {
  const normalize = (exportPipeline as typeof exportPipeline & {
    normalizeExportPreparation?: <T>(preparation: Promise<T> | null) => Promise<T> | null;
  }).normalizeExportPreparation;
  let decodes = 0;
  const source = Promise.resolve().then(() => ({ decode: ++decodes }));
  const preparedAudio = normalize ? normalize(source) : source;

  const first = await preparedAudio!;
  const second = await preparedAudio!;

  expect(first).toBe(second);
  expect(decodes).toBe(1);
});

test('deterministic frame composition failures skip full software re-encoding', () => {
  const decision = classify({
    exportFailureKind: 'deterministic_input',
    stage: 'frame_composition',
    cause: { name: 'DataError', message: 'display_frame_decode_failed' },
  });

  expect(decision.action).toBe('fail');
  expect(decision.stage).toBe('frame_composition');
  expect(decision.error).toBeInstanceOf(Error);
  expect(decision.error.message).toBe('display_frame_decode_failed');
});

test('hardware codec and decoder failures still use the compatibility encoder', () => {
  for (const failure of [
    new DOMException('VideoEncoder was reclaimed', 'EncodingError'),
    { name: 'NotSupportedError', message: 'camera decoder configuration is unsupported' },
  ]) {
    const decision = classify(failure);
    expect(decision.action).toBe('software_reencode');
    expect(decision.error.message).not.toBe('media_task_failed');
  }
});
