import { expect, test } from '@playwright/test';

import {
  DesktopMediaWorkCoordinator,
  type DesktopFinalRenderIdentity,
} from '../../apps/desktop/src/desktopMediaWorkCoordinator';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function finalIdentity(revision: number, suffix: string): DesktopFinalRenderIdentity {
  return {
    requestId: `final-r${revision}-${suffix.padEnd(32, '0')}`,
    revision,
    intentSha256: suffix.padEnd(64, '0'),
  };
}

test('serializes the post-capture heavy-work lane and exposes stable observable state', async () => {
  const coordinator = new DesktopMediaWorkCoordinator();
  const firstGate = deferred<void>();
  const events: string[] = [];
  const first = coordinator.runWork({
    kind: 'director',
    identity: 'director-1',
    run: async () => {
      events.push('director-start');
      await firstGate.promise;
      events.push('director-end');
      return 'director-ready';
    },
  });
  const second = coordinator.runWork({
    kind: 'teaching',
    identity: 'teaching-1',
    run: async () => {
      events.push('teaching-start');
      return 'teaching-ready';
    },
  });

  await Promise.resolve();
  expect(events).toEqual(['director-start']);
  expect(coordinator.snapshot()).toEqual({
    captureState: 'idle',
    admission: 'open',
    active: [{ kind: 'director', identity: 'director-1' }],
    queued: [{ kind: 'teaching', identity: 'teaching-1' }],
    finalRenderIdentity: null,
  });
  firstGate.resolve();
  await expect(first).resolves.toBe('director-ready');
  await expect(second).resolves.toBe('teaching-ready');
  expect(events).toEqual(['director-start', 'director-end', 'teaching-start']);
});

test('capture closes admission, aborts all work and waits for actual drain before becoming recording', async () => {
  const coordinator = new DesktopMediaWorkCoordinator();
  const released = deferred<void>();
  const work = coordinator.runWork({
    kind: 'materialize',
    identity: 'materialize-1',
    run: async (signal) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      await released.promise;
      throw signal.reason;
    },
  });
  await Promise.resolve();

  const capture = coordinator.prepareCapture({ timeoutMs: 1_000 });
  await Promise.resolve();
  expect(coordinator.snapshot()).toMatchObject({
    captureState: 'preparing',
    admission: 'capture-priority',
    active: [{ kind: 'materialize', identity: 'materialize-1' }],
  });
  await expect(coordinator.runWork({
    kind: 'director', identity: 'late-director', run: async () => undefined,
  })).rejects.toThrow('desktop_media_capture_priority_active');
  expect(coordinator.acquireRangeLease('preview-range')).toBeNull();

  released.resolve();
  await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  const captureLease = await capture;
  expect(coordinator.snapshot()).toMatchObject({
    captureState: 'recording', admission: 'capture-priority', active: [], queued: [],
  });
  captureLease.release();
  expect(coordinator.snapshot()).toMatchObject({ captureState: 'idle', admission: 'open' });
});

test('capture timeout rejects capture but retains a non-draining task as active until it really settles', async () => {
  const coordinator = new DesktopMediaWorkCoordinator();
  const stuck = deferred<void>();
  const work = coordinator.runWork({
    kind: 'director',
    identity: 'stuck-director',
    run: async () => { await stuck.promise; },
  });
  await Promise.resolve();

  await expect(coordinator.prepareCapture({ timeoutMs: 5 }))
    .rejects.toThrow('desktop_media_capture_drain_timeout');
  expect(coordinator.snapshot()).toMatchObject({
    captureState: 'idle',
    admission: 'open',
    active: [{ kind: 'director', identity: 'stuck-director' }],
  });

  const nextStarted = deferred<void>();
  const next = coordinator.runWork({
    kind: 'teaching',
    identity: 'after-timeout',
    run: async () => { nextStarted.resolve(); },
  });
  await Promise.resolve();
  expect(coordinator.snapshot().queued).toEqual([{ kind: 'teaching', identity: 'after-timeout' }]);
  stuck.resolve();
  await work;
  await nextStarted.promise;
  await next;
});

