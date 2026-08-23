import type { DesktopInkEvent } from './inkEventJournal';

export interface NativeInkEventSegmentInput {
  startUs: number;
  payload: string;
}

type WithRelativeTime<T> = T extends { atUnixMs: number }
  ? Omit<T, 'atUnixMs'> & { atUs: number }
  : never;

export type TimedDesktopInkEvent = WithRelativeTime<DesktopInkEvent>;

export interface DesktopInkReplayFrame {
  timeUs: number;
  /** Last scene or viewport mutation. Pointer-only frames retain the prior revision. */
  revisionUs: number;
  elements: readonly Record<string, unknown>[];
  files: Readonly<Record<string, Record<string, unknown>>>;
  appState: Readonly<{
    scrollX: number;
    scrollY: number;
    zoom: { value: number };
    width?: number;
    height?: number;
    viewBackgroundColor?: string;
  }>;
  pointer?: Readonly<{
    x: number;
    y: number;
    tool: string;
    phase: 'down' | 'move' | 'up';
  }>;
}

export function parseNativeInkEventSegments(
  segments: readonly NativeInkEventSegmentInput[],
): TimedDesktopInkEvent[] {
  const result: Array<TimedDesktopInkEvent & { order: number }> = [];
  let order = 0;
  for (const segment of [...segments].sort((a, b) => a.startUs - b.startUs)) {
    if (!Number.isFinite(segment.startUs) || segment.startUs < 0) {
      throw new Error('desktop_ink_event_segment_invalid');
    }
    let envelope: unknown;
    try { envelope = JSON.parse(segment.payload); }
    catch { throw new Error('desktop_ink_event_segment_invalid'); }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new Error('desktop_ink_event_segment_invalid');
    }
    const value = envelope as Record<string, unknown>;
    if (value.schemaVersion !== 1 || !Array.isArray(value.events) || value.events.length === 0) {
      throw new Error('desktop_ink_event_segment_invalid');
    }
    const firstUnixMs = eventUnixMs(value.events[0]);
    for (const rawEvent of value.events) {
      const atUnixMs = eventUnixMs(rawEvent);
      const atUs = segment.startUs + Math.max(0, Math.round((atUnixMs - firstUnixMs) * 1_000));
      result.push({ ...parseInkEvent(rawEvent), atUs, order });
      order += 1;
    }
  }
  return result
    .sort((a, b) => a.atUs - b.atUs || a.order - b.order)
    .map(({ order: _order, ...event }) => event);
}

export class DesktopInkReplay {
  private readonly events: readonly TimedDesktopInkEvent[];
  private readonly pointerEvents: readonly Extract<TimedDesktopInkEvent, { kind: 'pointer' }>[];
  private readonly contentHistory: readonly Record<string, unknown>[];
  private readonly elements = new Map<string, Record<string, unknown>>();
  private readonly files: Record<string, Record<string, unknown>> = {};
  private appState = { scrollX: 0, scrollY: 0, zoom: { value: 1 } };
  private cursor = 0;
  private lastTimeUs = -1;
  private revisionUs = -1;
  readonly hasEvents: boolean;
  readonly hasPointerEvents: boolean;

  constructor(events: readonly TimedDesktopInkEvent[]) {
    this.events = [...events].sort((a, b) => a.atUs - b.atUs);
    this.pointerEvents = this.events.filter(
      (event): event is Extract<TimedDesktopInkEvent, { kind: 'pointer' }> => event.kind === 'pointer',
    );
    this.contentHistory = this.events.flatMap((event) => event.kind === 'scene-delta' ? event.upserts : []);
    this.hasEvents = this.events.length > 0;
    this.hasPointerEvents = this.pointerEvents.length > 0;
  }

  contentElements(): readonly Record<string, unknown>[] {
    return this.contentHistory;
  }

  frameAt(timeUs: number): DesktopInkReplayFrame {
    const targetUs = Math.max(0, Math.round(timeUs));
    if (targetUs < this.lastTimeUs) this.reset();
    while (this.cursor < this.events.length && this.events[this.cursor].atUs <= targetUs) {
      this.apply(this.events[this.cursor]);
      this.cursor += 1;
    }
    this.lastTimeUs = targetUs;
    return {
      timeUs: targetUs,
      revisionUs: this.revisionUs,
      elements: [...this.elements.values()],
      files: { ...this.files },
      appState: this.appState,
      pointer: this.pointerAt(targetUs),
    };
  }

  private apply(event: TimedDesktopInkEvent): void {
    switch (event.kind) {
    case 'scene-delta':
      for (const id of event.deletedIds) this.elements.delete(id);
      for (const element of event.upserts) {
        if (typeof element.id === 'string') this.elements.set(element.id, element);
      }
      Object.assign(this.files, event.fileUpserts);
      this.revisionUs = event.atUs;
      break;
    case 'viewport':
      this.appState = {
        scrollX: event.scrollX,
        scrollY: event.scrollY,
        zoom: { value: event.zoom },
        ...(event.width === undefined ? {} : { width: event.width }),
        ...(event.height === undefined ? {} : { height: event.height }),
        ...(event.viewBackgroundColor === undefined ? {} : { viewBackgroundColor: event.viewBackgroundColor }),
      };
      this.revisionUs = event.atUs;
      break;
    case 'pointer':
      break;
    }
  }

