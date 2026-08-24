import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  loadNativeTeachingRecordingEvents,
  runNativeDirectorArtifactPipeline,
  type NativeDirectorPipelineRequest,
} from '../../apps/desktop/src/nativeDirectorPipeline';

type Producer = 'native-input' | 'main-whiteboard' | 'desktop-ink';

interface EventInput {
  atUs: number;
  producerId: Producer;
  producerEpoch: string;
  producerSequence: number;
  surfaceId: string;
  kind: string;
  payload: Record<string, unknown>;
}

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'director-native-'));
  await mkdir(path.join(root, 'segments', 'input-telemetry'), { recursive: true });
  return root;
}

function authoritativeEvent(sessionId: string, input: EventInput): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sessionId,
    atUs: input.atUs,
    kind: input.kind,
    producerId: input.producerId,
    producerEpoch: input.producerEpoch,
    producerSequence: input.producerSequence,
    surfaceId: input.surfaceId,
    ...input.payload,
  };
}

async function writeRecording(root: string, recordingId: string, batches: EventInput[][], extraTracks: Record<string, unknown> = {}): Promise<void> {
  const segments = [];
  for (let index = 0; index < batches.length; index += 1) {
    const events = batches[index].map((event) => authoritativeEvent(recordingId, event));
    const startUs = events[0].atUs as number;
    const endUs = events.at(-1)?.atUs as number;
    const body = JSON.stringify({ schemaVersion: 1, sessionId: recordingId, index, startUs, endUs, events });
    const relativePath = `segments/input-telemetry/${String(index).padStart(6, '0')}.segment`;
    await writeFile(path.join(root, relativePath), body);
    segments.push({ index, relativePath, startUs, durationUs: endUs - startUs + 1, byteLength: Buffer.byteLength(body) });
  }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    recordingId,
    state: 'ready',
    tracks: {
      screen: [], camera: [], microphone: [], 'system-audio': [], 'excalidraw-events': [],
      'input-telemetry': segments,
      ...extraTracks,
    },
  }));
}

function request(root: string, recordingId = 'lesson-native'): NativeDirectorPipelineRequest {
  return {
    projectRoot: root,
    sourceRecordingId: recordingId,
    sessionId: recordingId,
    durationUs: 10_000,
    profile: 'Balanced',
    speechActivity: [],
  };
}

const nativeCoordinateMetadata = {
  sourceCoordinateSpace: 'macos-global-display-points-v1',
  coordinateSpaceVersion: 1,
  displayId: 1,
  scale: 2,
};

test('consumes manifest-owned mixed native, whiteboard, and desktop ink segments in global order', async () => {
  const root = await project();
  await writeRecording(root, 'lesson-native', [
    [
      { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0, surfaceId: 'macos-global', kind: 'active-window', payload: { application: 'Safari', bundleIdentifier: 'com.apple.Safari', processId: 41, windowId: 9, title: 'Lesson' } },
      { atUs: 1_001, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 1, surfaceId: 'macos-global', kind: 'window-bounds', payload: { x: 100, y: 100, width: 1_000, height: 800 } },
      { atUs: 1_002, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 2, surfaceId: 'macos-global', kind: 'click', payload: { x: 400, y: 300, button: 'primary', phase: 'down', sourceCoordinateSpace: 'macos-global-display-points-v1', coordinateSpaceVersion: 1, displayId: 1, scale: 2 } },
      { atUs: 1_003, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 3, surfaceId: 'macos-global', kind: 'scroll', payload: { x: 500, y: 350, deltaX: 0, deltaY: 12, sourceCoordinateSpace: 'macos-global-display-points-v1', coordinateSpaceVersion: 1, displayId: 1, scale: 2 } },
    ],
    [{ atUs: 2_000, producerId: 'main-whiteboard', producerEpoch: 'board-a', producerSequence: 0, surfaceId: 'whiteboard-1', kind: 'ink', payload: { operation: 'stroke', payload: { bbox: { x: 0.2, y: 0.2, width: 0.3, height: 0.2 } } } }],
    [{ atUs: 3_000, producerId: 'desktop-ink', producerEpoch: 'ink-a', producerSequence: 0, surfaceId: 'desktop-overlay', kind: 'undo', payload: { scope: 'ink', steps: 1 } }],
  ]);
  const result = await runNativeDirectorArtifactPipeline({
    ...request(root),
    speechActivity: [{ startUs: 900, endUs: 2_500, confidence: 0.9, semanticStatus: 'recognized' }],
  });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  expect(result.evidence).toMatchObject({ telemetrySegmentsRead: 3, eventCount: 6, retainedPlannerEventCount: 6, roiObservationCount: 3, preservedMedia: true });
  expect(result.checkpoint.status).toBe('ready');
  const pointer = JSON.parse(await readFile(path.join(root, 'director', 'current.json'), 'utf8')) as { checkpointId: string };
  expect(pointer.checkpointId).toBe(result.checkpoint.checkpointId);
  const attention = JSON.parse(await readFile(path.join(root, 'director', pointer.checkpointId ? 'checkpoints' : '', pointer.checkpointId, 'attention.json'), 'utf8')) as { payload: { windows: unknown[] } };
  expect(attention.payload.windows.length).toBeGreaterThan(0);
});

