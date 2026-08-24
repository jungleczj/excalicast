import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { AttentionFeatureVector, AttentionObservation, NormalizedRoi } from '../../../src/desktop/attentionEngine';
import type { SpeechActivityInterval } from '../../../src/desktop/autoCleanupPlanner';
import type { CameraPlannerProfile } from '../../../src/desktop/cameraPlanner';
import {
  DirectorArtifactPersistenceService,
  type DirectorArtifactIndexV1,
} from '../../../src/desktop/teachingDirectorArtifactStore';
import { parseUnifiedEvent, type UnifiedEvent } from '../../../src/desktop/unifiedEventSchema';
import {
  DIRECTOR_ARTIFACT_MAX_TOTAL_BYTES,
  NodeDirectorArtifactWriter,
  type DirectorArtifactWriterFaults,
} from './directorArtifactWriter';

const IDENTIFIER = /^[a-zA-Z0-9_-]{1,128}$/;
const KNOWN_TRACKS = new Set([
  'screen', 'camera', 'microphone', 'system-audio', 'excalidraw-events', 'input-telemetry',
]);
const KNOWN_PRODUCERS = new Set(['native-input', 'main-whiteboard', 'desktop-ink']);
const PATH_AUTHORITY_KEYS = new Set(['path', 'relativePath', 'projectRoot']);
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;

export const NATIVE_DIRECTOR_MAX_SEGMENT_BYTES = 5 * 1024 * 1024;
export const NATIVE_DIRECTOR_MAX_TELEMETRY_BYTES = 128 * 1024 * 1024;
export const NATIVE_DIRECTOR_MAX_EVENTS = 5_000_000;
export const NATIVE_DIRECTOR_MAX_RETAINED_PLANNER_EVENTS = 50_000;
export const NATIVE_DIRECTOR_MAX_ROI_OBSERVATIONS = 20_000;

interface ManifestSegment {
  index: number;
  relativePath: string;
  startUs: number;
  durationUs: number;
  byteLength: number;
}

interface ValidatedManifest {
  recordingId: string;
  state: 'ready' | 'interrupted';
  segments: ManifestSegment[];
}

export interface NativeDirectorPipelineLimits {
  maximumSegmentBytes?: number;
  maximumTelemetryBytes?: number;
  maximumEvents?: number;
  maximumRetainedPlannerEvents?: number;
  maximumRoiObservations?: number;
}

export interface NativeDirectorPipelineRequest {
  projectRoot: string;
  sourceRecordingId: string;
  sessionId: string;
  durationUs: number;
  profile: CameraPlannerProfile;
  speechActivity: SpeechActivityInterval[];
  attentionWindowMs?: number;
  limits?: NativeDirectorPipelineLimits;
  writerFaults?: DirectorArtifactWriterFaults;
  signal?: AbortSignal;
}

export interface NativeDirectorPipelineEvidence {
  sourceRecordingId: string;
  sessionId: string;
  manifestState: 'ready' | 'interrupted' | 'unknown';
  telemetrySegmentsRead: number;
  telemetryBytesRead: number;
  maximumSegmentBytesRead: number;
  eventCount: number;
  retainedPlannerEventCount: number;
  roiObservationCount: number;
  preservedMedia: true;
}

export type NativeDirectorPipelineResult =
  | {
    status: 'ready';
    retryable: false;
    checkpoint: DirectorArtifactIndexV1;
    evidence: NativeDirectorPipelineEvidence;
  }
  | {
    status: 'failed';
    retryable: boolean;
    code: string;
    evidence: NativeDirectorPipelineEvidence;
  };

class NativeDirectorPipelineError extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
  }
}

function fail(code: string, retryable = false): never {
  throw new NativeDirectorPipelineError(code, retryable);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) fail('director_native_cancelled', true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > fallback) {
    fail('director_native_limits_invalid');
  }
  return value;
}

function hasPathAuthority(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPathAuthority);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => PATH_AUTHORITY_KEYS.has(key) || hasPathAuthority(child));
}