  private pointerAt(timeUs: number): DesktopInkReplayFrame['pointer'] {
    let previous: Extract<TimedDesktopInkEvent, { kind: 'pointer' }> | undefined;
    let next: Extract<TimedDesktopInkEvent, { kind: 'pointer' }> | undefined;
    for (const pointer of this.pointerEvents) {
      if (pointer.atUs <= timeUs) previous = pointer;
      else { next = pointer; break; }
    }
    if (!previous || previous.phase === 'up') return undefined;
    if (!next && timeUs - previous.atUs > 250_000) return undefined;
    if (!next || next.tool !== previous.tool || next.phase === 'up'
      || next.atUs - previous.atUs > 250_000) {
      return pointerFrame(previous);
    }
    const progress = clamp01((timeUs - previous.atUs) / Math.max(1, next.atUs - previous.atUs));
    return {
      x: previous.x + (next.x - previous.x) * progress,
      y: previous.y + (next.y - previous.y) * progress,
      tool: previous.tool,
      phase: previous.phase,
    };
  }

  private reset(): void {
    this.elements.clear();
    for (const key of Object.keys(this.files)) delete this.files[key];
    this.appState = { scrollX: 0, scrollY: 0, zoom: { value: 1 } };
    this.cursor = 0;
    this.lastTimeUs = -1;
    this.revisionUs = -1;
  }
}

export function createReplayFrameTimes(durationUs: number, framesPerSecond = 60): number[] {
  if (!Number.isFinite(durationUs) || durationUs < 0
    || !Number.isInteger(framesPerSecond) || framesPerSecond <= 0 || framesPerSecond > 120) {
    throw new Error('desktop_ink_replay_timing_invalid');
  }
  const roundedDurationUs = Math.round(durationUs);
  const frameTimes: number[] = [];
  for (let index = 0; ; index += 1) {
    const atUs = Math.round(index * 1_000_000 / framesPerSecond);
    if (atUs >= roundedDurationUs) break;
    frameTimes.push(atUs);
  }
  if (frameTimes.at(-1) !== roundedDurationUs) frameTimes.push(roundedDurationUs);
  return frameTimes;
}

function eventUnixMs(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop_ink_event_segment_invalid');
  }
  const atUnixMs = (value as Record<string, unknown>).atUnixMs;
  if (typeof atUnixMs !== 'number' || !Number.isFinite(atUnixMs)) {
    throw new Error('desktop_ink_event_segment_invalid');
  }
  return atUnixMs;
}

function parseInkEvent(value: unknown): DesktopInkEvent {
  const event = value as Record<string, unknown>;
  const atUnixMs = eventUnixMs(value);
  switch (event.kind) {
  case 'scene-delta':
    if (!Array.isArray(event.upserts) || !Array.isArray(event.deletedIds)
      || !event.fileUpserts || typeof event.fileUpserts !== 'object') {
      throw new Error('desktop_ink_event_segment_invalid');
    }
    return {
      kind: 'scene-delta', atUnixMs,
      upserts: event.upserts as Record<string, unknown>[],
      deletedIds: event.deletedIds as string[],
      fileUpserts: event.fileUpserts as Record<string, Record<string, unknown>>,
    };
  case 'viewport':
    if (![event.scrollX, event.scrollY, event.zoom].every((item) => typeof item === 'number' && Number.isFinite(item))) {
      throw new Error('desktop_ink_event_segment_invalid');
    }
    return {
      kind: 'viewport', atUnixMs,
      scrollX: event.scrollX as number,
      scrollY: event.scrollY as number,
      zoom: event.zoom as number,
      ...(optionalFiniteNumber(event.width) === undefined ? {} : { width: event.width as number }),
      ...(optionalFiniteNumber(event.height) === undefined ? {} : { height: event.height as number }),
      ...(typeof event.viewBackgroundColor === 'string'
        ? { viewBackgroundColor: event.viewBackgroundColor }
        : {}),
    };
  case 'pointer':
    if (typeof event.x !== 'number' || typeof event.y !== 'number'
      || !Number.isFinite(event.x) || !Number.isFinite(event.y)
      || typeof event.tool !== 'string'
      || (event.phase !== 'down' && event.phase !== 'move' && event.phase !== 'up')) {
      throw new Error('desktop_ink_event_segment_invalid');
    }
    return {
      kind: 'pointer', atUnixMs,
      x: event.x,
      y: event.y,
      tool: event.tool,
      phase: event.phase,
    };
  default:
    throw new Error('desktop_ink_event_segment_invalid');
  }
}

function pointerFrame(
  pointer: Extract<TimedDesktopInkEvent, { kind: 'pointer' }>,
): NonNullable<DesktopInkReplayFrame['pointer']> {
  return { x: pointer.x, y: pointer.y, tool: pointer.tool, phase: pointer.phase };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
