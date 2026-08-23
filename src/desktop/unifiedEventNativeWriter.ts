import { DESKTOP_IPC_CHANNELS } from './productContract';
import type { UnifiedEventBatchV1 } from './unifiedEventSchema';

export interface DesktopInputTelemetryBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

export interface DesktopInputTelemetryWriterOptions {
  bridge: DesktopInputTelemetryBridge;
  sessionId: string;
  producerId: 'main-whiteboard' | 'desktop-ink';
  producerEpoch: string;
  surfaceId: string;
}

export function createDesktopInputTelemetryWriter(
  options: DesktopInputTelemetryWriterOptions,
): (batch: UnifiedEventBatchV1) => Promise<void> {
  let nextProducerSequence = 0;
  const pending = new Map<number, { schemaVersion: 1; events: Array<Record<string, unknown>> }>();
  return async (batch) => {
    if (batch.sessionId !== options.sessionId) {
      throw new Error('desktop_input_telemetry_session_mismatch');
    }
    let producerBatch = pending.get(batch.index);
    if (!producerBatch) {
      const firstSequence = nextProducerSequence;
      producerBatch = {
        schemaVersion: 1,
        events: batch.events.map((event, offset) => {
          const { schemaVersion: _schemaVersion, sessionId: _sessionId, atUs: _atUs, kind, ...payload } = event;
          return {
            schemaVersion: 1,
            sessionId: options.sessionId,
            producerId: options.producerId,
            producerEpoch: options.producerEpoch,
            producerSequence: firstSequence + offset,
            surfaceId: options.surfaceId,
            kind,
            payload,
          };
        }),
      };
      pending.set(batch.index, producerBatch);
      nextProducerSequence += batch.events.length;
    }
    const response = await options.bridge.invoke(
      DESKTOP_IPC_CHANNELS.inputTelemetryAppend,
      producerBatch,
    );
    const lastSequence = producerBatch.events.at(-1)?.producerSequence;
    if (!response || typeof response !== 'object'
      || (response as { committed?: unknown }).committed !== true
      || (response as { producerId?: unknown }).producerId !== options.producerId
      || (response as { producerEpoch?: unknown }).producerEpoch !== options.producerEpoch
      || (response as { acknowledgedSequence?: unknown }).acknowledgedSequence !== lastSequence) {
      throw new Error('desktop_input_telemetry_not_committed');
    }
    pending.delete(batch.index);
  };
}
