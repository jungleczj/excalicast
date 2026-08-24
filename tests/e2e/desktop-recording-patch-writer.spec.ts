import { expect, test } from '@playwright/test';

import { createRevisionedRecordingPatchWriter } from '../../src/desktop/recordingPatchWriter';

test('recording patches are serialized and the newest revision wins without full-row snapshots', async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const persisted: Array<{ teachingRecipeStatus: string }> = [];
  const writer = createRevisionedRecordingPatchWriter(async (recordingId, patch) => {
    events.push(`start:${recordingId}:${patch.teachingRecipeStatus}`);
    if (patch.teachingRecipeStatus === 'pending') await firstGate;
    persisted.push({ teachingRecipeStatus: patch.teachingRecipeStatus });
    events.push(`end:${recordingId}:${patch.teachingRecipeStatus}`);
  });

  const first = writer.enqueue('lesson-1', { teachingRecipeStatus: 'pending' });
  await expect.poll(() => events).toEqual(['start:lesson-1:pending']);
  const second = writer.enqueue('lesson-1', { teachingRecipeStatus: 'ready' });
  releaseFirst();
  await Promise.all([first, second]);

  expect(events).toEqual([
    'start:lesson-1:pending', 'end:lesson-1:pending',
    'start:lesson-1:ready', 'end:lesson-1:ready',
  ]);
  expect(persisted.at(-1)).toEqual({ teachingRecipeStatus: 'ready' });
});

test('a queued stale revision is skipped before it can overwrite the latest patch', async () => {
  const persisted: string[] = [];
  const writer = createRevisionedRecordingPatchWriter(async (_recordingId, patch) => {
    persisted.push(patch.teachingRecipeStatus);
  });
  const stale = writer.enqueue('lesson-2', { teachingRecipeStatus: 'pending' });
  const latest = writer.enqueue('lesson-2', { teachingRecipeStatus: 'error' });
  await Promise.all([stale, latest]);
  expect(persisted).toEqual(['error']);
});