async function requireRegularFile(candidate: string, code: string): Promise<number> {
  let stat;
  try {
    stat = await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail(code);
    fail('director_native_telemetry_read_failed', true);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail(code);
  return stat.size;
}

async function requireNoSymlinkPath(root: string, candidate: string): Promise<void> {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('director_native_segment_path_invalid');
  }
  let current = root;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('director_native_segment_missing');
      fail('director_native_telemetry_read_failed', true);
    }
    if (stat.isSymbolicLink()) fail('director_native_segment_symlink');
  }
}

function parseManifestSegment(value: unknown, expectedIndex: number): ManifestSegment {
  if (!isRecord(value)
    || Object.keys(value).some((key) => !['index', 'relativePath', 'startUs', 'durationUs', 'byteLength'].includes(key))
    || value.index !== expectedIndex
    || typeof value.relativePath !== 'string'
    || !safeInteger(value.startUs) || value.startUs < 0
    || !safeInteger(value.durationUs) || value.durationUs < 1
    || !safeInteger(value.byteLength) || value.byteLength < 1) {
    fail('director_native_manifest_segment_invalid');
  }
  const expectedPath = `segments/input-telemetry/${String(expectedIndex).padStart(6, '0')}.segment`;
  if (value.relativePath !== expectedPath) fail('director_native_segment_path_invalid');
  return value as unknown as ManifestSegment;
}

async function loadManifest(request: NativeDirectorPipelineRequest, projectRoot: string): Promise<ValidatedManifest> {
  const manifestPath = path.join(projectRoot, 'manifest.json');
  const size = await requireRegularFile(manifestPath, 'director_native_manifest_missing');
  if (size > MANIFEST_MAX_BYTES) fail('director_native_manifest_oversized');
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) fail('director_native_manifest_corrupt');
    fail('director_native_manifest_read_failed', true);
  }
  if (!isRecord(raw)
    || raw.schemaVersion !== 1
    || raw.recordingId !== request.sourceRecordingId
    || raw.recordingId !== request.sessionId
    || !['ready', 'interrupted'].includes(raw.state as string)
    || !isRecord(raw.tracks)) {
    fail('director_native_manifest_identity_invalid');
  }
  for (const track of Object.keys(raw.tracks)) {
    if (!KNOWN_TRACKS.has(track) || !Array.isArray(raw.tracks[track])) {
      fail('director_native_manifest_track_invalid');
    }
  }
  const telemetry = raw.tracks['input-telemetry'];
  if (!Array.isArray(telemetry)) fail('director_native_manifest_track_invalid');
  const segments = telemetry.map((segment, index) => parseManifestSegment(segment, index));
  return {
    recordingId: raw.recordingId as string,
    state: raw.state as 'ready' | 'interrupted',
    segments,
  };
}

const COMMON_KEYS = new Set([
  'schemaVersion', 'sessionId', 'atUs', 'kind', 'producerId', 'producerEpoch', 'producerSequence', 'surfaceId',
]);
const KIND_KEYS: Record<UnifiedEvent['kind'], ReadonlySet<string>> = {
  'active-window': new Set(['application', 'bundleIdentifier', 'processId', 'windowId', 'title']),
  'window-bounds': new Set(['windowId', 'x', 'y', 'width', 'height']),
  cursor: new Set(['x', 'y', 'sourceCoordinateSpace', 'coordinateSpaceVersion', 'displayId', 'scale']),
  click: new Set(['x', 'y', 'button', 'phase', 'sourceCoordinateSpace', 'coordinateSpaceVersion', 'displayId', 'scale']),
  dwell: new Set(['x', 'y', 'durationUs']),
  scroll: new Set(['x', 'y', 'deltaX', 'deltaY', 'sourceCoordinateSpace', 'coordinateSpaceVersion', 'displayId', 'scale']),
  ink: new Set(['operation', 'payload']),
  undo: new Set(['scope', 'steps']),
  'mode-change': new Set(['mode']),
  'camera-control': new Set(['action', 'value']),
};