test('consumes multiple authoritative 100 ms batches from one append-only telemetry chunk', async () => {
  const root = await project();
  const recordingId = 'lesson-chunked';
  const firstEvents = [authoritativeEvent(recordingId, {
    atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0,
    surfaceId: 'macos-global', kind: 'click',
    payload: { x: 20, y: 30, button: 'primary', phase: 'down', ...nativeCoordinateMetadata },
  })];
  const secondEvents = [authoritativeEvent(recordingId, {
    atUs: 101_000, producerId: 'main-whiteboard', producerEpoch: 'board-a', producerSequence: 0,
    surfaceId: 'whiteboard-1', kind: 'ink', payload: { operation: 'stroke', payload: { points: [[1, 2]] } },
  })];
  const body = [
    JSON.stringify({ schemaVersion: 1, sessionId: recordingId, index: 0, startUs: 1_000, endUs: 1_000, events: firstEvents }),
    JSON.stringify({ schemaVersion: 1, sessionId: recordingId, index: 1, startUs: 101_000, endUs: 101_000, events: secondEvents }),
  ].join('\n') + '\n';
  const relativePath = 'segments/input-telemetry/000000.segment';
  await writeFile(path.join(root, relativePath), body);
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    recordingId,
    state: 'ready',
    tracks: {
      screen: [], camera: [], microphone: [], 'system-audio': [], 'excalidraw-events': [],
      'input-telemetry': [{ index: 0, relativePath, startUs: 1_000, durationUs: 100_001, byteLength: Buffer.byteLength(body) }],
    },
  }));

  await expect(loadNativeTeachingRecordingEvents({
    projectRoot: root, recordingId, durationUs: 200_000,
  })).resolves.toMatchObject([
    { kind: 'emphasis', atMs: 1 },
    { kind: 'data-point', atMs: 101 },
  ]);
  await expect(runNativeDirectorArtifactPipeline({
    ...request(root, recordingId), durationUs: 200_000,
  })).resolves.toMatchObject({
    status: 'ready',
    evidence: { telemetrySegmentsRead: 1, eventCount: 2 },
  });
});

