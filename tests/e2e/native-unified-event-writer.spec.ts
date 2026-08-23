import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import {
  createNativeInputTelemetryProducerBatch,
} from '../../apps/desktop/src/unifiedEventBatch';
import {
  NativeHelperClient,
  type HelperTransport,
} from '../../apps/desktop/src/nativeHelperClient';
import { DESKTOP_IPC_CHANNELS } from '../../src/desktop/productContract';
import { createDesktopInputTelemetryWriter } from '../../src/desktop/unifiedEventNativeWriter';
import type { UnifiedEventBatchV1 } from '../../src/desktop/unifiedEventSchema';

const rendererBatch: UnifiedEventBatchV1 = {
  schemaVersion: 1,
  sessionId: 'lesson-telemetry',
  index: 7,
  startUs: 100_000,
  endUs: 120_000,
  events: [
    { schemaVersion: 1, sessionId: 'lesson-telemetry', atUs: 100_000, kind: 'cursor', x: 10, y: 20 },
    { schemaVersion: 1, sessionId: 'lesson-telemetry', atUs: 120_000, kind: 'click', x: 10, y: 20, button: 'primary', phase: 'down' },
  ],
};

test('renderer writer emits producer-local sequence envelopes without authoritative time or index', async () => {
  expect(DESKTOP_IPC_CHANNELS.inputTelemetryAppend)
    .toBe('input-telemetry.append-producer-events.v1');
  let invokedPayload: unknown;
  const writer = createDesktopInputTelemetryWriter({
    sessionId: 'lesson-telemetry',
    producerId: 'main-whiteboard',
    producerEpoch: 'launch-a',
    surfaceId: 'whiteboard-1',
    bridge: {
      async invoke(_channel, payload) {
        invokedPayload = payload;
        return {
          committed: true,
          producerId: 'main-whiteboard',
          producerEpoch: 'launch-a',
          acknowledgedSequence: 1,
          segmentIndex: 4,
          duplicate: false,
          dropped: false,
        };
      },
    },
  });
  await writer(rendererBatch);
  expect(invokedPayload).toEqual({
    schemaVersion: 1,
    events: [
      {
        schemaVersion: 1,
        sessionId: 'lesson-telemetry',
        producerId: 'main-whiteboard',
        producerEpoch: 'launch-a',
        producerSequence: 0,
        surfaceId: 'whiteboard-1',
        kind: 'cursor',
        payload: { x: 10, y: 20 },
      },
      {
        schemaVersion: 1,
        sessionId: 'lesson-telemetry',
        producerId: 'main-whiteboard',
        producerEpoch: 'launch-a',
        producerSequence: 1,
        surfaceId: 'whiteboard-1',
        kind: 'click',
        payload: { x: 10, y: 20, button: 'primary', phase: 'down' },
      },
    ],
  });
  expect(JSON.stringify(invokedPayload)).not.toContain('"atUs"');
  expect(JSON.stringify(invokedPayload)).not.toContain('"index"');
});

test('main boundary strictly validates producer envelope and helper returns durable acknowledgement', async () => {
  const envelope = {
    schemaVersion: 1,
    events: [{
      schemaVersion: 1,
      sessionId: 'lesson-telemetry',
      producerId: 'desktop-ink',
      producerEpoch: 'ink-launch',
      producerSequence: 0,
      surfaceId: 'desktop-overlay',
      kind: 'ink',
      payload: { operation: 'stroke', payload: { points: [[1, 2]] } },
    }],
  };
  const batch = createNativeInputTelemetryProducerBatch(envelope, 'lesson-telemetry');
  expect(batch).toEqual({ payload: JSON.stringify(envelope) });

  let onLine: ((line: string) => void) | null = null;
  let command: Record<string, unknown> | null = null;
  const transport: HelperTransport = {
    write(line) {
      command = JSON.parse(line) as Record<string, unknown>;
      queueMicrotask(() => onLine?.(JSON.stringify({
        id: command?.id,
        ok: true,
        state: 'recording',
        telemetryAck: {
          producerId: 'desktop-ink', producerEpoch: 'ink-launch', acknowledgedSequence: 0,
          segmentIndex: 0, duplicate: false, dropped: false,
        },
      })));
    },
    onLine(listener) { onLine = listener; },
    close() {},
  };
  const acknowledgement = await new NativeHelperClient(transport).appendInputTelemetry(batch);
  expect(command).toMatchObject({
    channel: 'input-telemetry.append-producer-events.v1',
    telemetryProducerPayload: JSON.stringify(envelope),
  });
  expect(acknowledgement.segmentIndex).toBe(0);
});