interface ProducerCursor {
  lastSequence: number;
}

interface EventAdaptationState {
  activeWindowId: number | null;
}

function validateNativeWirePayload(value: Record<string, unknown>, adaptation: EventAdaptationState): void {
  if (value.surfaceId !== 'macos-global'
    || !['active-window', 'window-bounds', 'cursor', 'click', 'scroll'].includes(value.kind as string)) {
    fail('director_native_event_schema_invalid');
  }
  switch (value.kind) {
    case 'active-window':
      if (typeof value.application !== 'string' || value.application.length === 0
        || typeof value.bundleIdentifier !== 'string' || value.bundleIdentifier.length === 0
        || !safeInteger(value.processId) || value.processId <= 0
        || !safeInteger(value.windowId) || value.windowId <= 0
        || (value.title !== undefined && typeof value.title !== 'string')) {
        fail('director_native_event_schema_invalid');
      }
      return;
    case 'window-bounds':
      if ((value.windowId !== undefined
        && (!safeInteger(value.windowId) || value.windowId <= 0))
        || (value.windowId === undefined && adaptation.activeWindowId === null)
        || !finite(value.x) || !finite(value.y)
        || !finite(value.width) || value.width <= 0
        || !finite(value.height) || value.height <= 0) {
        fail('director_native_event_schema_invalid');
      }
      return;
    case 'cursor':
    case 'click':
    case 'scroll':
      if (!finite(value.x) || !finite(value.y)
        || value.sourceCoordinateSpace !== 'macos-global-display-points-v1'
        || value.coordinateSpaceVersion !== 1
        || !safeInteger(value.displayId) || value.displayId <= 0
        || !finite(value.scale) || value.scale <= 0) {
        fail('director_native_event_schema_invalid');
      }
      if (value.kind === 'click'
        && (!['primary', 'secondary', 'middle', 'other'].includes(value.button as string)
          || !['down', 'up'].includes(value.phase as string))) {
        fail('director_native_event_schema_invalid');
      }
      if (value.kind === 'scroll' && (!finite(value.deltaX) || !finite(value.deltaY))) {
        fail('director_native_event_schema_invalid');
      }
      return;
    default:
      fail('director_native_event_schema_invalid');
  }
}

