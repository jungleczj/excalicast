import { expect, test } from '@playwright/test';
import { MediaTaskCoordinator } from '@/services/mediaTaskCoordinator';
import type { MediaTaskRecord } from '@/services/mediaTaskDomain';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test('a completed export stays completed when task persistence rejects', async () => {
  const persisted: MediaTaskRecord[] = [];
  const coordinator = new MediaTaskCoordinator({
    persist: async (task) => {
      persisted.push(structuredClone(task));
      if (task.status === 'completed') throw { name: 'UnknownError', message: 'media task database unavailable' };
    },
    runExport: async () => new Blob(['encoded-video'], { type: 'video/mp4' }),
    createId: () => 'export-task',
  });

  const completed = await coordinator.startExport({
    recordingId: 'recording-1',
    configSnapshot: { format: 'mp4' },
  });

  expect(completed).toMatchObject({
    id: 'export-task',
    status: 'completed',
    progress: 1,
    error: undefined,
  });
  expect(completed.resultBlob?.size).toBeGreaterThan(0);
  expect(coordinator.snapshot()[0].status).toBe('completed');
  expect(persisted.filter((task) => task.status === 'completed')).toHaveLength(1);
});

test('completed task persistence does not retain the local-heavy resource lock', async () => {
  const firstRunnerDone = deferred<{ resultRef: string }>();
  const completedPersistence = deferred<void>();
  const starts: string[] = [];
  const coordinator = new MediaTaskCoordinator({
    persist: async (task) => {
      if (task.id === 'task-1' && task.status === 'completed') return completedPersistence.promise;
    },
    createId: (() => {
      let sequence = 0;
      return () => `task-${++sequence}`;
    })(),
  });

  const first = coordinator.startTask({
    recordingId: 'recording-1', kind: 'audio_peaks', resourceClass: 'local_heavy',
  }, async () => {
    starts.push('audio-peaks');
    return firstRunnerDone.promise;
  });
  const exportTask = coordinator.startTask({
    recordingId: 'recording-1', kind: 'export', resourceClass: 'local_heavy',
  }, async () => {
    starts.push('export');
    return { resultBlob: new Blob(['encoded-video']) };
  });

  firstRunnerDone.resolve({ resultRef: 'audio-peaks:recording-1' });
  await expect.poll(() => starts).toEqual(['audio-peaks', 'export']);

  completedPersistence.resolve();
  await Promise.all([first, exportTask]);
});

test('error-like codec rejections keep their real message', async () => {
  const coordinator = new MediaTaskCoordinator({
    persist: async () => undefined,
    createId: () => 'codec-task',
  });

  const execution = coordinator.startTask({
    recordingId: 'recording-1', kind: 'export', resourceClass: 'local_heavy',
  }, async () => Promise.reject({
    name: 'EncodingError',
    message: 'VideoEncoder was reclaimed while flushing',
  }));

  await expect(execution).rejects.toThrow('VideoEncoder was reclaimed while flushing');
  expect(coordinator.snapshot()[0]).toMatchObject({
    status: 'failed',
    error: 'VideoEncoder was reclaimed while flushing',
  });
});

test('failed exports retain their last structured failure phase beside the real error', async () => {
  const coordinator = new MediaTaskCoordinator({
    persist: async () => undefined,
    runExport: async (_input, report) => {
      report({
        phase: 'hardware_pipeline',
        ratio: 0.61,
        details: {
          phase: 'hardware_pipeline',
          ratio: 0.61,
          processedFrames: 183,
          totalFrames: 300,
          fallbackReason: 'VideoEncoder was reclaimed while flushing',
        },
      });
      throw { name: 'EncodingError', message: 'VideoEncoder was reclaimed while flushing' };
    },
    createId: () => 'structured-failure-task',
  });

  await expect(coordinator.startExport({
    recordingId: 'recording-1',
    configSnapshot: { format: 'mp4' },
  })).rejects.toThrow('VideoEncoder was reclaimed while flushing');

  expect(coordinator.snapshot()[0]).toMatchObject({
    status: 'failed',
    phase: 'hardware_pipeline',
    progress: 0.61,
    error: 'VideoEncoder was reclaimed while flushing',
    details: {
      phase: 'hardware_pipeline',
      ratio: 0.61,
      processedFrames: 183,
      totalFrames: 300,
      fallbackReason: 'VideoEncoder was reclaimed while flushing',
    },
  });
});