test('rejects unknown tracks, producer sequence gaps, path authority, and escaped manifest paths', async () => {
  const unknownTrackRoot = await project();
  await writeRecording(unknownTrackRoot, 'lesson-native', [[
    { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0, surfaceId: 'macos-global', kind: 'cursor', payload: { x: 1, y: 2 } },
  ]], { mystery: [] });
  await expect(runNativeDirectorArtifactPipeline(request(unknownTrackRoot))).resolves.toMatchObject({ status: 'failed', retryable: false, code: 'director_native_manifest_track_invalid' });

  const gapRoot = await project();
  await writeRecording(gapRoot, 'lesson-native', [[
    { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 1, surfaceId: 'macos-global', kind: 'cursor', payload: { ...nativeCoordinateMetadata, x: 1, y: 2 } },
  ]]);
  await expect(runNativeDirectorArtifactPipeline(request(gapRoot))).resolves.toMatchObject({ status: 'failed', code: 'director_native_event_sequence_invalid' });

  const authorityRoot = await project();
  await writeRecording(authorityRoot, 'lesson-native', [[
    { atUs: 1_000, producerId: 'desktop-ink', producerEpoch: 'ink-a', producerSequence: 0, surfaceId: 'desktop-overlay', kind: 'ink', payload: { operation: 'stroke', payload: { relativePath: '../../secret' } } },
  ]]);
  await expect(runNativeDirectorArtifactPipeline(request(authorityRoot))).resolves.toMatchObject({ status: 'failed', code: 'director_native_event_schema_invalid' });

  const escapeRoot = await project();
  await writeRecording(escapeRoot, 'lesson-native', [[
    { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0, surfaceId: 'macos-global', kind: 'cursor', payload: { x: 1, y: 2 } },
  ]]);
  const manifest = JSON.parse(await readFile(path.join(escapeRoot, 'manifest.json'), 'utf8')) as { tracks: { 'input-telemetry': Array<{ relativePath: string }> } };
  manifest.tracks['input-telemetry'][0].relativePath = '../outside.json';
  await writeFile(path.join(escapeRoot, 'manifest.json'), JSON.stringify(manifest));
  await expect(runNativeDirectorArtifactPipeline(request(escapeRoot))).resolves.toMatchObject({ status: 'failed', code: 'director_native_segment_path_invalid' });
});

test('rejects symlinked and oversized telemetry without following untrusted disk authority', async () => {
  const symlinkRoot = await project();
  await writeRecording(symlinkRoot, 'lesson-native', [[
    { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0, surfaceId: 'macos-global', kind: 'cursor', payload: { x: 1, y: 2 } },
  ]]);
  const segment = path.join(symlinkRoot, 'segments', 'input-telemetry', '000000.segment');
  const outside = path.join(await project(), 'outside.json');
  await writeFile(outside, await readFile(segment));
  await import('node:fs/promises').then(({ unlink }) => unlink(segment));
  await symlink(outside, segment);
  await expect(runNativeDirectorArtifactPipeline(request(symlinkRoot))).resolves.toMatchObject({ status: 'failed', code: 'director_native_segment_symlink' });

  const oversizedRoot = await project();
  await writeRecording(oversizedRoot, 'lesson-native', [[
    { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0, surfaceId: 'macos-global', kind: 'cursor', payload: { x: 1, y: 2 } },
  ]]);
  await expect(runNativeDirectorArtifactPipeline({ ...request(oversizedRoot), limits: { maximumSegmentBytes: 32 } })).resolves.toMatchObject({ status: 'failed', code: 'director_native_segment_oversized' });
});

test('accepts renderer producer sequence gaps caused by acknowledged paused batches without inventing events', async () => {
  const root = await project();
  await writeRecording(root, 'lesson-native', [
    [{ atUs: 1_000, producerId: 'main-whiteboard', producerEpoch: 'board-a', producerSequence: 4, surfaceId: 'whiteboard-1', kind: 'mode-change', payload: { mode: 'whiteboard' } }],
    [{ atUs: 2_000, producerId: 'main-whiteboard', producerEpoch: 'board-a', producerSequence: 9, surfaceId: 'whiteboard-1', kind: 'undo', payload: { scope: 'ink', steps: 1 } }],
    [{ atUs: 3_000, producerId: 'desktop-ink', producerEpoch: 'ink-a', producerSequence: 12, surfaceId: 'desktop-overlay', kind: 'ink', payload: { operation: 'stroke', payload: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } } }],
  ]);
  await expect(runNativeDirectorArtifactPipeline(request(root))).resolves.toMatchObject({
    status: 'ready',
    evidence: { eventCount: 3, retainedPlannerEventCount: 3 },
  });

  const decrease = await project();
  await writeRecording(decrease, 'lesson-native', [
    [{ atUs: 1_000, producerId: 'main-whiteboard', producerEpoch: 'board-a', producerSequence: 7, surfaceId: 'whiteboard-1', kind: 'mode-change', payload: { mode: 'whiteboard' } }],
    [{ atUs: 2_000, producerId: 'main-whiteboard', producerEpoch: 'board-a', producerSequence: 6, surfaceId: 'whiteboard-1', kind: 'undo', payload: { scope: 'ink', steps: 1 } }],
  ]);
  await expect(runNativeDirectorArtifactPipeline(request(decrease))).resolves.toMatchObject({
    status: 'failed', code: 'director_native_event_sequence_invalid',
  });
});