function adaptEvent(
  value: unknown,
  request: NativeDirectorPipelineRequest,
  producerState: Map<string, ProducerCursor>,
  adaptation: EventAdaptationState,
  isFirstInSegment: boolean,
): UnifiedEvent {
  if (!isRecord(value) || hasPathAuthority(value)
    || value.schemaVersion !== 1
    || value.sessionId !== request.sessionId
    || !safeInteger(value.atUs) || value.atUs < 0 || value.atUs >= request.durationUs
    || typeof value.kind !== 'string' || !(value.kind in KIND_KEYS)
    || typeof value.producerId !== 'string' || !KNOWN_PRODUCERS.has(value.producerId)
    || typeof value.producerEpoch !== 'string' || !IDENTIFIER.test(value.producerEpoch)
    || !safeInteger(value.producerSequence) || value.producerSequence < 0
    || typeof value.surfaceId !== 'string' || !IDENTIFIER.test(value.surfaceId)) {
    fail('director_native_event_schema_invalid');
  }
  const allowed = KIND_KEYS[value.kind as UnifiedEvent['kind']];
  if (Object.keys(value).some((key) => !COMMON_KEYS.has(key) && !allowed.has(key))) {
    fail('director_native_event_schema_invalid');
  }
  if (value.producerId === 'native-input') validateNativeWirePayload(value, adaptation);
  const producerKey = `${value.producerId}\u0000${value.producerEpoch}`;
  const sequence = value.producerSequence as number;
  const previous = producerState.get(producerKey)?.lastSequence;
  if (previous === undefined) {
    if (value.producerId === 'native-input' && sequence !== 0) {
      fail('director_native_event_sequence_invalid');
    }
  } else if (isFirstInSegment) {
    if (sequence <= previous || (value.producerId === 'native-input' && sequence !== previous + 1)) {
      fail('director_native_event_sequence_invalid');
    }
  } else if (sequence !== previous + 1) {
    fail('director_native_event_sequence_invalid');
  }
  producerState.set(producerKey, { lastSequence: sequence });

  const common = {
    schemaVersion: 1 as const,
    sessionId: request.sessionId,
    atUs: value.atUs as number,
  };
  let adapted: UnifiedEvent;
  switch (value.kind) {
    case 'active-window':
      adapted = {
        ...common,
        kind: 'active-window',
        application: value.application as string,
        windowId: value.windowId as number,
        ...(value.title === undefined ? {} : { title: value.title as string }),
      };
      break;
    case 'window-bounds':
      adapted = {
        ...common,
        kind: 'window-bounds',
        windowId: (value.windowId ?? adaptation.activeWindowId) as number,
        x: value.x as number,
        y: value.y as number,
        width: value.width as number,
        height: value.height as number,
      };
      break;
    case 'cursor':
      adapted = { ...common, kind: 'cursor', x: value.x as number, y: value.y as number };
      break;
    case 'click':
      adapted = {
        ...common,
        kind: 'click',
        x: value.x as number,
        y: value.y as number,
        button: value.button === 'other' ? 'middle' : value.button as 'primary' | 'secondary' | 'middle',
        phase: value.phase as 'down' | 'up',
      };
      break;
    case 'dwell':
      adapted = { ...common, kind: 'dwell', x: value.x as number, y: value.y as number, durationUs: value.durationUs as number };
      break;
    case 'scroll':
      adapted = { ...common, kind: 'scroll', deltaX: value.deltaX as number, deltaY: value.deltaY as number };
      break;
    case 'ink':
      adapted = { ...common, kind: 'ink', operation: value.operation as 'stroke' | 'erase' | 'clear', payload: value.payload as Record<string, unknown> };
      break;
    case 'undo':
      adapted = { ...common, kind: 'undo', scope: value.scope as 'ink' | 'camera' | 'scene', steps: value.steps as number };
      break;
    case 'mode-change':
      adapted = { ...common, kind: 'mode-change', mode: value.mode as 'screen' | 'whiteboard' | 'presentation' };
      break;
    case 'camera-control':
      adapted = { ...common, kind: 'camera-control', action: value.action as 'enable' | 'disable' | 'mute' | 'unmute' | 'set-layout', ...(value.value === undefined ? {} : { value: value.value as string }) };
      break;
    default:
      fail('director_native_event_schema_invalid');
  }
  let parsed: UnifiedEvent;
  try {
    parsed = parseUnifiedEvent(adapted);
  } catch {
    fail('director_native_event_schema_invalid');
  }
  if (parsed.kind === 'active-window') adaptation.activeWindowId = parsed.windowId;
  return parsed;
}

