import { expect, test } from '@playwright/test';

import {
  CAMERA_PLANNER_PROFILES,
  buildTeachingCameraPlan,
  type CameraPlannerInput,
} from '@/desktop/cameraPlanner';

function input(signals: CameraPlannerInput['signals'], profile: CameraPlannerInput['profile'] = 'Balanced'): CameraPlannerInput {
  return {
    sourceRecordingId: 'lesson-camera-1',
    durationMs: 14_000,
    profile,
    signals,
  };
}

test('camera profiles expose calm, balanced, and dynamic pacing with bounded zoom', () => {
  expect(CAMERA_PLANNER_PROFILES.Calm.minimumShotDurationMs).toBeGreaterThan(
    CAMERA_PLANNER_PROFILES.Balanced.minimumShotDurationMs,
  );
  expect(CAMERA_PLANNER_PROFILES.Balanced.minimumShotDurationMs).toBeGreaterThan(
    CAMERA_PLANNER_PROFILES.Dynamic.minimumShotDurationMs,
  );
  expect(CAMERA_PLANNER_PROFILES.Calm.maxZoom).toBeLessThan(
    CAMERA_PLANNER_PROFILES.Dynamic.maxZoom,
  );
  expect(CAMERA_PLANNER_PROFILES.Balanced).toMatchObject({
    cooldownMs: expect.any(Number),
    hysteresis: expect.any(Number),
    sustainMs: expect.any(Number),
  });
});

test('focus requires click, dwell, speech emphasis, and sufficient confidence together', () => {
  const plan = buildTeachingCameraPlan(input([
    { id: 'context', atMs: 0, sceneId: 'scene-a', confidence: 1, target: { x: 0.2, y: 0.3, width: 0.2, height: 0.2 } },
    { id: 'click-only', atMs: 2_500, sceneId: 'scene-a', confidence: 0.95, click: true },
    { id: 'no-speech', atMs: 5_000, sceneId: 'scene-a', confidence: 0.95, click: true, dwellMs: 900 },
    { id: 'complete', atMs: 7_500, sceneId: 'scene-a', confidence: 0.95, click: true, dwellMs: 900, speechEmphasis: true, target: { x: 0.72, y: 0.36, width: 0.16, height: 0.14 } },
  ]));

  expect(plan.shots.map((shot) => shot.mode)).toEqual(['FULL_CONTEXT', 'FOCUS']);
  expect(plan.shots[1]).toMatchObject({ reason: 'click-dwell-speech', startMs: 7_500 });
  expect(plan.shots[1].zoom).toBeLessThanOrEqual(CAMERA_PLANNER_PROFILES.Balanced.maxZoom);
});

test('new scenes and low-confidence observations return to full context', () => {
  const plan = buildTeachingCameraPlan(input([
    { id: 'scene-a', atMs: 0, sceneId: 'scene-a', confidence: 1 },
    { id: 'focus-a', atMs: 2_500, sceneId: 'scene-a', confidence: 0.95, click: true, dwellMs: 800, speechEmphasis: true },
    { id: 'scene-b', atMs: 5_000, sceneId: 'scene-b', confidence: 0.96 },
    { id: 'focus-b', atMs: 7_500, sceneId: 'scene-b', confidence: 0.94, click: true, dwellMs: 900, speechEmphasis: true },
    { id: 'uncertain', atMs: 10_000, sceneId: 'scene-b', confidence: 0.3 },
  ]));

  expect(plan.shots.map((shot) => [shot.startMs, shot.mode, shot.reason])).toEqual([
    [0, 'FULL_CONTEXT', 'initial-context'],
    [2_500, 'FOCUS', 'click-dwell-speech'],
    [5_000, 'FULL_CONTEXT', 'new-scene'],
    [7_500, 'FOCUS', 'click-dwell-speech'],
    [10_000, 'FULL_CONTEXT', 'low-confidence'],
  ]);
});