test('rejects corrupt batch schema, index, session, producer, duplicates, and non-monotonic time', async () => {
  async function oneEventRoot(): Promise<string> {
    const root = await project();
    await writeRecording(root, 'lesson-native', [[
      { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0, surfaceId: 'macos-global', kind: 'cursor', payload: { x: 1, y: 2 } },
    ]]);
    return root;
  }
  async function mutateSegment(root: string, mutate: (batch: Record<string, unknown>) => void): Promise<void> {
    const candidate = path.join(root, 'segments', 'input-telemetry', '000000.segment');
    const batch = JSON.parse(await readFile(candidate, 'utf8')) as Record<string, unknown>;
    mutate(batch);
    const body = JSON.stringify(batch);
    await writeFile(candidate, body);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) as { tracks: { 'input-telemetry': Array<{ byteLength: number }> } };
    manifest.tracks['input-telemetry'][0].byteLength = Buffer.byteLength(body);
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  }

  const corrupt = await oneEventRoot();
  const corruptPath = path.join(corrupt, 'segments', 'input-telemetry', '000000.segment');
  await writeFile(corruptPath, '{broken');
  const corruptManifest = JSON.parse(await readFile(path.join(corrupt, 'manifest.json'), 'utf8')) as { tracks: { 'input-telemetry': Array<{ byteLength: number }> } };
  corruptManifest.tracks['input-telemetry'][0].byteLength = 7;
  await writeFile(path.join(corrupt, 'manifest.json'), JSON.stringify(corruptManifest));
  await expect(runNativeDirectorArtifactPipeline(request(corrupt))).resolves.toMatchObject({ status: 'failed', code: 'director_native_segment_corrupt' });

  const schema = await oneEventRoot();
  await mutateSegment(schema, (batch) => { batch.schemaVersion = 2; });
  await expect(runNativeDirectorArtifactPipeline(request(schema))).resolves.toMatchObject({ status: 'failed', code: 'director_native_batch_schema_invalid' });

  const index = await oneEventRoot();
  await mutateSegment(index, (batch) => { batch.index = 1; });
  await expect(runNativeDirectorArtifactPipeline(request(index))).resolves.toMatchObject({ status: 'failed', code: 'director_native_batch_schema_invalid' });

  const session = await oneEventRoot();
  await mutateSegment(session, (batch) => { ((batch.events as Array<Record<string, unknown>>)[0]).sessionId = 'other'; });
  await expect(runNativeDirectorArtifactPipeline(request(session))).resolves.toMatchObject({ status: 'failed', code: 'director_native_event_schema_invalid' });

  const producer = await oneEventRoot();
  await mutateSegment(producer, (batch) => { ((batch.events as Array<Record<string, unknown>>)[0]).producerId = 'browser-spoof'; });
  await expect(runNativeDirectorArtifactPipeline(request(producer))).resolves.toMatchObject({ status: 'failed', code: 'director_native_event_schema_invalid' });

  const duplicate = await project();
  await writeRecording(duplicate, 'lesson-native', [[
    { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0, surfaceId: 'macos-global', kind: 'cursor', payload: { ...nativeCoordinateMetadata, x: 1, y: 2 } },
    { atUs: 1_001, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0, surfaceId: 'macos-global', kind: 'cursor', payload: { ...nativeCoordinateMetadata, x: 2, y: 3 } },
  ]]);
  await expect(runNativeDirectorArtifactPipeline(request(duplicate))).resolves.toMatchObject({ status: 'failed', code: 'director_native_event_sequence_invalid' });

  const time = await project();
  await writeRecording(time, 'lesson-native', [[
    { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0, surfaceId: 'macos-global', kind: 'cursor', payload: { ...nativeCoordinateMetadata, x: 1, y: 2 } },
    { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 1, surfaceId: 'macos-global', kind: 'cursor', payload: { ...nativeCoordinateMetadata, x: 2, y: 3 } },
  ]]);
  await expect(runNativeDirectorArtifactPipeline(request(time))).resolves.toMatchObject({ status: 'failed', code: 'director_native_event_time_invalid' });
});

