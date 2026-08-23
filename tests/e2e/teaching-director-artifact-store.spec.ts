import { expect, test } from '@playwright/test';

import type { AttentionObservation } from '@/desktop/attentionEngine';
import {
  DirectorArtifactPersistenceService,
  MemoryDirectorArtifactWriter,
  type DirectorArtifactPersistenceInput,
} from '@/desktop/teachingDirectorArtifactStore';
import type { UnifiedEvent } from '@/desktop/unifiedEventSchema';

function input(): DirectorArtifactPersistenceInput {
  const events: UnifiedEvent[] = [
    { schemaVersion: 1, sessionId: 'session-store-1', atUs: 1_000_000, kind: 'click', x: 0.5, y: 0.5, button: 'primary', phase: 'down' },
    { schemaVersion: 1, sessionId: 'session-store-1', atUs: 1_100_000, kind: 'dwell', x: 0.5, y: 0.5, durationUs: 700_000 },
    { schemaVersion: 1, sessionId: 'session-store-1', atUs: 4_000_000, kind: 'undo', scope: 'ink', steps: 1 },
  ];
  const roiObservations: AttentionObservation[] = [{
    id: 'focus-evidence',
    sceneId: 'scene-1',
    roiId: 'formula',
    atMs: 1_000,
    bbox: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
    features: {
      inkActivity: 0,
      speechReference: 1,
      clickDwell: 1,
      objectSalience: 1,
      windowFocus: 1,
      recency: 1,
      motionNoise: 0,
      uiControlPenalty: 0,
    },
  }];
  return {
    recording: {
      sourceRecordingId: 'recording-store-1',
      sessionId: 'session-store-1',
      durationUs: 6_000_000,
      profile: 'Balanced',
    },
    events,
    speechActivity: [{ startUs: 900_000, endUs: 2_000_000, confidence: 0.98, semanticStatus: 'recognized' }],
    roiObservations,
  };
}

test('atomically writes deterministic artifact bytes and a manifest-owned ready index', async () => {
  const writer = new MemoryDirectorArtifactWriter();
  const store = new DirectorArtifactPersistenceService(writer);
  const index = await store.persist(input());

  expect(index).toMatchObject({
    schemaVersion: 1,
    indexVersion: 'teaching-director-artifact-index-v1',
    owner: 'recording-manifest',
    sourceRecordingId: 'recording-store-1',
    sessionId: 'session-store-1',
    status: 'ready',
  });
  expect(index.artifacts.map((artifact) => [artifact.fileName, artifact.status])).toEqual([
    ['attention.json', 'ready'],
    ['camera.json', 'ready'],
    ['cleanup.json', 'ready'],
  ]);
  expect(index.artifacts.every((artifact) => artifact.checksum.algorithm === 'sha256'
    && /^[a-f0-9]{64}$/.test(artifact.checksum.value)
    && artifact.byteLength > 0)).toBe(true);

  for (const artifact of index.artifacts) {
    const bytes = writer.read(artifact.fileName);
    expect(bytes?.byteLength).toBe(artifact.byteLength);
    const decoded = JSON.parse(new TextDecoder().decode(bytes!));
    expect(decoded).toMatchObject({
      schemaVersion: 1,
      sourceRecordingId: 'recording-store-1',
      sessionId: 'session-store-1',
      fileName: artifact.fileName,
    });
  }
  expect(writer.readIndex()).toEqual(index);
  expect(writer.commitCount).toBe(1);
});

test('the same input produces byte-identical files, checksums, and checkpoint identity', async () => {
  const firstWriter = new MemoryDirectorArtifactWriter();
  const secondWriter = new MemoryDirectorArtifactWriter();
  const first = await new DirectorArtifactPersistenceService(firstWriter).persist(input());
  const second = await new DirectorArtifactPersistenceService(secondWriter).persist(structuredClone(input()));

  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  for (const fileName of ['attention.json', 'camera.json', 'cleanup.json'] as const) {
    expect([...firstWriter.read(fileName)!]).toEqual([...secondWriter.read(fileName)!]);
  }
});

test('failed checkpoint publishes no files or ready status, then retries idempotently', async () => {
  const writer = new MemoryDirectorArtifactWriter();
  writer.failNextCheckpoint(new Error('disk_full'));
  const store = new DirectorArtifactPersistenceService(writer);

  await expect(store.persist(input())).rejects.toThrow('disk_full');
  expect(writer.readIndex()).toBeNull();
  expect(writer.read('attention.json')).toBeNull();
  expect(writer.commitCount).toBe(0);
  expect(store.snapshot()).toMatchObject({ status: 'failed' });
  expect(store.snapshot()?.artifacts.every((artifact) => artifact.status === 'failed')).toBe(true);

  const ready = await store.persist(input());
  expect(ready.status).toBe('ready');
  expect(writer.commitCount).toBe(1);
  const retry = await store.persist(structuredClone(input()));
  expect(retry).toEqual(ready);
  expect(writer.commitCount).toBe(1);
});

test('cross-session events are rejected before a checkpoint is attempted', async () => {
  const writer = new MemoryDirectorArtifactWriter();
  const store = new DirectorArtifactPersistenceService(writer);
  const value = input();
  value.events = [{ ...value.events[0], sessionId: 'another-session' }];

  await expect(store.persist(value)).rejects.toThrow('teaching_director_store_session_mismatch');
  expect(writer.checkpointAttempts).toBe(0);
  expect(writer.readIndex()).toBeNull();
});