test('range leases are registered, aborted for capture, and cannot be silently released by the coordinator', async () => {
  const coordinator = new DesktopMediaWorkCoordinator();
  const range = coordinator.acquireRangeLease('preview:bytes=0-1023');
  expect(range).not.toBeNull();
  expect(coordinator.snapshot().active).toEqual([
    { kind: 'range', identity: 'preview:bytes=0-1023' },
  ]);

  const capture = coordinator.prepareCapture({ timeoutMs: 5 });
  await expect(capture).rejects.toThrow('desktop_media_capture_drain_timeout');
  expect(range?.signal.aborted).toBe(true);
  expect(coordinator.snapshot().active).toEqual([
    { kind: 'range', identity: 'preview:bytes=0-1023' },
  ]);
  range?.release();
  expect(coordinator.snapshot().active).toEqual([]);
});

test('same final-render intent is singleflight while a newer revision cancels and drains the older render', async () => {
  const coordinator = new DesktopMediaWorkCoordinator();
  const oldDrained = deferred<void>();
  const calls: string[] = [];
  const oldIdentity = finalIdentity(1, 'a');
  const old = coordinator.runFinalRender({
    identity: oldIdentity,
    drainTimeoutMs: 1_000,
    run: async (signal) => {
      calls.push('old-start');
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      await oldDrained.promise;
      throw signal.reason;
    },
  });
  const duplicate = coordinator.runFinalRender({
    identity: oldIdentity,
    run: async () => {
      calls.push('duplicate-start');
      return 'wrong';
    },
  });
  await Promise.resolve();
  expect(calls).toEqual(['old-start']);

  const next = coordinator.runFinalRender({
    identity: finalIdentity(2, 'b'),
    drainTimeoutMs: 1_000,
    run: async () => {
      calls.push('new-start');
      return 'new-ready';
    },
  });
  await Promise.resolve();
  expect(coordinator.snapshot().finalRenderIdentity).toEqual(oldIdentity);
  oldDrained.resolve();
  await expect(old).rejects.toMatchObject({ name: 'AbortError' });
  await expect(duplicate).rejects.toMatchObject({ name: 'AbortError' });
  await expect(next).resolves.toBe('new-ready');
  expect(calls).toEqual(['old-start', 'new-start']);

  await expect(coordinator.runFinalRender({
    identity: oldIdentity,
    run: async () => 'stale',
  })).rejects.toThrow('desktop_media_final_render_revision_stale');
});

test('final render cannot start unless capture is fully idle', async () => {
  const coordinator = new DesktopMediaWorkCoordinator();
  const captureLease = await coordinator.prepareCapture();
  await expect(coordinator.runFinalRender({
    identity: finalIdentity(1, 'c'),
    run: async () => 'unreachable',
  })).rejects.toThrow('desktop_media_capture_priority_active');
  expect(coordinator.snapshot().finalRenderIdentity).toBeNull();
  captureLease.release();
});

test('clears a settled final flight before caller continuation so immediate same-identity retry executes again', async () => {
  const coordinator = new DesktopMediaWorkCoordinator();
  const identity = finalIdentity(1, 'd');
  let runs = 0;
  const firstResult = await coordinator.runFinalRender({
    identity,
    run: async () => { runs += 1; return `ready-${runs}`; },
  });
  expect(firstResult).toBe('ready-1');
  expect(coordinator.snapshot()).toMatchObject({
    active: [], queued: [], finalRenderIdentity: null,
  });

  const secondResult = await coordinator.runFinalRender({
    identity,
    run: async () => { runs += 1; return `ready-${runs}`; },
  });
  expect(secondResult).toBe('ready-2');
  expect(runs).toBe(2);
});

test('clears a rejected final flight before caller catch so immediate same-identity retry executes again', async () => {
  const coordinator = new DesktopMediaWorkCoordinator();
  const identity = finalIdentity(1, 'e');
  let runs = 0;
  const firstError = await coordinator.runFinalRender({
    identity,
    run: async () => {
      runs += 1;
      throw new Error('render_failed_once');
    },
  }).catch((reason: unknown) => reason);
  expect(firstError).toMatchObject({ message: 'render_failed_once' });
  expect(coordinator.snapshot()).toMatchObject({
    active: [], queued: [], finalRenderIdentity: null,
  });

  const secondResult = await coordinator.runFinalRender({
    identity,
    run: async () => { runs += 1; return 'ready-after-retry'; },
  });
  expect(secondResult).toBe('ready-after-retry');
  expect(runs).toBe(2);
});
