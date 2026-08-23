import type { DesktopInkEvent } from './inkEventJournal';
import {
  PausedSessionClock,
  UnifiedEventBatcher,
  type UnifiedEvent,
  type UnifiedEventBatchV1,
} from './unifiedEventSchema';

export type RendererCapturePayload =
  | { kind: 'active-window'; application: string; windowId: number; title?: string }
  | { kind: 'window-bounds'; windowId: number; x: number; y: number; width: number; height: number }
  | { kind: 'cursor'; x: number; y: number }
  | { kind: 'click'; x: number; y: number; button: 'primary' | 'secondary' | 'middle'; phase: 'down' | 'up' }
  | { kind: 'dwell'; x: number; y: number; durationUs: number }
  | { kind: 'scroll'; deltaX: number; deltaY: number }
  | { kind: 'undo'; scope: 'ink' | 'camera' | 'scene'; steps: number }
  | { kind: 'mode-change'; mode: 'screen' | 'whiteboard' | 'presentation' }
  | { kind: 'camera-control'; action: 'enable' | 'disable' | 'mute' | 'unmute' | 'set-layout'; value?: string }
  | { kind: 'ink-journal'; event: DesktopInkEvent }
  | { kind: 'laser'; x: number; y: number; phase: 'down' | 'move' | 'up' };

export interface RendererCaptureInput {
  sessionId: string;
  hostUs: number;
  payload: RendererCapturePayload;
}

export interface UnifiedEventCaptureAdapterOptions {
  sessionId: string;
  captureStartedHostUs: number;
  maximumEvents: number;
  maximumBytes: number;
  write(batch: UnifiedEventBatchV1): Promise<void>;
}

export class UnifiedEventCaptureAdapter {
  private readonly clock: PausedSessionClock;
  private readonly batcher: UnifiedEventBatcher;
  private tail: Promise<void> = Promise.resolve();
  private pendingCursor: Extract<UnifiedEvent, { kind: 'cursor' }> | null = null;
  private readonly deferredLossless: UnifiedEvent[] = [];
  private previousViewport = { scrollX: 0, scrollY: 0 };
  private paused = false;
  private writerFailed = false;
  private failedBatchSignatures = new Set<string>();
  private lastEventAtUs = -1;

  constructor(private readonly options: UnifiedEventCaptureAdapterOptions) {
    this.clock = new PausedSessionClock(options.captureStartedHostUs);
    this.batcher = new UnifiedEventBatcher({
      sessionId: options.sessionId,
      maximumEvents: options.maximumEvents,
      maximumBytes: options.maximumBytes,
      nonMonotonic: 'increment',
      write: async (batch) => {
        try {
          await options.write(batch);
          this.writerFailed = false;
          this.failedBatchSignatures.clear();
        } catch (error) {
          this.writerFailed = true;
          this.failedBatchSignatures = new Set(batch.events.map(eventSignature));
          throw error;
        }
      },
    });
  }

  capture(input: RendererCaptureInput): Promise<void> {
    return this.enqueue(() => this.captureNow(input));
  }

  pause(hostUs: number): Promise<void> {
    return this.enqueue(async () => {
      if (this.paused) return;
      await this.flushCursor();
      this.clock.pause(hostUs);
      this.paused = true;
    });
  }

  resume(hostUs: number): Promise<void> {
    return this.enqueue(async () => {
      if (!this.paused) return;
      this.clock.resume(hostUs);
      this.paused = false;
    });
  }

  flush(): Promise<void> {
    return this.enqueue(async () => {
      await this.recoverFailedWrite();
      await this.drainDeferredLossless();
      await this.flushCursor();
      await this.batcher.flush();
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async captureNow(input: RendererCaptureInput): Promise<void> {
    if (input.sessionId !== this.options.sessionId) {
      throw new Error('unified_event_capture_session_mismatch');
    }
    if (this.paused) return;
    await this.recoverFailedWrite();
    await this.drainDeferredLossless();
    const atUs = this.allocateAtUs(this.clock.atUs(input.hostUs));
    const event = this.mapPayload(input.payload, atUs);
    if (event.kind === 'cursor') {
      this.pendingCursor = event;
      return;
    }
    this.deferredLossless.push(event);
    await this.flushCursor();
    await this.drainDeferredLossless();
  }

  private async flushCursor(): Promise<void> {
    const cursor = this.pendingCursor;
    if (!cursor) return;
    this.pendingCursor = null;
    try {
      await this.batcher.append(cursor);
    } catch (error) {
      if (!this.failedBatchSignatures.has(eventSignature(cursor))) {
        this.pendingCursor = cursor;
      }
      throw error;
    }
  }

  private async recoverFailedWrite(): Promise<void> {
    if (this.writerFailed) await this.batcher.flush();
  }

  private async drainDeferredLossless(): Promise<void> {
    while (this.deferredLossless.length > 0) {
      const event = this.deferredLossless[0];
      try {
        await this.batcher.append(event);
        this.deferredLossless.shift();
      } catch (error) {
        if (this.failedBatchSignatures.has(eventSignature(event))) {
          this.deferredLossless.shift();
        }
        throw error;
      }
    }
  }

  private allocateAtUs(mappedAtUs: number): number {
    const atUs = Math.max(mappedAtUs, this.lastEventAtUs + 1);
    this.lastEventAtUs = atUs;
    return atUs;
  }

  private mapPayload(payload: RendererCapturePayload, atUs: number): UnifiedEvent {
    const common = { schemaVersion: 1 as const, sessionId: this.options.sessionId, atUs };
    switch (payload.kind) {
      case 'ink-journal': {
        const journal = payload.event;
        if (journal.kind === 'viewport') {
          const event: UnifiedEvent = {
            ...common,
            kind: 'scroll',
            deltaX: journal.scrollX - this.previousViewport.scrollX,
            deltaY: journal.scrollY - this.previousViewport.scrollY,
          };
          this.previousViewport = { scrollX: journal.scrollX, scrollY: journal.scrollY };
          return event;
        }
        if (journal.kind === 'pointer') {
          return {
            ...common,
            kind: 'ink',
            operation: 'stroke',
            payload: { x: journal.x, y: journal.y, tool: journal.tool, phase: journal.phase },
          };
        }
        return {
          ...common,
          kind: 'ink',
          operation: journal.deletedIds.length > 0 && journal.upserts.length === 0 ? 'erase' : 'stroke',
          payload: {
            upserts: journal.upserts,
            deletedIds: journal.deletedIds,
            fileUpserts: journal.fileUpserts,
          },
        };
      }
      case 'laser':
        return { ...common, kind: 'ink', operation: 'stroke', payload: {
          source: 'laser', x: payload.x, y: payload.y, phase: payload.phase,
        } };
      default:
        return { ...common, ...payload } as UnifiedEvent;
    }
  }
}

function eventSignature(event: UnifiedEvent): string {
  return JSON.stringify(event);
}
