import { UNIFIED_EVENT_KINDS, type UnifiedEventKind } from './projectSchema';

interface UnifiedEventBase {
  schemaVersion: 1;
  sessionId: string;
  atUs: number;
  kind: UnifiedEventKind;
}

export type UnifiedEvent =
  | (UnifiedEventBase & { kind: 'active-window'; application: string; windowId: number; title?: string })
  | (UnifiedEventBase & { kind: 'window-bounds'; windowId: number; x: number; y: number; width: number; height: number })
  | (UnifiedEventBase & { kind: 'cursor'; x: number; y: number })
  | (UnifiedEventBase & { kind: 'click'; x: number; y: number; button: 'primary' | 'secondary' | 'middle'; phase: 'down' | 'up' })
  | (UnifiedEventBase & { kind: 'dwell'; x: number; y: number; durationUs: number })
  | (UnifiedEventBase & { kind: 'scroll'; deltaX: number; deltaY: number })
  | (UnifiedEventBase & { kind: 'ink'; operation: 'stroke' | 'erase' | 'clear'; payload: Record<string, unknown> })
  | (UnifiedEventBase & { kind: 'undo'; scope: 'ink' | 'camera' | 'scene'; steps: number })
  | (UnifiedEventBase & { kind: 'mode-change'; mode: 'screen' | 'whiteboard' | 'presentation' })
  | (UnifiedEventBase & { kind: 'camera-control'; action: 'enable' | 'disable' | 'mute' | 'unmute' | 'set-layout'; value?: string });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function coordinates(event: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => finite(event[key]));
}

export function parseUnifiedEvent(value: unknown): UnifiedEvent {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('unified_event_schema_unsupported');
  }
  if (typeof value.sessionId !== 'string'
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.sessionId)
    || !safeInteger(value.atUs)
    || (value.atUs as number) < 0) {
    throw new Error('unified_event_identity_invalid');
  }
  if (typeof value.kind !== 'string'
    || !UNIFIED_EVENT_KINDS.includes(value.kind as UnifiedEventKind)) {
    throw new Error('unified_event_kind_invalid');
  }

  let valid = false;
  switch (value.kind) {
    case 'active-window':
      valid = typeof value.application === 'string' && value.application.length > 0
        && safeInteger(value.windowId) && (value.windowId as number) > 0
        && (value.title === undefined || typeof value.title === 'string');
      break;
    case 'window-bounds':
      valid = safeInteger(value.windowId) && (value.windowId as number) > 0
        && coordinates(value, ['x', 'y', 'width', 'height'])
        && (value.width as number) > 0 && (value.height as number) > 0;
      break;
    case 'cursor':
      valid = coordinates(value, ['x', 'y']);
      break;
    case 'click':
      valid = coordinates(value, ['x', 'y'])
        && ['primary', 'secondary', 'middle'].includes(value.button as string)
        && ['down', 'up'].includes(value.phase as string);
      break;
    case 'dwell':
      valid = coordinates(value, ['x', 'y']) && safeInteger(value.durationUs)
        && (value.durationUs as number) > 0;
      break;
    case 'scroll':
      valid = coordinates(value, ['deltaX', 'deltaY']);
      break;
    case 'ink':
      valid = ['stroke', 'erase', 'clear'].includes(value.operation as string)
        && isRecord(value.payload);
      break;
    case 'undo':
      valid = ['ink', 'camera', 'scene'].includes(value.scope as string)
        && safeInteger(value.steps) && (value.steps as number) > 0;
      break;
    case 'mode-change':
      valid = ['screen', 'whiteboard', 'presentation'].includes(value.mode as string);
      break;
    case 'camera-control':
      valid = ['enable', 'disable', 'mute', 'unmute', 'set-layout'].includes(value.action as string)
        && (value.value === undefined || typeof value.value === 'string');
      break;
    default:
      valid = false;
  }
  if (!valid) throw new Error('unified_event_payload_invalid');
  return value as unknown as UnifiedEvent;
}

export class PausedSessionClock {
  private pausedAtHostUs: number | null = null;
  private pausedDurationUs = 0;
  private lastHostUs: number;

  constructor(private readonly startedAtHostUs: number) {
    if (!safeInteger(startedAtHostUs) || startedAtHostUs < 0) {
      throw new Error('unified_event_clock_invalid');
    }
    this.lastHostUs = startedAtHostUs;
  }