test('classifies representative invalid native payloads as non-retryable schema failures', async () => {
  const cases: Array<{ name: string; event: EventInput }> = [
    {
      name: 'invalid click phase',
      event: {
        atUs: 1_000,
        producerId: 'native-input',
        producerEpoch: 'native-a',
        producerSequence: 0,
        surfaceId: 'macos-global',
        kind: 'click',
        payload: { x: 100, y: 200, button: 'primary', phase: 'pressed' },
      },
    },
    {
      name: 'zero window width',
      event: {
        atUs: 1_000,
        producerId: 'native-input',
        producerEpoch: 'native-a',
        producerSequence: 0,
        surfaceId: 'macos-global',
        kind: 'window-bounds',
        payload: { windowId: 9, x: 0, y: 0, width: 0, height: 800 },
      },
    },
    {
      name: 'negative window height',
      event: {
        atUs: 1_000,
        producerId: 'native-input',
        producerEpoch: 'native-a',
        producerSequence: 0,
        surfaceId: 'macos-global',
        kind: 'window-bounds',
        payload: { windowId: 9, x: 0, y: 0, width: 1_000, height: -1 },
      },
    },
    {
      name: 'nonnumeric scroll delta',
      event: {
        atUs: 1_000,
        producerId: 'native-input',
        producerEpoch: 'native-a',
        producerSequence: 0,
        surfaceId: 'macos-global',
        kind: 'scroll',
        payload: { x: 100, y: 200, deltaX: 'fast', deltaY: 1 },
      },
    },
  ];

  for (const fixture of cases) {
    const root = await project();
    await writeRecording(root, 'lesson-native', [[fixture.event]]);
    await expect(runNativeDirectorArtifactPipeline(request(root)), fixture.name).resolves.toEqual(expect.objectContaining({
      status: 'failed',
      retryable: false,
      code: 'director_native_event_schema_invalid',
    }));
  }
});

test('keeps unrelated internal writer failures retryable instead of reclassifying them as schema errors', async () => {
  const root = await project();
  await writeRecording(root, 'lesson-native', [[
    { atUs: 1_000, producerId: 'main-whiteboard', producerEpoch: 'board-a', producerSequence: 0, surfaceId: 'whiteboard-1', kind: 'mode-change', payload: { mode: 'whiteboard' } },
  ]]);
  await expect(runNativeDirectorArtifactPipeline({
    ...request(root),
    writerFaults: { beforePublishCurrent: () => { throw new Error('unexpected-internal'); } },
  })).resolves.toMatchObject({
    status: 'failed',
    retryable: true,
    code: 'director_native_artifact_write_failed',
  });
});

