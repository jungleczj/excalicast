import { expect, test } from '@playwright/test';
import {
  collectNewlyCompletedTaskIds,
  MediaTaskCoordinator,
  type MediaTaskRunner,
} from '@/services/mediaTaskCoordinator';
import {
  isMediaTaskVisible,
  MEDIA_TASK_COMPLETION_RETENTION_MS,
  type MediaTaskRecord,
} from '@/services/mediaTaskDomain';
import { startDesktopCaptureWithResourcePriority } from '@/desktop/captureResourceGate';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function coordinator() {
  const persisted: MediaTaskRecord[] = [];
  let sequence = 0;
  return {
    persisted,
    value: new MediaTaskCoordinator({
      persist: async (task) => { persisted.push(structuredClone(task)); },
      now: () => 100 + sequence,
      createId: () => `task-${++sequence}`,
    }),
  };
}

test('local heavy tasks run serially while network tasks can run in parallel', async () => {
  const { value } = coordinator();
  const firstDone = deferred<{ resultRef: string }>();
  const starts: string[] = [];
  const heavyRunner: MediaTaskRunner = async (_report, signal) => {
    starts.push('heavy-1');
    expect(signal.aborted).toBe(false);
    return firstDone.promise;
  };
  const secondRunner: MediaTaskRunner = async () => {
    starts.push('heavy-2');
    return { resultRef: 'second' };
  };
  const networkRunner: MediaTaskRunner = async () => {
    starts.push('network');
    return { resultRef: 'remote' };
  };

  const first = value.startTask({ recordingId: 'r1', kind: 'export', resourceClass: 'local_heavy' }, heavyRunner);
  const second = value.startTask({ recordingId: 'r1', kind: 'noise_reduction', resourceClass: 'local_heavy' }, secondRunner);
  const network = value.startTask({ recordingId: 'r1', kind: 'key_point_motion', resourceClass: 'network' }, networkRunner);

  await expect.poll(() => starts).toEqual(['heavy-1', 'network']);
  await network;
  firstDone.resolve({ resultRef: 'first' });
  await Promise.all([first, second]);
  expect(starts).toEqual(['heavy-1', 'network', 'heavy-2']);
});

test('duplicate active task returns the existing execution and snapshots config', async () => {
  const { value } = coordinator();
  const done = deferred<{ resultRef: string }>();
  let calls = 0;
  const runner: MediaTaskRunner = async () => {
    calls += 1;
    return done.promise;
  };
  const config = { aspectRatio: '16:9', nested: { fps: 15 } };

  const first = value.startTask({
    recordingId: 'r1',
    kind: 'export',
    resourceClass: 'local_heavy',
    configSnapshot: config,
  }, runner);
  config.nested.fps = 30;
  const duplicate = value.startTask({ recordingId: 'r1', kind: 'export', resourceClass: 'local_heavy' }, runner);

  expect(duplicate).toBe(first);
  expect(value.snapshot()[0].configSnapshot).toEqual({ aspectRatio: '16:9', nested: { fps: 15 } });
  done.resolve({ resultRef: 'export-blob' });
  await first;
  expect(calls).toBe(1);
});

test('task progress persists phase eta and checkpoint for the task center', async () => {
  const { value, persisted } = coordinator();
  await value.startTask({ recordingId: 'r1', kind: 'auto_edit', resourceClass: 'local_heavy' }, async (report) => {
    report({ phase: 'scene_coarse', ratio: 0.42, etaMs: 12_000, checkpoint: { segmentIndex: 3 } });
    return { resultRef: 'auto-edit-cache:r1' };
  });

  expect(persisted).toContainEqual(expect.objectContaining({
    kind: 'auto_edit',
    phase: 'scene_coarse',
    progress: 0.42,
    etaMs: 12_000,
    checkpoint: { segmentIndex: 3 },
  }));
  expect(value.snapshot()[0]).toMatchObject({
    status: 'completed',
    phase: 'completed',
    progress: 1,
    resultRef: 'auto-edit-cache:r1',
  });
});

test('native capture preempts an active media task and leaves it resumable', async () => {
  const { value } = coordinator();
  const started = deferred<void>();
  const execution = value.startTask(
    { recordingId: 'r1', kind: 'export', resourceClass: 'local_heavy' },
    async (_report, signal) => {
      started.resolve();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  );
  await started.promise;

  let nativeStarted = false;
  await startDesktopCaptureWithResourcePriority({}, {
    invoke: async () => {
      nativeStarted = true;
      return { state: 'recording' };
    },
  });
  const task = await execution;

  expect(nativeStarted).toBe(true);
  expect(task).toMatchObject({ status: 'paused', phase: 'paused' });
});

test('completion cue only reacts to newly completed tasks', () => {
  const base: MediaTaskRecord = {
    id: 'task-1', recordingId: 'r1', kind: 'export', status: 'running', progress: 0.8,
    createdAt: 1, updatedAt: 2,
  };
  expect(collectNewlyCompletedTaskIds([base], [{ ...base, status: 'completed' }])).toEqual(['task-1']);
  expect(collectNewlyCompletedTaskIds([{ ...base, status: 'completed' }], [{ ...base, status: 'completed' }])).toEqual([]);
  expect(collectNewlyCompletedTaskIds([base], [{ ...base, status: 'failed' }])).toEqual([]);
});

test('completed tasks remain visible for exactly three seconds', () => {
  const completedAt = 10_000;
  const task: MediaTaskRecord = {
    id: 'task-complete', recordingId: 'r1', kind: 'export', status: 'completed', progress: 1,
    createdAt: 1, updatedAt: completedAt,
  };

  expect(MEDIA_TASK_COMPLETION_RETENTION_MS).toBe(3_000);
  expect(isMediaTaskVisible(task, 'r1', completedAt + 2_999)).toBe(true);
  expect(isMediaTaskVisible(task, 'r1', completedAt + 3_000)).toBe(false);
});
