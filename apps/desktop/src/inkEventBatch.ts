import { Buffer } from 'node:buffer';
import type { NativeInkEventBatch } from './nativeHelperClient';

const MAXIMUM_EVENT_COUNT = 256;
const MAXIMUM_PAYLOAD_BYTES = 16 * 1_024 * 1_024;

export function createNativeInkEventBatch(
  payload: unknown,
  captureStartedUnixMs: number,
  index: number,
  pausedTotalMs = 0,
): NativeInkEventBatch {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('desktop_ink_event_batch_invalid');
  }
  const events = (payload as Record<string, unknown>).events;
  if (!Array.isArray(events) || events.length === 0 || events.length > MAXIMUM_EVENT_COUNT) {
    throw new Error('desktop_ink_event_batch_invalid');
  }
  const eventTimes = events.map((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error('desktop_ink_event_batch_invalid');
    }
    const atUnixMs = (event as Record<string, unknown>).atUnixMs;
    if (typeof atUnixMs !== 'number' || !Number.isFinite(atUnixMs)) {
      throw new Error('desktop_ink_event_batch_invalid');
    }
    return atUnixMs;
  });
  const eventPayload = JSON.stringify({ schemaVersion: 1, events });
  if (Buffer.byteLength(eventPayload, 'utf8') > MAXIMUM_PAYLOAD_BYTES) {
    throw new Error('desktop_ink_event_batch_too_large');
  }
  const firstEventMs = Math.min(...eventTimes);
  const lastEventMs = Math.max(...eventTimes);
  return {
    index,
    startUs: Math.max(0, Math.round((firstEventMs - captureStartedUnixMs - pausedTotalMs) * 1_000)),
    durationUs: Math.max(1, Math.round((lastEventMs - firstEventMs) * 1_000) + 1),
    payload: eventPayload,
  };
}