test('ink uses hold inside the safe frame, follow after sustained movement, and reveal on expansion', () => {
  const plan = buildTeachingCameraPlan(input([
    { id: 'ink-start', atMs: 0, sceneId: 'board', confidence: 1, target: { x: 0.18, y: 0.25, width: 0.15, height: 0.15 } },
    { id: 'safe-hold', atMs: 2_500, sceneId: 'board', confidence: 0.98, target: { x: 0.2, y: 0.26, width: 0.15, height: 0.15 }, ink: { active: true, safeFrame: true } },
    { id: 'safe-follow', atMs: 5_000, sceneId: 'board', confidence: 0.98, target: { x: 0.72, y: 0.55, width: 0.15, height: 0.15 }, sustainMs: 900, ink: { active: true, safeFrame: true } },
    { id: 'expanded', atMs: 7_500, sceneId: 'board', confidence: 0.99, ink: { active: true, safeFrame: false, contentExpanded: true } },
  ]));

  expect(plan.shots.map((shot) => shot.mode)).toEqual(['FULL_CONTEXT', 'HOLD', 'FOLLOW', 'REVEAL']);
  expect(plan.shots.at(-1)).toMatchObject({ reason: 'content-expanded', zoom: 1 });
});

test('minimum shot duration, cooldown, hysteresis, and sustain suppress camera chatter', () => {
  const plan = buildTeachingCameraPlan(input([
    { id: 'start', atMs: 0, sceneId: 'board', confidence: 1, target: { x: 0.3, y: 0.3, width: 0.2, height: 0.2 } },
    { id: 'too-soon', atMs: 700, sceneId: 'board', confidence: 0.99, click: true, dwellMs: 900, speechEmphasis: true },
    { id: 'small-move', atMs: 2_000, sceneId: 'board', confidence: 0.99, target: { x: 0.33, y: 0.32, width: 0.2, height: 0.2 }, sustainMs: 800, ink: { active: true, safeFrame: true } },
    { id: 'not-sustained', atMs: 4_000, sceneId: 'board', confidence: 0.99, target: { x: 0.75, y: 0.7, width: 0.2, height: 0.2 }, sustainMs: 100, ink: { active: true, safeFrame: true } },
  ]));

  expect(plan.shots.map((shot) => shot.mode)).toEqual(['FULL_CONTEXT', 'HOLD']);
  expect(plan.shots[1].reason).toBe('ink-safe-frame');
});

test('a scene change deferred by minimum duration remains pending until the next observation', () => {
  const plan = buildTeachingCameraPlan(input([
    { id: 'start', atMs: 0, sceneId: 'scene-a', confidence: 1 },
    { id: 'focus', atMs: 2_000, sceneId: 'scene-a', confidence: 0.95, click: true, dwellMs: 900, speechEmphasis: true },
    { id: 'early-scene-b', atMs: 2_500, sceneId: 'scene-b', confidence: 0.95 },
    { id: 'scene-b-settled', atMs: 4_000, sceneId: 'scene-b', confidence: 0.95 },
  ]));

  expect(plan.shots.map((shot) => [shot.startMs, shot.mode, shot.reason])).toEqual([
    [0, 'FULL_CONTEXT', 'initial-context'],
    [2_000, 'FOCUS', 'click-dwell-speech'],
    [4_000, 'FULL_CONTEXT', 'new-scene'],
  ]);
});

test('the same normalized input produces a versioned byte-stable camera plan', () => {
  const value = input([
    { id: 'focus', atMs: 3_000, sceneId: 'lesson', confidence: 0.95, click: true, dwellMs: 800, speechEmphasis: true },
    { id: 'start', atMs: 0, sceneId: 'lesson', confidence: 1 },
  ], 'Dynamic');

  const first = buildTeachingCameraPlan(value);
  const second = buildTeachingCameraPlan(structuredClone(value));

  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(first).toMatchObject({
    schemaVersion: 1,
    plannerVersion: 'teaching-camera-v1',
    sourceRecordingId: 'lesson-camera-1',
    profile: 'Dynamic',
  });
  expect(first.shots.at(-1)?.endMs).toBe(14_000);
});
