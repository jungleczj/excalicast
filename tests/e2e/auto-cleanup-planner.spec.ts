import { expect, test } from '@playwright/test';
import { planAutoCleanup } from '../../src/desktop/autoCleanupPlanner';
import type { UnifiedEvent } from '../../src/desktop/unifiedEventSchema';

const event = <T extends UnifiedEvent>(value: T): T => value;

test('Auto Cleanup removes only deterministic undo and erase operations', () => {
  const events: UnifiedEvent[] = [
    event({ schemaVersion: 1, sessionId: 'lesson-1', kind: 'ink', atUs: 1_000_000, operation: 'stroke', payload: { id: 's1' } }),
    event({ schemaVersion: 1, sessionId: 'lesson-1', kind: 'undo', atUs: 2_000_000, scope: 'ink', steps: 1 }),
    event({ schemaVersion: 1, sessionId: 'lesson-1', kind: 'ink', atUs: 3_000_000, operation: 'erase', payload: { ids: ['s1'] } }),
  ];

  const cleanup = planAutoCleanup({
    sessionId: 'lesson-1',
    durationUs: 8_000_000,
    events,
    speechActivity: [{ startUs: 4_000_000, endUs: 6_000_000, confidence: 0.35, semanticStatus: 'possible-mistake' }],
  });

  expect(cleanup).toMatchObject({
    schemaVersion: 1,
    plannerVersion: 'conservative-cleanup-v1',
    sessionId: 'lesson-1',
    durationUs: 8_000_000,
  });
  expect(cleanup.actions.map((action) => [action.kind, action.reason])).toEqual([
    ['remove-events', 'confirmed-undo'],
    ['remove-events', 'confirmed-erase'],
  ]);
  expect(cleanup.actions.every((action) => (
    action.reversible === true
    && action.confidence >= 0.95
    && action.sourceRanges.every((range) => range.endUs > range.startUs)
  ))).toBe(true);
  expect(cleanup.actions.some((action) => action.reason.includes('speech'))).toBe(false);
});

test('Auto Cleanup time-compresses only interior dead time with no speech or content changes', () => {
  const events: UnifiedEvent[] = [
    event({ schemaVersion: 1, sessionId: 'lesson-2', kind: 'ink', atUs: 500_000, operation: 'stroke', payload: { id: 'before' } }),
    event({ schemaVersion: 1, sessionId: 'lesson-2', kind: 'cursor', atUs: 2_000_000, x: 20, y: 30 }),
    event({ schemaVersion: 1, sessionId: 'lesson-2', kind: 'ink', atUs: 6_000_000, operation: 'stroke', payload: { id: 'after' } }),
  ];

  const cleanup = planAutoCleanup({
    sessionId: 'lesson-2', durationUs: 7_000_000, events, speechActivity: [],
  });
  expect(cleanup.actions).toEqual([{
    id: 'cleanup-0000',
    kind: 'time-compress',
    sourceRanges: [{ startUs: 1_000_000, endUs: 5_500_000 }],
    reason: 'silent-dead-time',
    confidence: 0.98,
    reversible: true,
    playbackRate: 4,
  }]);

  const protectedBySpeech = planAutoCleanup({
    sessionId: 'lesson-2',
    durationUs: 7_000_000,
    events,
    speechActivity: [{ startUs: 2_000_000, endUs: 5_000_000, confidence: 0.2, semanticStatus: 'uncertain' }],
  });
  expect(protectedBySpeech.actions).toEqual([]);
});

test('window cleanup requires a silent stable roundtrip before and after loading or arrangement', () => {
  const common = { schemaVersion: 1 as const, sessionId: 'lesson-window' };
  const events: UnifiedEvent[] = [
    event({ ...common, kind: 'active-window', atUs: 500_000, application: 'Slides', windowId: 7, title: 'Lesson' }),
    event({ ...common, kind: 'active-window', atUs: 1_000_000, application: 'Slides', windowId: 7, title: 'Loading…' }),
    event({ ...common, kind: 'active-window', atUs: 3_000_000, application: 'Slides', windowId: 7, title: 'Lesson' }),
    event({ ...common, kind: 'window-bounds', atUs: 4_000_000, windowId: 7, x: 0, y: 0, width: 1440, height: 900 }),
    event({ ...common, kind: 'window-bounds', atUs: 4_500_000, windowId: 7, x: 120, y: 80, width: 1200, height: 760 }),
    event({ ...common, kind: 'window-bounds', atUs: 5_000_000, windowId: 7, x: 0, y: 0, width: 1440, height: 900 }),
  ];

  const cleanup = planAutoCleanup({
    sessionId: 'lesson-window', durationUs: 6_000_000, events, speechActivity: [],
  });
  expect(cleanup.actions.map(({ reason, sourceRanges }) => ({ reason, sourceRanges }))).toEqual([
    { reason: 'stable-window-loading', sourceRanges: [{ startUs: 1_000_000, endUs: 3_000_000 }] },
    { reason: 'stable-window-roundtrip', sourceRanges: [{ startUs: 4_500_000, endUs: 5_000_000 }] },
  ]);

  const speechProtected = planAutoCleanup({
    sessionId: 'lesson-window',
    durationUs: 6_000_000,
    events,
    speechActivity: [{ startUs: 900_000, endUs: 3_100_000, confidence: 1, semanticStatus: 'recognized' }],
  });
  expect(speechProtected.actions.map((action) => action.reason)).toEqual(['stable-window-roundtrip']);

  const unstable = planAutoCleanup({
    sessionId: 'lesson-window',
    durationUs: 4_000_000,
    events: events.slice(0, 3).map((item, index) => index === 2 && item.kind === 'active-window'
      ? { ...item, windowId: 9, title: 'Other window' }
      : item),
    speechActivity: [],
  });
  expect(unstable.actions).toEqual([]);
});

test('cleanup planning is deterministic and rejects telemetry from another session', () => {
  const events: UnifiedEvent[] = [
    event({ schemaVersion: 1, sessionId: 'deterministic', kind: 'ink', atUs: 4_000_000, operation: 'stroke', payload: { id: 'end' } }),
    event({ schemaVersion: 1, sessionId: 'deterministic', kind: 'undo', atUs: 2_000_000, scope: 'ink', steps: 1 }),
    event({ schemaVersion: 1, sessionId: 'deterministic', kind: 'ink', atUs: 500_000, operation: 'stroke', payload: { id: 'start' } }),
  ];
  const input = {
    sessionId: 'deterministic',
    durationUs: 5_000_000,
    events,
    speechActivity: [],
  } as const;
  expect(planAutoCleanup(input)).toEqual(planAutoCleanup(input));

  expect(() => planAutoCleanup({
    ...input,
    events: [{ ...events[0], sessionId: 'another-session' }],
  })).toThrow('auto_cleanup_session_mismatch');
});