test('strictly validates native wire payload metadata while preserving a valid production sequence', async () => {
  const validCursor = {
    x: 100,
    y: 200,
    sourceCoordinateSpace: 'macos-global-display-points-v1',
    coordinateSpaceVersion: 1,
    displayId: 1,
    scale: 2,
  };
  const invalidCases: Array<{ name: string; payload: Record<string, unknown> }> = [
    { name: 'missing x', payload: { ...validCursor, x: undefined } },
    { name: 'nonnumeric y', payload: { ...validCursor, y: '200' } },
    { name: 'invalid coordinate space', payload: { ...validCursor, sourceCoordinateSpace: 'screen-points' } },
    { name: 'invalid coordinate-space version', payload: { ...validCursor, coordinateSpaceVersion: 2 } },
    { name: 'invalid display id', payload: { ...validCursor, displayId: 0 } },
    { name: 'invalid scale', payload: { ...validCursor, scale: 0 } },
    { name: 'missing application', payload: { bundleIdentifier: 'com.apple.Safari', processId: 41, windowId: 9 } },
    { name: 'missing bundle identifier', payload: { application: 'Safari', processId: 41, windowId: 9 } },
    { name: 'invalid process id', payload: { application: 'Safari', bundleIdentifier: 'com.apple.Safari', processId: 0, windowId: 9 } },
    { name: 'bounds without active window', payload: { x: 0, y: 0, width: 1_000, height: 800 } },
  ];

  for (const fixture of invalidCases) {
    const root = await project();
    const kind = fixture.name.includes('application') || fixture.name.includes('bundle') || fixture.name.includes('process')
      ? 'active-window'
      : fixture.name === 'bounds without active window' ? 'window-bounds' : 'cursor';
    await writeRecording(root, 'lesson-native', [[{
      atUs: 1_000,
      producerId: 'native-input',
      producerEpoch: 'native-a',
      producerSequence: 0,
      surfaceId: 'macos-global',
      kind,
      payload: fixture.payload,
    }]]);
    await expect(runNativeDirectorArtifactPipeline(request(root)), fixture.name).resolves.toEqual(expect.objectContaining({
      status: 'failed',
      retryable: false,
      code: 'director_native_event_schema_invalid',
    }));
  }

  const invalidWireIdentityCases: Array<{ name: string; event: EventInput }> = [
    {
      name: 'native producer cannot impersonate a whiteboard event kind',
      event: {
        atUs: 1_000,
        producerId: 'native-input',
        producerEpoch: 'native-a',
        producerSequence: 0,
        surfaceId: 'macos-global',
        kind: 'ink',
        payload: { operation: 'stroke', payload: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } },
      },
    },
    {
      name: 'native pointer must use the Swift macos-global surface',
      event: {
        atUs: 1_000,
        producerId: 'native-input',
        producerEpoch: 'native-a',
        producerSequence: 0,
        surfaceId: 'whiteboard-1',
        kind: 'cursor',
        payload: validCursor,
      },
    },
  ];
  for (const fixture of invalidWireIdentityCases) {
    const root = await project();
    await writeRecording(root, 'lesson-native', [[fixture.event]]);
    await expect(runNativeDirectorArtifactPipeline(request(root)), fixture.name).resolves.toEqual(expect.objectContaining({
      status: 'failed',
      retryable: false,
      code: 'director_native_event_schema_invalid',
    }));
  }

  const validRoot = await project();
  await writeRecording(validRoot, 'lesson-native', [[
    { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0, surfaceId: 'macos-global', kind: 'active-window', payload: { application: 'Safari', bundleIdentifier: 'com.apple.Safari', processId: 41, windowId: 9, title: 'Lesson' } },
    { atUs: 1_001, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 1, surfaceId: 'macos-global', kind: 'window-bounds', payload: { x: 0, y: 0, width: 1_000, height: 800 } },
    { atUs: 1_002, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 2, surfaceId: 'macos-global', kind: 'cursor', payload: validCursor },
    { atUs: 1_003, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 3, surfaceId: 'macos-global', kind: 'click', payload: { ...validCursor, button: 'other', phase: 'down' } },
    { atUs: 1_004, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 4, surfaceId: 'macos-global', kind: 'scroll', payload: { ...validCursor, deltaX: 0, deltaY: 12 } },
  ]]);
  await expect(runNativeDirectorArtifactPipeline(request(validRoot))).resolves.toMatchObject({
    status: 'ready',
    evidence: { eventCount: 5, roiObservationCount: 3 },
  });
});

