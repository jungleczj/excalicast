import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  pollDesktopDirectorJob,
  retryDesktopDirectorJob,
  type DesktopDirectorStatusBridge,
} from '@/desktop/directorJobClient';
import type { DesktopDirectorJobStatus } from '@/desktop/productContract';

function status(
  recordingId: string,
  phase: DesktopDirectorJobStatus['status'],
): DesktopDirectorJobStatus {
  return {
    recordingId,
    status: phase,
    code: phase === 'failed' ? 'director_native_artifact_write_failed' : `director_job_${phase}`,
    retryable: phase === 'failed',
    ...(phase === 'ready'
      ? {
          checkpoint: {
            owner: 'recording-manifest' as const,
            reference: 'director/current.json' as const,
            checkpointId: `director-${'a'.repeat(64)}`,
          },
        }
      : {}),
    evidence: {
      profile: 'Balanced',
      speechActivity: 'unavailable',
      speechIntervalCount: 0,
      preservedMedia: true,
      recoveredCheckpoint: false,
    },
  };
}

test('editor polling reflects pending, generating and ready without sending path authority', async () => {
  const responses = [
    status('lesson-client', 'pending'),
    status('lesson-client', 'generating'),
    status('lesson-client', 'ready'),
  ];
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const reflected: string[] = [];
  let waits = 0;
  const bridge: DesktopDirectorStatusBridge = {
    async invoke(channel, payload) {
      calls.push({ channel, payload });
      const response = responses.shift();
      if (!response) throw new Error('unexpected_poll');
      return response;
    },
  };

  await expect(pollDesktopDirectorJob({
    bridge,
    recordingId: 'lesson-client',
    onStatus(value) { reflected.push(value.status); },
    wait: async () => { waits += 1; },
  })).resolves.toMatchObject({ status: 'ready' });
  expect(reflected).toEqual(['pending', 'generating', 'ready']);
  expect(waits).toBe(2);
  expect(calls).toEqual([
    { channel: 'project.director-status.v1', payload: { recordingId: 'lesson-client' } },
    { channel: 'project.director-status.v1', payload: { recordingId: 'lesson-client' } },
    { channel: 'project.director-status.v1', payload: { recordingId: 'lesson-client' } },
  ]);
});

test('editor polling stops on failed and rejects malformed or cross-recording status', async () => {
  let calls = 0;
  await expect(pollDesktopDirectorJob({
    recordingId: 'lesson-failed',
    bridge: {
      async invoke() {
        calls += 1;
        return status('lesson-failed', 'failed');
      },
    },
    onStatus() {},
    wait: async () => { throw new Error('terminal_status_must_not_wait'); },
  })).resolves.toMatchObject({ status: 'failed', retryable: true });
  expect(calls).toBe(1);

  for (const response of [{ status: 'ready' }, status('other-recording', 'ready')]) {
    await expect(pollDesktopDirectorJob({
      recordingId: 'lesson-failed',
      bridge: { async invoke() { return response; } },
      onStatus() {},
      wait: async () => undefined,
    })).rejects.toThrow('desktop_director_status_invalid');
  }
});

test('editor polling discards an invoke response that arrives after abort', async () => {
  const controller = new AbortController();
  const reflected: DesktopDirectorJobStatus[] = [];
  let resolveInvoke!: (value: DesktopDirectorJobStatus) => void;
  let markInvoked!: () => void;
  const invoked = new Promise<void>((resolve) => { markInvoked = resolve; });
  const response = new Promise<DesktopDirectorJobStatus>((resolve) => { resolveInvoke = resolve; });
  const polling = pollDesktopDirectorJob({
    recordingId: 'lesson-abort-race',
    signal: controller.signal,
    bridge: {
      async invoke() {
        markInvoked();
        return response;
      },
    },
    onStatus(value) { reflected.push(value); },
  });

  await invoked;
  controller.abort();
  resolveInvoke(status('lesson-abort-race', 'pending'));
  await expect(polling).rejects.toThrow('desktop_director_poll_aborted');
  expect(reflected).toEqual([]);
});

test('explicit retry sends recording identity only and validates the returned status', async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  await expect(retryDesktopDirectorJob({
    recordingId: 'lesson-retry-client',
    bridge: {
      async invoke(channel, payload) {
        calls.push({ channel, payload });
        return status('lesson-retry-client', 'pending');
      },
    },
  })).resolves.toMatchObject({ status: 'pending' });
  expect(calls).toEqual([{
    channel: 'project.director-retry.v1',
    payload: { recordingId: 'lesson-retry-client' },
  }]);

  await expect(retryDesktopDirectorJob({
    recordingId: '../injected',
    bridge: { async invoke() { return status('other', 'ready'); } },
  })).rejects.toThrow('desktop_director_retry_invalid');
  await expect(retryDesktopDirectorJob({
    recordingId: 'lesson-retry-client',
    bridge: { async invoke() { return status('other', 'ready'); } },
  })).rejects.toThrow('desktop_director_retry_invalid');
  await expect(retryDesktopDirectorJob({
    recordingId: 'lesson-retry-client',
    bridge: {
      async invoke() {
        return { ...status('lesson-retry-client', 'pending'), retryable: true };
      },
    },
  })).rejects.toThrow('desktop_director_retry_invalid');
});

test('native editor load wires status polling without coupling browser recording stop', async () => {
  const source = await readFile(
    path.join(process.cwd(), 'src/app/[locale]/export/[id]/page.tsx'),
    'utf8',
  );
  expect(source).toContain('pollDesktopDirectorJob({');
  expect(source).toContain('nativeProject: { ...current.nativeProject, director }');
  expect(source).toContain('if (error.message !== \'desktop_director_poll_aborted\')');
  expect(source).toContain('retryDesktopDirectorJob({');
  expect(source).toContain('data-testid="desktop-director-retry"');
});
