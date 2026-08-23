import { expect, test } from '@playwright/test';
import {
  PausedSessionClock,
  UnifiedEventBatcher,
  parseUnifiedEvent,
  type UnifiedEvent,
} from '../../src/desktop/unifiedEventSchema';
import { UNIFIED_EVENT_KINDS } from '../../src/desktop/projectSchema';

test('versioned unified event schema accepts every teaching telemetry kind', () => {
  const common = { schemaVersion: 1 as const, sessionId: 'lesson-1', atUs: 120_000 };
  const events: UnifiedEvent[] = [
    { ...common, kind: 'active-window', application: 'Keynote', windowId: 42, title: 'Lesson' },
    { ...common, atUs: 120_001, kind: 'window-bounds', windowId: 42, x: 0, y: 0, width: 1440, height: 900 },
    { ...common, atUs: 120_002, kind: 'cursor', x: 320, y: 240 },
    { ...common, atUs: 120_003, kind: 'click', x: 320, y: 240, button: 'primary', phase: 'down' },
    { ...common, atUs: 120_004, kind: 'dwell', x: 320, y: 240, durationUs: 600_000 },
    { ...common, atUs: 120_005, kind: 'scroll', deltaX: 0, deltaY: -120 },
    { ...common, atUs: 120_006, kind: 'ink', operation: 'stroke', payload: { id: 'line-1' } },
    { ...common, atUs: 120_007, kind: 'undo', scope: 'ink', steps: 1 },
    { ...common, atUs: 120_008, kind: 'mode-change', mode: 'whiteboard' },
    { ...common, atUs: 120_009, kind: 'camera-control', action: 'set-layout', value: 'circle-bottom-right' },
  ];

  expect(events.map((event) => parseUnifiedEvent(event).kind)).toEqual([
    'active-window', 'window-bounds', 'cursor', 'click', 'dwell', 'scroll',
    'ink', 'undo', 'mode-change', 'camera-control',
  ]);
  expect(UNIFIED_EVENT_KINDS).toEqual([
    'active-window', 'window-bounds', 'cursor', 'click', 'dwell', 'scroll',
    'ink', 'undo', 'mode-change', 'camera-control',
  ]);
  expect(() => parseUnifiedEvent({ ...events[0], schemaVersion: 2 })).toThrow('unified_event_schema_unsupported');
  expect(() => parseUnifiedEvent({ ...events[0], sessionId: '../lesson' })).toThrow('unified_event_identity_invalid');
});

test('batcher memory stays bounded when event count grows with recording duration', async () => {
  let writtenEvents = 0;
  const batcher = new UnifiedEventBatcher({
    sessionId: 'long-lesson',
    maximumEvents: 7,
    maximumBytes: 4_096,
    write: async (batch) => { writtenEvents += batch.events.length; },
  });

  for (let index = 0; index < 5_000; index += 1) {
    await batcher.append({
      schemaVersion: 1,
      sessionId: 'long-lesson',
      kind: 'cursor',
      atUs: index * 1_000,
      x: index % 1440,
      y: index % 900,
    });
    expect(batcher.pendingCount).toBeLessThanOrEqual(7);
    expect(batcher.pendingByteLength).toBeLessThanOrEqual(4_096);
  }
  await batcher.flush();
  expect(writtenEvents).toBe(5_000);
  expect(batcher.maximumObservedPendingCount).toBe(7);
});

test('bounded event batcher flushes for the whole recording and makes timestamp normalization explicit', async () => {
  const written: Array<{ index: number; events: UnifiedEvent[] }> = [];
  const batcher = new UnifiedEventBatcher({
    sessionId: 'lesson-1',
    maximumEvents: 3,
    maximumBytes: 16_384,
    write: async (batch) => { written.push({ index: batch.index, events: batch.events }); },
  });

  for (let index = 0; index < 10; index += 1) {
    await batcher.append({
      schemaVersion: 1,
      sessionId: 'lesson-1',
      kind: 'cursor',
      atUs: index * 1_000,
      x: index,
      y: index,
    });
    expect(batcher.pendingCount).toBeLessThanOrEqual(3);
  }
  await batcher.flush();

  expect(written.map((batch) => batch.events.length)).toEqual([3, 3, 3, 1]);
  expect(written.map((batch) => batch.index)).toEqual([0, 1, 2, 3]);
  expect(batcher.pendingCount).toBe(0);
  expect(batcher.maximumObservedPendingCount).toBe(3);
  await expect(batcher.append({
    schemaVersion: 1,
    sessionId: 'lesson-1',
    kind: 'cursor',
    atUs: 8_000,
    x: 0,
    y: 0,
  })).rejects.toThrow('unified_event_time_non_monotonic');

  const normalizedWrites: UnifiedEvent[] = [];
  const normalized = new UnifiedEventBatcher({
    sessionId: 'lesson-normalized',
    maximumEvents: 4,
    maximumBytes: 16_384,
    nonMonotonic: 'increment',
    write: async (batch) => { normalizedWrites.push(...batch.events); },
  });
  await normalized.append({ schemaVersion: 1, sessionId: 'lesson-normalized', kind: 'cursor', atUs: 5, x: 1, y: 1 });
  await normalized.append({ schemaVersion: 1, sessionId: 'lesson-normalized', kind: 'click', atUs: 5, x: 1, y: 1, button: 'primary', phase: 'down' });
  await normalized.flush();
  expect(normalizedWrites.map((event) => event.atUs)).toEqual([5, 6]);
});

test('session clock maps monotonic host time across pause and resume without timeline gaps', () => {
  const clock = new PausedSessionClock(1_000_000);

  expect(clock.atUs(1_100_000)).toBe(100_000);
  clock.pause(1_200_000);
  expect(clock.atUs(1_800_000)).toBe(200_000);
  clock.resume(2_000_000);
  expect(clock.atUs(2_100_000)).toBe(300_000);
  expect(() => clock.atUs(2_050_000)).toThrow('unified_event_clock_non_monotonic');
  expect(() => clock.resume(2_200_000)).toThrow('unified_event_clock_not_paused');
});