function validateBatch(value: unknown, segment: ManifestSegment, request: NativeDirectorPipelineRequest): Record<string, unknown>[] {
  if (!isRecord(value)
    || Object.keys(value).some((key) => !['schemaVersion', 'sessionId', 'index', 'startUs', 'endUs', 'events'].includes(key))
    || value.schemaVersion !== 1 || value.sessionId !== request.sessionId
    || value.index !== segment.index || value.startUs !== segment.startUs
    || !safeInteger(value.endUs)
    || value.endUs !== segment.startUs + segment.durationUs - 1
    || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 256) {
    fail('director_native_batch_schema_invalid');
  }
  return value.events as Record<string, unknown>[];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedPointBox(x: number, y: number, bounds: Extract<UnifiedEvent, { kind: 'window-bounds' }> | undefined): NormalizedRoi | null {
  if (!bounds || !finite(x) || !finite(y)) return null;
  const normalizedX = (x - bounds.x) / bounds.width;
  const normalizedY = (y - bounds.y) / bounds.height;
  if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return null;
  const width = 0.2;
  const height = 0.2;
  return {
    x: Number(clamp(normalizedX - width / 2, 0, 1 - width).toFixed(6)),
    y: Number(clamp(normalizedY - height / 2, 0, 1 - height).toFixed(6)),
    width,
    height,
  };
}

function speechAt(speech: readonly SpeechActivityInterval[], atUs: number): boolean {
  return speech.some((interval) => interval.startUs <= atUs && atUs < interval.endUs
    && interval.confidence >= 0.5 && interval.semanticStatus !== 'possible-mistake');
}

function features(partial: Partial<AttentionFeatureVector>): AttentionFeatureVector {
  return {
    inkActivity: 0,
    speechReference: 0,
    clickDwell: 0,
    objectSalience: 0,
    windowFocus: 0,
    recency: 0.5,
    motionNoise: 0,
    uiControlPenalty: 0,
    ...partial,
  };
}

class RoiObservationReducer {
  private readonly windows = new Map<number, Extract<UnifiedEvent, { kind: 'window-bounds' }>>();
  private activeWindowId: number | null = null;
  private scene = 0;
  private lastCursor: Extract<UnifiedEvent, { kind: 'cursor' }> | null = null;
  private cursorStationarySinceUs: number | null = null;
  private lastCursorObservationUs = -500_000;
  private lastScrollObservationUs = -500_000;
  private readonly result: AttentionObservation[] = [];

  constructor(
    private readonly speechActivity: readonly SpeechActivityInterval[],
    private readonly maximumObservations: number,
  ) {}

  consume(event: UnifiedEvent, rawPointer?: { x: number; y: number }): void {
    if (event.kind === 'active-window') {
      if (this.activeWindowId !== event.windowId) {
        this.scene += 1;
        this.lastCursor = null;
        this.cursorStationarySinceUs = null;
      }
      this.activeWindowId = event.windowId;
      return;
    }
    if (event.kind === 'window-bounds') {
      this.windows.set(event.windowId, event);
      return;
    }
    let bbox: NormalizedRoi | null = null;
    let vector: AttentionFeatureVector | null = null;
    if (event.kind === 'cursor') {
      const distance = this.lastCursor === null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(event.x - this.lastCursor.x, event.y - this.lastCursor.y);
      this.cursorStationarySinceUs = distance <= 8
        ? (this.cursorStationarySinceUs ?? this.lastCursor?.atUs ?? event.atUs)
        : event.atUs;
      const dwellUs = event.atUs - this.cursorStationarySinceUs;
      if (event.atUs - this.lastCursorObservationUs >= 500_000) {
        bbox = this.pointBox(event.x, event.y);
        vector = features({
          clickDwell: dwellUs >= 500_000 ? clamp(dwellUs / 1_500_000, 0, 0.8) : 0,
          speechReference: speechAt(this.speechActivity, event.atUs) ? 0.5 : 0,
          windowFocus: this.activeWindowId === null ? 0 : 0.5,
          motionNoise: distance > 8 && Number.isFinite(distance) ? 0.8 : 0.1,
          objectSalience: 0.1,
        });
        if (bbox) this.lastCursorObservationUs = event.atUs;
      }
      this.lastCursor = event;
    } else if (event.kind === 'scroll' && rawPointer
      && event.atUs - this.lastScrollObservationUs >= 500_000) {
      bbox = this.pointBox(rawPointer.x, rawPointer.y);
      vector = features({
        speechReference: speechAt(this.speechActivity, event.atUs) ? 0.4 : 0,
        windowFocus: this.activeWindowId === null ? 0 : 0.5,
        objectSalience: 0.1,
        motionNoise: 0.5,
      });
      if (bbox) this.lastScrollObservationUs = event.atUs;
    } else if (event.kind === 'click' && event.phase === 'down') {
      bbox = this.pointBox(event.x, event.y);
      vector = features({ clickDwell: 1, speechReference: speechAt(this.speechActivity, event.atUs) ? 1 : 0, windowFocus: 1, objectSalience: 0.4 });
    } else if (event.kind === 'dwell') {
      bbox = this.pointBox(event.x, event.y);
      vector = features({ clickDwell: clamp(event.durationUs / 1_000_000, 0, 1), speechReference: speechAt(this.speechActivity, event.atUs) ? 1 : 0, windowFocus: 1 });
    } else if (event.kind === 'ink' && event.operation === 'stroke' && isRecord(event.payload.bbox)) {
      const candidate = event.payload.bbox;
      if ([candidate.x, candidate.y, candidate.width, candidate.height].every(finite)
        && (candidate.x as number) >= 0 && (candidate.y as number) >= 0
        && (candidate.width as number) > 0 && (candidate.height as number) > 0
        && (candidate.x as number) + (candidate.width as number) <= 1
        && (candidate.y as number) + (candidate.height as number) <= 1) {
        bbox = candidate as unknown as NormalizedRoi;
        vector = features({ inkActivity: 1, speechReference: speechAt(this.speechActivity, event.atUs) ? 1 : 0, windowFocus: this.activeWindowId === null ? 0 : 1, objectSalience: 0.5 });
      }
    }
    if (bbox && vector) {
      if (this.result.length >= this.maximumObservations) fail('director_native_roi_budget_exceeded');
      this.result.push({
        id: `native-roi-${String(this.result.length).padStart(8, '0')}`,
        sceneId: `scene-${String(this.scene).padStart(4, '0')}`,
        roiId: `roi-${bbox.x}-${bbox.y}-${bbox.width}-${bbox.height}`,
        atMs: Math.floor(event.atUs / 1_000),
        bbox: { ...bbox },
        features: vector,
      });
    }
  }

  snapshot(): AttentionObservation[] {
    return this.result.map((observation) => ({
      ...observation,
      bbox: { ...observation.bbox },
      features: { ...observation.features },
    }));
  }

  private pointBox(x: number, y: number): NormalizedRoi | null {
    return normalizedPointBox(
      x,
      y,
      this.activeWindowId === null ? undefined : this.windows.get(this.activeWindowId),
    );
  }
}

class PlannerEventReducer {
  private readonly retained: UnifiedEvent[] = [];
  private pendingScroll: Extract<UnifiedEvent, { kind: 'scroll' }> | null = null;

  constructor(private readonly maximumRetained: number) {}

  consume(event: UnifiedEvent): void {
    if (event.kind === 'cursor') return;
    if (event.kind === 'scroll') {
      if (this.pendingScroll && event.atUs - this.pendingScroll.atUs < 500_000) {
        this.pendingScroll = {
          ...event,
          deltaX: this.pendingScroll.deltaX + event.deltaX,
          deltaY: this.pendingScroll.deltaY + event.deltaY,
        };
        return;
      }
      this.flushScroll();
      this.pendingScroll = event;
      return;
    }
    this.flushScroll();
    this.append(event);
  }

  finish(): UnifiedEvent[] {
    this.flushScroll();
    return [...this.retained];
  }

  private flushScroll(): void {
    if (!this.pendingScroll) return;
    this.append(this.pendingScroll);
    this.pendingScroll = null;
  }

  private append(event: UnifiedEvent): void {
    if (this.retained.length >= this.maximumRetained) {
      fail('director_native_retained_event_budget_exceeded');
    }
    this.retained.push(event);
  }
}

export function deriveNativeDirectorRoiObservations(
  events: readonly UnifiedEvent[],
  speechActivity: readonly SpeechActivityInterval[],
): AttentionObservation[] {
  const reducer = new RoiObservationReducer(speechActivity, NATIVE_DIRECTOR_MAX_ROI_OBSERVATIONS);
  for (const event of events) reducer.consume(event);
  return reducer.snapshot();
}

function validateRequest(request: NativeDirectorPipelineRequest): void {
  if (!request.projectRoot || !IDENTIFIER.test(request.sourceRecordingId) || !IDENTIFIER.test(request.sessionId)
    || request.sourceRecordingId !== request.sessionId
    || !safeInteger(request.durationUs) || request.durationUs <= 0 || request.durationUs % 1_000 !== 0
    || !['Calm', 'Balanced', 'Dynamic'].includes(request.profile)) {
    fail('director_native_request_invalid');
  }
  for (const interval of request.speechActivity) {
    if (!safeInteger(interval.startUs) || !safeInteger(interval.endUs)
      || interval.startUs < 0 || interval.endUs <= interval.startUs || interval.endUs > request.durationUs
      || !finite(interval.confidence) || interval.confidence < 0 || interval.confidence > 1
      || (interval.semanticStatus !== undefined
        && !['recognized', 'uncertain', 'possible-mistake'].includes(interval.semanticStatus))) {
      fail('director_native_speech_invalid');
    }
  }
}

export async function runNativeDirectorArtifactPipeline(
  request: NativeDirectorPipelineRequest,
): Promise<NativeDirectorPipelineResult> {
  const evidence: NativeDirectorPipelineEvidence = {
    sourceRecordingId: request.sourceRecordingId,
    sessionId: request.sessionId,
    manifestState: 'unknown',
    telemetrySegmentsRead: 0,
    telemetryBytesRead: 0,
    maximumSegmentBytesRead: 0,
    eventCount: 0,
    retainedPlannerEventCount: 0,
    roiObservationCount: 0,
    preservedMedia: true,
  };
  try {
    throwIfAborted(request.signal);
    validateRequest(request);
    const maximumSegmentBytes = validateLimit(request.limits?.maximumSegmentBytes, NATIVE_DIRECTOR_MAX_SEGMENT_BYTES);
    const maximumTelemetryBytes = validateLimit(request.limits?.maximumTelemetryBytes, NATIVE_DIRECTOR_MAX_TELEMETRY_BYTES);
    const maximumEvents = validateLimit(request.limits?.maximumEvents, NATIVE_DIRECTOR_MAX_EVENTS);
    const maximumRetainedPlannerEvents = validateLimit(
      request.limits?.maximumRetainedPlannerEvents,
      NATIVE_DIRECTOR_MAX_RETAINED_PLANNER_EVENTS,
    );
    const maximumRoiObservations = validateLimit(
      request.limits?.maximumRoiObservations,
      NATIVE_DIRECTOR_MAX_ROI_OBSERVATIONS,
    );
    const rootStat = await lstat(request.projectRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') fail('director_native_project_missing');
      fail('director_native_manifest_read_failed', true);
    });
    throwIfAborted(request.signal);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('director_native_project_path_invalid');
    const projectRoot = await realpath(request.projectRoot);
    throwIfAborted(request.signal);
    const manifest = await loadManifest(request, projectRoot);
    throwIfAborted(request.signal);
    evidence.manifestState = manifest.state;
    const producerState = new Map<string, ProducerCursor>();
    const adaptation: EventAdaptationState = { activeWindowId: null };
    const plannerEvents = new PlannerEventReducer(maximumRetainedPlannerEvents);
    const roiReducer = new RoiObservationReducer(request.speechActivity, maximumRoiObservations);
    let previousAtUs = -1;

    for (const segment of manifest.segments) {
      throwIfAborted(request.signal);
      if (segment.byteLength > maximumSegmentBytes) fail('director_native_segment_oversized');
      const candidate = path.resolve(projectRoot, segment.relativePath);
      if (!candidate.startsWith(`${projectRoot}${path.sep}`)) fail('director_native_segment_path_invalid');
      await requireNoSymlinkPath(projectRoot, candidate);
      throwIfAborted(request.signal);
      const actualSize = await requireRegularFile(candidate, 'director_native_segment_missing');
      throwIfAborted(request.signal);
      if (actualSize !== segment.byteLength) fail('director_native_segment_size_mismatch');
      evidence.telemetryBytesRead += actualSize;
      evidence.maximumSegmentBytesRead = Math.max(evidence.maximumSegmentBytesRead, actualSize);
      if (evidence.telemetryBytesRead > maximumTelemetryBytes) fail('director_native_telemetry_budget_exceeded');
      let batch: unknown;
      try {
        batch = JSON.parse(await readFile(candidate, 'utf8'));
      } catch (error) {
        if (error instanceof SyntaxError) fail('director_native_segment_corrupt');
        fail('director_native_telemetry_read_failed', true);
      }
      throwIfAborted(request.signal);
      const rawEvents = validateBatch(batch, segment, request);
      let segmentProducer: string | null = null;
      let segmentEpoch: string | null = null;
      for (let rawIndex = 0; rawIndex < rawEvents.length; rawIndex += 1) {
        throwIfAborted(request.signal);
        const rawEvent = rawEvents[rawIndex];
        const event = adaptEvent(rawEvent, request, producerState, adaptation, rawIndex === 0);
        const producer = rawEvent.producerId as string;
        const epoch = rawEvent.producerEpoch as string;
        segmentProducer ??= producer;
        segmentEpoch ??= epoch;
        if (producer !== segmentProducer || epoch !== segmentEpoch) fail('director_native_batch_producer_mixed');
        if (event.atUs <= previousAtUs) fail('director_native_event_time_invalid');
        if (event.atUs < segment.startUs || event.atUs >= segment.startUs + segment.durationUs) {
          fail('director_native_event_time_invalid');
        }
        previousAtUs = event.atUs;
        const rawPointer = rawEvent.kind === 'scroll' && finite(rawEvent.x) && finite(rawEvent.y)
          ? { x: rawEvent.x, y: rawEvent.y }
          : undefined;
        roiReducer.consume(event, rawPointer);
        plannerEvents.consume(event);
        evidence.eventCount += 1;
        if (evidence.eventCount > maximumEvents) fail('director_native_event_budget_exceeded');
      }
      evidence.telemetrySegmentsRead += 1;
    }
    throwIfAborted(request.signal);
    const events = plannerEvents.finish();
    const roiObservations = roiReducer.snapshot();
    throwIfAborted(request.signal);
    evidence.retainedPlannerEventCount = events.length;
    evidence.roiObservationCount = roiObservations.length;

    const writer = new NodeDirectorArtifactWriter({
      projectRoot,
      sourceRecordingId: request.sourceRecordingId,
      sessionId: request.sessionId,
      maxTotalBytes: DIRECTOR_ARTIFACT_MAX_TOTAL_BYTES,
      ...(request.writerFaults === undefined ? {} : { faults: request.writerFaults }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const persistence = new DirectorArtifactPersistenceService(writer);
    let checkpoint: DirectorArtifactIndexV1;
    try {
      checkpoint = await persistence.persist({
        recording: {
          sourceRecordingId: request.sourceRecordingId,
          sessionId: request.sessionId,
          durationUs: request.durationUs,
          profile: request.profile,
          ...(request.attentionWindowMs === undefined ? {} : { attentionWindowMs: request.attentionWindowMs }),
        },
        events,
        speechActivity: request.speechActivity.map((interval) => ({ ...interval })),
        roiObservations,
      });
      throwIfAborted(request.signal);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'director_artifact_cancelled'
        || code === 'director_native_cancelled'
        || request.signal?.aborted) {
        fail('director_native_cancelled', true);
      }
      if (code.startsWith('director_artifact_')
        && (code.includes('invalid') || code.includes('exceeded') || code.includes('mismatch'))) {
        fail('director_native_artifact_validation_failed');
      }
      fail('director_native_artifact_write_failed', true);
    }
    return { status: 'ready', retryable: false, checkpoint, evidence };
  } catch (error) {
    const failure = error instanceof NativeDirectorPipelineError
      ? error
      : new NativeDirectorPipelineError('director_native_internal_failed', true);
    return { status: 'failed', retryable: failure.retryable, code: failure.code, evidence };
  }
}