test('stream-reduces thousands of high-frequency events with bounded retained planner state', async () => {
  const root = await project();
  const raw: EventInput[] = [
    { atUs: 1_000, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 0, surfaceId: 'macos-global', kind: 'active-window', payload: { application: 'Safari', bundleIdentifier: 'com.apple.Safari', processId: 41, windowId: 9, title: 'Lesson' } },
    { atUs: 1_001, producerId: 'native-input', producerEpoch: 'native-a', producerSequence: 1, surfaceId: 'macos-global', kind: 'window-bounds', payload: { x: 0, y: 0, width: 1_000, height: 800 } },
  ];
  for (let index = 0; index < 5_000; index += 1) {
    raw.push({
      atUs: 1_100 + index * 100,
      producerId: 'native-input',
      producerEpoch: 'native-a',
      producerSequence: index + 2,
      surfaceId: 'macos-global',
      kind: index % 2 === 0 ? 'cursor' : 'scroll',
      payload: index % 2 === 0
        ? { ...nativeCoordinateMetadata, x: 300 + (index % 5), y: 200 + (index % 5) }
        : { ...nativeCoordinateMetadata, x: 300, y: 200, deltaX: 0, deltaY: 1 },
    });
  }
  const batches: EventInput[][] = [];
  for (let index = 0; index < raw.length; index += 200) batches.push(raw.slice(index, index + 200));
  await writeRecording(root, 'lesson-native', batches);
  const longRequest = { ...request(root), durationUs: 1_000_000, limits: { maximumEvents: 5_002 } };
  const result = await runNativeDirectorArtifactPipeline(longRequest);
  expect(result).toMatchObject({
    status: 'ready',
    evidence: {
      telemetrySegmentsRead: 26,
      eventCount: 5_002,
      retainedPlannerEventCount: 3,
      roiObservationCount: 2,
    },
  });
  expect(result.evidence.maximumSegmentBytesRead).toBeLessThan(100_000);

  const overBudget = await runNativeDirectorArtifactPipeline({ ...longRequest, limits: { maximumEvents: 5_001 } });
  expect(overBudget).toMatchObject({ status: 'failed', retryable: false, code: 'director_native_event_budget_exceeded' });
});

test('fails explicitly rather than dropping lossless planner events when the retained budget is exhausted', async () => {
  const root = await project();
  await writeRecording(root, 'lesson-native', [[
    { atUs: 1_000, producerId: 'main-whiteboard', producerEpoch: 'board-a', producerSequence: 0, surfaceId: 'whiteboard-1', kind: 'mode-change', payload: { mode: 'whiteboard' } },
    { atUs: 1_001, producerId: 'main-whiteboard', producerEpoch: 'board-a', producerSequence: 1, surfaceId: 'whiteboard-1', kind: 'undo', payload: { scope: 'ink', steps: 1 } },
    { atUs: 1_002, producerId: 'main-whiteboard', producerEpoch: 'board-a', producerSequence: 2, surfaceId: 'whiteboard-1', kind: 'ink', payload: { operation: 'clear', payload: {} } },
  ]]);
  await expect(runNativeDirectorArtifactPipeline({
    ...request(root), limits: { maximumRetainedPlannerEvents: 2 },
  })).resolves.toMatchObject({
    status: 'failed', retryable: false, code: 'director_native_retained_event_budget_exceeded',
  });
});

test('writer failure preserves the published checkpoint and a deterministic retry advances it idempotently', async () => {
  const root = await project();
  await writeRecording(root, 'lesson-native', [[
    { atUs: 1_000, producerId: 'main-whiteboard', producerEpoch: 'board-a', producerSequence: 0, surfaceId: 'whiteboard-1', kind: 'ink', payload: { operation: 'stroke', payload: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } } },
  ]]);
  const initial = await runNativeDirectorArtifactPipeline(request(root));
  expect(initial.status).toBe('ready');
  if (initial.status !== 'ready') return;
  const originalPointer = await readFile(path.join(root, 'director', 'current.json'), 'utf8');
  const changed = {
    ...request(root),
    speechActivity: [{ startUs: 500, endUs: 2_000, confidence: 0.9, semanticStatus: 'recognized' as const }],
  };
  const failed = await runNativeDirectorArtifactPipeline({
    ...changed,
    writerFaults: { beforePublishCurrent: () => { throw new Error('disk-busy'); } },
  });
  expect(failed).toMatchObject({ status: 'failed', retryable: true, code: 'director_native_artifact_write_failed', evidence: { preservedMedia: true } });
  expect(await readFile(path.join(root, 'director', 'current.json'), 'utf8')).toBe(originalPointer);

  const retry = await runNativeDirectorArtifactPipeline(changed);
  const duplicateRetry = await runNativeDirectorArtifactPipeline(changed);
  expect(retry.status).toBe('ready');
  expect(duplicateRetry.status).toBe('ready');
  if (retry.status === 'ready' && duplicateRetry.status === 'ready') {
    expect(retry.checkpoint.checkpointId).not.toBe(initial.checkpoint.checkpointId);
    expect(duplicateRetry.checkpoint.checkpointId).toBe(retry.checkpoint.checkpointId);
  }
});