test('strict boundary rejects gaps, mixed producers, cross-session and path authority', () => {
  const event = {
    schemaVersion: 1,
    sessionId: 'lesson-telemetry',
    producerId: 'main-whiteboard',
    producerEpoch: 'launch-a',
    producerSequence: 0,
    surfaceId: 'whiteboard-1',
    kind: 'cursor',
    payload: { x: 1, y: 2 },
  };
  expect(() => createNativeInputTelemetryProducerBatch(
    { schemaVersion: 1, events: [{ ...event, sessionId: 'other' }] },
    'lesson-telemetry',
  )).toThrow('desktop_input_telemetry_event_invalid');
  expect(() => createNativeInputTelemetryProducerBatch({
    schemaVersion: 1,
    events: [event, { ...event, producerSequence: 2 }],
  }, 'lesson-telemetry')).toThrow('desktop_input_telemetry_sequence_invalid');
  expect(() => createNativeInputTelemetryProducerBatch({
    schemaVersion: 1,
    events: [event, { ...event, producerId: 'desktop-ink', producerSequence: 1 }],
  }, 'lesson-telemetry')).toThrow('desktop_input_telemetry_sequence_invalid');
  expect(() => createNativeInputTelemetryProducerBatch({
    schemaVersion: 1,
    events: [{ ...event, relativePath: '../../outside' }],
  }, 'lesson-telemetry')).toThrow('desktop_input_telemetry_event_invalid');
});

test('failed ack retries exact tuple while a paused drop ack advances the producer', async () => {
  const payloads: unknown[] = [];
  const writer = createDesktopInputTelemetryWriter({
    sessionId: 'lesson-telemetry',
    producerId: 'main-whiteboard',
    producerEpoch: 'launch-a',
    surfaceId: 'whiteboard-1',
    bridge: {
      async invoke(_channel, payload) {
        payloads.push(payload);
        if (payloads.length === 1) return { committed: false };
        return {
          committed: true, producerId: 'main-whiteboard', producerEpoch: 'launch-a',
          acknowledgedSequence: 1, segmentIndex: null, duplicate: false, dropped: true,
        };
      },
    },
  });
  await expect(writer(rendererBatch)).rejects.toThrow('desktop_input_telemetry_not_committed');
  await expect(writer(rendererBatch)).resolves.toBeUndefined();
  expect(payloads[1]).toEqual(payloads[0]);
});

test('pause waits for ink and telemetry queues before native pause', () => {
  const source = fs.readFileSync('apps/desktop/src/main.ts', 'utf8');
  const handler = source.slice(
    source.indexOf('ipcMain.handle(DESKTOP_IPC_CHANNELS.capturePause'),
    source.indexOf('ipcMain.handle(DESKTOP_IPC_CHANNELS.captureResume'),
  );
  expect(handler.indexOf('await requestInkWindowFlush()')).toBeLessThan(handler.indexOf('pauseCapture()'));
  expect(handler.indexOf('await inkEventCommitTail')).toBeLessThan(handler.indexOf('pauseCapture()'));
  expect(handler.indexOf('await inputTelemetryCommitTail')).toBeLessThan(handler.indexOf('pauseCapture()'));
});
