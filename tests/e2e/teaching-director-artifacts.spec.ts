import { expect, test } from '@playwright/test';

import type { AttentionObservation } from '@/desktop/attentionEngine';
import {
  buildTeachingDirectorArtifacts,
  type TeachingDirectorArtifactsInput,
} from '@/desktop/teachingDirectorArtifacts';
import type { UnifiedEvent } from '@/desktop/unifiedEventSchema';

const features = (overrides: Partial<AttentionObservation['features']>): AttentionObservation['features'] => ({
  inkActivity: 0,
  speechReference: 0,
  clickDwell: 0,
  objectSalience: 0,
  windowFocus: 1,
  recency: 0,
  motionNoise: 0,
  uiControlPenalty: 0,
  ...overrides,
});

const roi = (
  id: string,
  atMs: number,
  sceneId: string,
  bbox: AttentionObservation['bbox'],
  overrides: Partial<AttentionObservation['features']>,
): AttentionObservation => ({ id, atMs, sceneId, roiId: id, bbox, features: features(overrides) });

function directorInput(): TeachingDirectorArtifactsInput {
  const common = { schemaVersion: 1 as const, sessionId: 'lesson-session-1' };
  const events: UnifiedEvent[] = [
    { ...common, kind: 'click', atUs: 2_100_000, x: 0.68, y: 0.32, button: 'primary', phase: 'down' },
    { ...common, kind: 'dwell', atUs: 2_200_000, x: 0.68, y: 0.32, durationUs: 800_000 },
    { ...common, kind: 'ink', atUs: 4_100_000, operation: 'stroke', payload: { bbox: { x: 0.12, y: 0.52, width: 0.18, height: 0.16 }, safeFrame: true } },
    { ...common, kind: 'ink', atUs: 7_100_000, operation: 'stroke', payload: { bbox: { x: 0.08, y: 0.12, width: 0.84, height: 0.72 }, contentExpanded: true } },
    { ...common, kind: 'undo', atUs: 9_000_000, scope: 'ink', steps: 1 },
  ];
  return {
    sourceRecordingId: 'lesson-recording-1',
    sessionId: 'lesson-session-1',
    durationUs: 12_000_000,
    profile: 'Balanced',
    events,
    speechActivity: [{ startUs: 2_000_000, endUs: 3_100_000, confidence: 0.96, semanticStatus: 'recognized' }],
    roiObservations: [
      roi('intro', 0, 'scene-a', { x: 0.08, y: 0.08, width: 0.84, height: 0.8 }, { objectSalience: 0.2 }),
      roi('formula', 2_000, 'scene-a', { x: 0.6, y: 0.22, width: 0.2, height: 0.2 }, { speechReference: 1, clickDwell: 1, objectSalience: 1, recency: 1 }),
      roi('ink-left', 4_000, 'scene-a', { x: 0.12, y: 0.52, width: 0.18, height: 0.16 }, { inkActivity: 1, speechReference: 1, objectSalience: 1, recency: 1 }),
      roi('ink-expanded', 7_000, 'scene-a', { x: 0.08, y: 0.12, width: 0.84, height: 0.72 }, { inkActivity: 1, speechReference: 1, objectSalience: 1, recency: 1 }),
      roi('ambiguous', 10_000, 'scene-a', { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, { objectSalience: 0.2 }),
    ],
  };
}

test('builds aligned, versioned attention.json, camera.json, and cleanup.json artifacts', () => {
  const result = buildTeachingDirectorArtifacts(directorInput());

  expect(result).toMatchObject({
    schemaVersion: 1,
    artifactSetVersion: 'teaching-director-artifacts-v1',
    sourceRecordingId: 'lesson-recording-1',
    sessionId: 'lesson-session-1',
  });
  expect(Object.values(result.artifacts).map((artifact) => artifact.fileName)).toEqual([
    'attention.json',
    'camera.json',
    'cleanup.json',
  ]);
  for (const artifact of Object.values(result.artifacts)) {
    expect(artifact).toMatchObject({ schemaVersion: 1, sourceRecordingId: 'lesson-recording-1', sessionId: 'lesson-session-1' });
  }
  expect(result.artifacts.attention.payload).toMatchObject({ engineVersion: 'attention-v1', sourceRecordingId: 'lesson-recording-1' });
  expect(result.artifacts.camera.payload).toMatchObject({ plannerVersion: 'teaching-camera-v1', sourceRecordingId: 'lesson-recording-1' });
  expect(result.artifacts.cleanup.payload).toMatchObject({ plannerVersion: 'conservative-cleanup-v1', sessionId: 'lesson-session-1' });
});

test('conservative adapter produces focus only from click, dwell, and speech evidence, then follows ink and reveals expansion', () => {
  const result = buildTeachingDirectorArtifacts(directorInput());

  expect(result.artifacts.camera.payload.shots.map((shot) => [shot.startMs, shot.mode, shot.reason])).toEqual([
    [0, 'FULL_CONTEXT', 'initial-context'],
    [2_000, 'FOCUS', 'click-dwell-speech'],
    [4_000, 'FOLLOW', 'ink-follow'],
    [7_000, 'REVEAL', 'content-expanded'],
    [10_000, 'FULL_CONTEXT', 'low-confidence'],
  ]);
  expect(result.artifacts.cleanup.payload.actions.some((action) => action.reason === 'confirmed-undo')).toBe(true);
});

test('click and dwell without overlapping speech preserve full context', () => {
  const input = directorInput();
  input.speechActivity = [];
  const result = buildTeachingDirectorArtifacts(input);

  expect(result.artifacts.camera.payload.shots.some((shot) => shot.mode === 'FOCUS')).toBe(false);
});

test('artifact aggregation is deterministic and rejects cross-session telemetry', () => {
  const input = directorInput();
  const first = buildTeachingDirectorArtifacts(input);
  const second = buildTeachingDirectorArtifacts(structuredClone(input));
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));

  expect(() => buildTeachingDirectorArtifacts({
    ...input,
    events: [{ ...input.events[0], sessionId: 'another-session' }],
  })).toThrow('teaching_director_session_mismatch');
});
