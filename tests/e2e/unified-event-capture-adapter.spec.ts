import { expect, test } from '@playwright/test';
import { UnifiedEventCaptureAdapter } from '../../src/desktop/unifiedEventCaptureAdapter';
import type { UnifiedEvent, UnifiedEventBatchV1 } from '../../src/desktop/unifiedEventSchema';

test('renderer ink, window, scroll, laser and camera control map onto capture-relative unified events', async () => {
  const batches: UnifiedEventBatchV1[] = [];
  const adapter = new UnifiedEventCaptureAdapter({
    sessionId: 'lesson-capture',
    captureStartedHostUs: 1_000_000,
    maximumEvents: 32,
    maximumBytes: 32_768,
    write: async (batch) => { batches.push(batch); },
  });

  await adapter.capture({ sessionId: 'lesson-capture', hostUs: 1_100_000, payload: {
    kind: 'active-window', application: 'Keynote', windowId: 42, title: 'Lesson',
  } });
  await adapter.capture({ sessionId: 'lesson-capture', hostUs: 1_200_000, payload: {
    kind: 'window-bounds', windowId: 42, x: 0, y: 0, width: 1440, height: 900,
  } });
  await adapter.capture({ sessionId: 'lesson-capture', hostUs: 1_300_000, payload: {
    kind: 'ink-journal', event: {
      kind: 'scene-delta', atUnixMs: 1_700_000_000_000,
      upserts: [{ id: 'line-1' }], deletedIds: [], fileUpserts: {},
    },
  } });
  await adapter.capture({ sessionId: 'lesson-capture', hostUs: 1_400_000, payload: {
    kind: 'ink-journal', event: {
      kind: 'viewport', atUnixMs: 1_700_000_000_100,
      scrollX: 12, scrollY: -40, zoom: 1,
    },
  } });
  await adapter.capture({ sessionId: 'lesson-capture', hostUs: 1_500_000, payload: {
    kind: 'laser', x: 200, y: 160, phase: 'down',
  } });
  await adapter.capture({ sessionId: 'lesson-capture', hostUs: 1_600_000, payload: {
    kind: 'camera-control', action: 'set-layout', value: 'circle-bottom-right',
  } });
  await adapter.flush();

  const events = batches.flatMap((batch) => batch.events);
  expect(events.map((item) => item.kind)).toEqual([
    'active-window', 'window-bounds', 'ink', 'scroll', 'ink', 'camera-control',
  ]);
  expect(events.map((item) => item.atUs)).toEqual([100_000, 200_000, 300_000, 400_000, 500_000, 600_000]);
  expect(events.find((item): item is Extract<UnifiedEvent, { kind: 'scroll' }> => item.kind === 'scroll'))
    .toMatchObject({ deltaX: 12, deltaY: -40 });
  expect(events.filter((item) => item.kind === 'ink').map((item) => item.operation)).toEqual(['stroke', 'stroke']);
});

test('high-frequency cursor is coalesced while click, undo and controls survive pause mapping', async () => {
  const events: UnifiedEvent[] = [];
  const adapter = new UnifiedEventCaptureAdapter({
    sessionId: 'lesson-input', captureStartedHostUs: 1_000_000,
    maximumEvents: 32, maximumBytes: 32_768,
    write: async (batch) => { events.push(...batch.events); },
  });

  await adapter.capture({ sessionId: 'lesson-input', hostUs: 1_100_000, payload: { kind: 'cursor', x: 1, y: 1 } });
  await adapter.capture({ sessionId: 'lesson-input', hostUs: 1_110_000, payload: { kind: 'cursor', x: 2, y: 2 } });
  await adapter.capture({ sessionId: 'lesson-input', hostUs: 1_120_000, payload: { kind: 'cursor', x: 3, y: 3 } });
  await adapter.capture({ sessionId: 'lesson-input', hostUs: 1_130_000, payload: { kind: 'click', x: 3, y: 3, button: 'primary', phase: 'down' } });
  await adapter.capture({ sessionId: 'lesson-input', hostUs: 1_140_000, payload: { kind: 'undo', scope: 'ink', steps: 1 } });
  await adapter.capture({ sessionId: 'lesson-input', hostUs: 1_150_000, payload: { kind: 'camera-control', action: 'mute' } });
  await adapter.pause(1_200_000);
  await adapter.capture({ sessionId: 'lesson-input', hostUs: 1_300_000, payload: { kind: 'click', x: 9, y: 9, button: 'primary', phase: 'up' } });
  await adapter.resume(1_500_000);
  await adapter.capture({ sessionId: 'lesson-input', hostUs: 1_600_000, payload: { kind: 'mode-change', mode: 'whiteboard' } });
  await adapter.flush();

  expect(events.map((item) => item.kind)).toEqual(['cursor', 'click', 'undo', 'camera-control', 'mode-change']);
  expect(events[0]).toMatchObject({ atUs: 120_000, x: 3, y: 3 });
  expect(events.at(-1)?.atUs).toBe(300_000);
  await expect(adapter.capture({
    sessionId: 'another-session', hostUs: 1_700_000,
    payload: { kind: 'camera-control', action: 'disable' },
  })).rejects.toThrow('unified_event_capture_session_mismatch');
});

test('native writer backpressure restores the failed batch and the lossless event behind it', async () => {
  const written: UnifiedEvent[] = [];
  let attempts = 0;
  const adapter = new UnifiedEventCaptureAdapter({
    sessionId: 'lesson-backpressure', captureStartedHostUs: 10_000,
    maximumEvents: 1, maximumBytes: 8_192,
    write: async (batch) => {
      attempts += 1;
      if (attempts === 1) throw new Error('native_writer_busy');
      written.push(...batch.events);
    },
  });

  await adapter.capture({
    sessionId: 'lesson-backpressure', hostUs: 11_000,
    payload: { kind: 'cursor', x: 10, y: 20 },
  });
  await expect(adapter.capture({
    sessionId: 'lesson-backpressure', hostUs: 12_000,
    payload: { kind: 'click', x: 10, y: 20, button: 'primary', phase: 'down' },
  })).rejects.toThrow('native_writer_busy');

  await adapter.flush();
  expect(attempts).toBe(3);
  expect(written.map((item) => item.kind)).toEqual(['cursor', 'click']);
  expect(written.map((item) => item.atUs)).toEqual([1_000, 2_000]);
});
