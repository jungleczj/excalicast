import { expect, test } from '@playwright/test';
import { recoverMediaTask } from '@/services/mediaTaskDomain';
import {
  collectRecorderWarnings,
  settleChunkWrites,
  trackChunkWrite,
} from '@/services/mediaRecorderHealth';
import { RecordingLifecycleCoordinator } from '@/services/recordingLifecycle';
import { recoverUnfinishedRecording } from '@/services/recordingRecovery';

test('interrupted export without a checkpoint becomes failed instead of resumable', () => {
  const recovered = recoverMediaTask({
    id: 'task-without-checkpoint',
    recordingId: 'recording-1',
    kind: 'export',
    status: 'running',
    progress: 0.71,
    createdAt: 1,
    updatedAt: 2,
  }, 10);

  expect(recovered).toMatchObject({
    status: 'failed',
    progress: 0,
    updatedAt: 10,
    error: 'interrupted_without_checkpoint',
  });
});

test('recording session remains owned when the app route detaches', () => {
  const session = {
    recordingId: 'recording-1',
    stop: async () => 'done',
  };
  const coordinator = new RecordingLifecycleCoordinator();

  coordinator.attach(session);
  coordinator.detachView();

  expect(coordinator.activeSession()).toBe(session);
});

test('recording finalization is atomic so stop cannot run twice', async () => {
  let stopCalls = 0;
  const coordinator = new RecordingLifecycleCoordinator();
  const session = {
    recordingId: 'recording-1',
    stop: async () => {
      stopCalls += 1;
      return 'done';
    },
  };
  coordinator.attach(session);

  const first = coordinator.stop();
  const duplicate = coordinator.stop();
  expect(first).toBe(duplicate);
  await first;
  expect(stopCalls).toBe(1);
  expect(coordinator.activeSession()).toBeNull();
});

test('chunk persistence failures cannot be reported as a clean recording', async () => {
  await expect(settleChunkWrites('screen', [
    trackChunkWrite(Promise.resolve(1)),
    trackChunkWrite(Promise.reject(new DOMException('quota exhausted', 'QuotaExceededError'))),
  ])).rejects.toThrow('screen_chunk_write_failed');

  const warnings = collectRecorderWarnings([
    { track: 'audio', result: { status: 'fulfilled', value: undefined } },
    { track: 'screen', result: { status: 'rejected', reason: new Error('screen_chunk_write_failed') } },
  ]);
  expect(warnings).toEqual(['screen:screen_chunk_write_failed']);
});

test('unfinished recordings become recoverable interruptions after a hard close', () => {
  const recovered = recoverUnfinishedRecording({
    id: 'recording-1',
    startedAt: 100,
    durationMs: 0,
    hasAudio: true,
    hasCamera: false,
    status: 'finalizing',
  }, 12_750);

  expect(recovered).toMatchObject({
    status: 'interrupted',
    durationMs: 12_750,
    interruptionRequestedAt: undefined,
    warnings: ['browser_session_ended_before_finalization'],
  });
});
