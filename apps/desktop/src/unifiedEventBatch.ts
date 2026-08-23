import { Buffer } from 'node:buffer';
import { parseUnifiedEvent } from '../../../src/desktop/unifiedEventSchema';
import type { NativeInputTelemetryProducerBatch } from './nativeHelperClient';

const MAXIMUM_EVENT_COUNT = 256;
const MAXIMUM_PAYLOAD_BYTES = 4 * 1_024 * 1_024;
const BATCH_KEYS = new Set(['schemaVersion', 'events']);
const EVENT_KEYS = new Set([
  'schemaVersion', 'sessionId', 'producerId', 'producerEpoch', 'producerSequence',
  'surfaceId', 'kind', 'payload',
]);
const PRODUCER_IDS = ['main-whiteboard', 'desktop-ink'] as const;
export type InputTelemetryProducerId = typeof PRODUCER_IDS[number];
const PAYLOAD_KEYS: Record<string, ReadonlySet<string>> = {
  'active-window': new Set(['application', 'windowId', 'title']),
  'window-bounds': new Set(['windowId', 'x', 'y', 'width', 'height']),
  cursor: new Set(['x', 'y']),
  click: new Set(['x', 'y', 'button', 'phase']),
  dwell: new Set(['x', 'y', 'durationUs']),
  scroll: new Set(['deltaX', 'deltaY']),
  ink: new Set(['operation', 'payload']),
  undo: new Set(['scope', 'steps']),
  'mode-change': new Set(['mode']),
  'camera-control': new Set(['action', 'value']),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createNativeInputTelemetryProducerBatch(
  payload: unknown,
  activeSessionId: string,
): NativeInputTelemetryProducerBatch {
  if (!isRecord(payload)
    || Object.keys(payload).some((key) => !BATCH_KEYS.has(key))
    || Object.keys(payload).length !== BATCH_KEYS.size
    || payload.schemaVersion !== 1
    || !Array.isArray(payload.events)
    || payload.events.length === 0
    || payload.events.length > MAXIMUM_EVENT_COUNT) {
    throw new Error('desktop_input_telemetry_batch_invalid');
  }
  let producerId: InputTelemetryProducerId | null = null;
  let epoch: string | null = null;
  let previousSequence: number | null = null;
  for (const rawEvent of payload.events) {
    if (!isRecord(rawEvent)
      || Object.keys(rawEvent).some((key) => !EVENT_KEYS.has(key))
      || Object.keys(rawEvent).length !== EVENT_KEYS.size
      || rawEvent.schemaVersion !== 1
      || rawEvent.sessionId !== activeSessionId
      || !PRODUCER_IDS.includes(rawEvent.producerId as InputTelemetryProducerId)
      || typeof rawEvent.producerEpoch !== 'string'
      || !/^[a-zA-Z0-9_-]{1,128}$/.test(rawEvent.producerEpoch)
      || !Number.isSafeInteger(rawEvent.producerSequence)
      || (rawEvent.producerSequence as number) < 0
      || typeof rawEvent.surfaceId !== 'string'
      || !/^[a-zA-Z0-9_-]{1,128}$/.test(rawEvent.surfaceId)
      || typeof rawEvent.kind !== 'string'
      || !isRecord(rawEvent.payload)) {
      throw new Error('desktop_input_telemetry_event_invalid');
    }
    producerId ??= rawEvent.producerId as InputTelemetryProducerId;
    epoch ??= rawEvent.producerEpoch;
    if (rawEvent.producerId !== producerId || rawEvent.producerEpoch !== epoch
      || (previousSequence !== null && rawEvent.producerSequence !== previousSequence + 1)) {
      throw new Error('desktop_input_telemetry_sequence_invalid');
    }
    const allowedPayloadKeys = PAYLOAD_KEYS[rawEvent.kind];
    if (!allowedPayloadKeys
      || Object.keys(rawEvent.payload).some((key) => !allowedPayloadKeys.has(key))) {
      throw new Error('desktop_input_telemetry_event_invalid');
    }
    parseUnifiedEvent({
      schemaVersion: 1,
      sessionId: activeSessionId,
      atUs: 0,
      kind: rawEvent.kind,
      ...rawEvent.payload,
    });
    previousSequence = rawEvent.producerSequence as number;
  }
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > MAXIMUM_PAYLOAD_BYTES) {
    throw new Error('desktop_input_telemetry_batch_too_large');
  }
  return { payload: serialized };
}