  atUs(hostUs: number): number {
    this.observe(hostUs);
    const effectiveHostUs = this.pausedAtHostUs ?? hostUs;
    return effectiveHostUs - this.startedAtHostUs - this.pausedDurationUs;
  }

  pause(hostUs: number): void {
    if (this.pausedAtHostUs !== null) throw new Error('unified_event_clock_already_paused');
    this.observe(hostUs);
    this.pausedAtHostUs = hostUs;
  }

  resume(hostUs: number): void {
    if (this.pausedAtHostUs === null) throw new Error('unified_event_clock_not_paused');
    this.observe(hostUs);
    this.pausedDurationUs += hostUs - this.pausedAtHostUs;
    this.pausedAtHostUs = null;
  }

  private observe(hostUs: number): void {
    if (!safeInteger(hostUs) || hostUs < this.lastHostUs) {
      throw new Error('unified_event_clock_non_monotonic');
    }
    this.lastHostUs = hostUs;
  }
}

export interface UnifiedEventBatchV1 {
  schemaVersion: 1;
  sessionId: string;
  index: number;
  startUs: number;
  endUs: number;
  events: UnifiedEvent[];
}

export interface UnifiedEventBatcherOptions {
  sessionId: string;
  maximumEvents: number;
  maximumBytes: number;
  nonMonotonic?: 'reject' | 'increment';
  write(batch: UnifiedEventBatchV1): Promise<void>;
}

function encodedBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new Error('unified_event_payload_invalid');
  }
}

export class UnifiedEventBatcher {
  private pending: UnifiedEvent[] = [];
  private pendingBytes = 0;
  private nextBatchIndex = 0;
  private lastAtUs: number | null = null;
  private tail: Promise<void> = Promise.resolve();
  private maximumObserved = 0;

  constructor(private readonly options: UnifiedEventBatcherOptions) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options.sessionId)
      || !safeInteger(options.maximumEvents) || options.maximumEvents < 1
      || !safeInteger(options.maximumBytes) || options.maximumBytes < 1) {
      throw new Error('unified_event_batch_configuration_invalid');
    }
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get pendingByteLength(): number {
    return this.pendingBytes;
  }

  get maximumObservedPendingCount(): number {
    return this.maximumObserved;
  }

  append(value: unknown): Promise<void> {
    return this.enqueue(() => this.appendNow(value));
  }

  flush(): Promise<void> {
    return this.enqueue(() => this.flushNow());
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async appendNow(value: unknown): Promise<void> {
    const parsed = parseUnifiedEvent(value);
    if (parsed.sessionId !== this.options.sessionId) {
      throw new Error('unified_event_session_mismatch');
    }
    let event = JSON.parse(JSON.stringify(parsed)) as UnifiedEvent;
    if (this.lastAtUs !== null && event.atUs <= this.lastAtUs) {
      if ((this.options.nonMonotonic ?? 'reject') === 'reject') {
        throw new Error('unified_event_time_non_monotonic');
      }
      event = { ...event, atUs: this.lastAtUs + 1 } as UnifiedEvent;
    }
    const bytes = encodedBytes(event);
    if (bytes > this.options.maximumBytes) throw new Error('unified_event_too_large');
    if (this.pending.length > 0
      && (this.pending.length + 1 > this.options.maximumEvents
        || this.pendingBytes + bytes > this.options.maximumBytes)) {
      await this.flushNow();
    }
    this.pending.push(event);
    this.pendingBytes += bytes;
    this.lastAtUs = event.atUs;
    this.maximumObserved = Math.max(this.maximumObserved, this.pending.length);
    if (this.pending.length >= this.options.maximumEvents
      || this.pendingBytes >= this.options.maximumBytes) {
      await this.flushNow();
    }
  }

  private async flushNow(): Promise<void> {
    if (this.pending.length === 0) return;
    const events = [...this.pending];
    const batch: UnifiedEventBatchV1 = {
      schemaVersion: 1,
      sessionId: this.options.sessionId,
      index: this.nextBatchIndex,
      startUs: events[0].atUs,
      endUs: events[events.length - 1].atUs,
      events,
    };
    await this.options.write(batch);
    this.nextBatchIndex += 1;
    this.pending = [];
    this.pendingBytes = 0;
  }
}
