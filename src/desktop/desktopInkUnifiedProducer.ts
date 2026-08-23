import { DesktopInkEventCollector, type DesktopInkEvent } from './inkEventJournal';
import { UnifiedEventCaptureAdapter } from './unifiedEventCaptureAdapter';
import { createDesktopInputTelemetryWriter, type DesktopInputTelemetryBridge } from './unifiedEventNativeWriter';
import { DESKTOP_IPC_CHANNELS } from './productContract';

interface PendingInkBatch {
  events: DesktopInkEvent[];
  submittedTelemetryEvents: number;
  telemetryNeedsRecovery: boolean;
  telemetryCommitted: boolean;
}

export interface DesktopInkUnifiedProducerOptions {
  bridge: DesktopInputTelemetryBridge;
  collector: DesktopInkEventCollector;
  sessionId: string;
  producerEpoch: string;
  nowHostUs(): number;
}

export function shouldCollectDesktopInk(state: {
  recordingActive: boolean;
  recordingId: string | null;
  paused: boolean;
}): boolean {
  return state.recordingActive && state.recordingId !== null && !state.paused;
}

/**
 * Drains one collector into two ordered native tracks. Unified telemetry is
 * idempotent and always commits before the legacy, non-idempotent raw track.
 */
export class DesktopInkUnifiedProducer {
  private readonly adapter: UnifiedEventCaptureAdapter;
  private pending: PendingInkBatch | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: DesktopInkUnifiedProducerOptions) {
    this.adapter = new UnifiedEventCaptureAdapter({
      sessionId: options.sessionId,
      captureStartedHostUs: options.nowHostUs(),
      maximumEvents: 64,
      maximumBytes: 4 * 1_024 * 1_024,
      write: createDesktopInputTelemetryWriter({
        bridge: options.bridge,
        sessionId: options.sessionId,
        producerId: 'desktop-ink',
        producerEpoch: options.producerEpoch,
        surfaceId: 'desktop-ink-overlay',
      }),
    });
  }

  get hasPending(): boolean {
    return this.pending !== null || this.options.collector.pendingCount > 0;
  }

  flush(): Promise<void> {
    const result = this.tail.then(() => this.flushNow());
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async flushNow(): Promise<void> {
    while (this.pending || this.options.collector.pendingCount > 0) {
      this.pending ??= {
        events: this.options.collector.drain(),
        submittedTelemetryEvents: 0,
        telemetryNeedsRecovery: false,
        telemetryCommitted: false,
      };
      const batch = this.pending;
      if (batch.events.length === 0) {
        this.pending = null;
        continue;
      }
      if (!batch.telemetryCommitted) {
        if (batch.telemetryNeedsRecovery) {
          await this.adapter.flush();
          batch.telemetryNeedsRecovery = false;
        }
        while (batch.submittedTelemetryEvents < batch.events.length) {
          const event = batch.events[batch.submittedTelemetryEvents];
          try {
            await this.adapter.capture({
              sessionId: this.options.sessionId,
              hostUs: this.options.nowHostUs(),
              payload: { kind: 'ink-journal', event },
            });
            batch.submittedTelemetryEvents += 1;
          } catch (error) {
            // UnifiedEventCaptureAdapter retains the failed lossless event.
            batch.submittedTelemetryEvents += 1;
            batch.telemetryNeedsRecovery = true;
            throw error;
          }
        }
        try {
          await this.adapter.flush();
          batch.telemetryCommitted = true;
        } catch (error) {
          batch.telemetryNeedsRecovery = true;
          throw error;
        }
      }
      const rawResponse = await this.options.bridge.invoke(DESKTOP_IPC_CHANNELS.inkAppendEvents, {
        events: batch.events,
      });
      if (!rawResponse || typeof rawResponse !== 'object'
        || (rawResponse as { committed?: unknown }).committed !== true) {
        throw new Error('desktop_ink_event_not_committed');
      }
      this.pending = null;
    }
  }
}
