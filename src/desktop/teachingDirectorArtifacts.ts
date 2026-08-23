import {
  buildAttentionTimeline,
  type AttentionObservation,
  type AttentionTimelineV1,
  type NormalizedRoi,
} from './attentionEngine';
import {
  planAutoCleanup,
  type AutoCleanupPlanV1,
  type SpeechActivityInterval,
} from './autoCleanupPlanner';
import {
  buildTeachingCameraPlan,
  type CameraPlannerProfile,
  type TeachingCameraPlanV1,
  type TeachingCameraSignal,
} from './cameraPlanner';
import { parseUnifiedEvent, type UnifiedEvent } from './unifiedEventSchema';

export interface TeachingDirectorArtifactsInput {
  sourceRecordingId: string;
  sessionId: string;
  durationUs: number;
  profile: CameraPlannerProfile;
  events: UnifiedEvent[];
  speechActivity: SpeechActivityInterval[];
  roiObservations: AttentionObservation[];
  attentionWindowMs?: number;
}

export interface TeachingDirectorArtifactV1<TFileName extends string, TVersion extends string, TPayload> {
  schemaVersion: 1;
  artifactVersion: TVersion;
  fileName: TFileName;
  sourceRecordingId: string;
  sessionId: string;
  payload: TPayload;
}

export interface TeachingDirectorArtifactSetV1 {
  schemaVersion: 1;
  artifactSetVersion: 'teaching-director-artifacts-v1';
  sourceRecordingId: string;
  sessionId: string;
  durationUs: number;
  artifacts: {
    attention: TeachingDirectorArtifactV1<'attention.json', 'attention-artifact-v1', AttentionTimelineV1>;
    camera: TeachingDirectorArtifactV1<'camera.json', 'camera-artifact-v1', TeachingCameraPlanV1>;
    cleanup: TeachingDirectorArtifactV1<'cleanup.json', 'cleanup-artifact-v1', AutoCleanupPlanV1>;
  };
}

function validIdentity(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function validRoi(value: unknown): value is NormalizedRoi {
  if (!value || typeof value !== 'object') return false;
  const roi = value as NormalizedRoi;
  return [roi.x, roi.y, roi.width, roi.height].every(Number.isFinite)
    && roi.x >= 0
    && roi.y >= 0
    && roi.width > 0
    && roi.height > 0
    && roi.x + roi.width <= 1
    && roi.y + roi.height <= 1;
}

function pointInsideRoi(x: number, y: number, roi: NormalizedRoi): boolean {
  return x >= roi.x && x <= roi.x + roi.width && y >= roi.y && y <= roi.y + roi.height;
}

function overlapsWindow(interval: SpeechActivityInterval, startUs: number, endUs: number): boolean {
  return interval.startUs < endUs
    && startUs < interval.endUs
    && interval.confidence >= 0.5
    && interval.semanticStatus !== 'possible-mistake';
}

function inkEvidence(events: UnifiedEvent[]): {
  bbox: NormalizedRoi;
  contentExpanded: boolean;
  safeFrame: boolean;
} | null {
  const inkEvents = events.filter(
    (event): event is Extract<UnifiedEvent, { kind: 'ink' }> => event.kind === 'ink' && event.operation === 'stroke',
  );
  for (let index = inkEvents.length - 1; index >= 0; index -= 1) {
    const payload = inkEvents[index].payload;
    if (!validRoi(payload.bbox)) continue;
    return {
      bbox: { ...payload.bbox },
      contentExpanded: payload.contentExpanded === true,
      safeFrame: payload.safeFrame !== false,
    };
  }
  return null;
}

/**
 * Conservatively converts scored attention windows into camera evidence.
 * A primary ROI is necessary but never sufficient for FOCUS: click, dwell,
 * and speech activity must independently agree inside the same window.
 */
export function attentionTimelineToCameraSignals(params: {
  timeline: AttentionTimelineV1;
  sessionId: string;
  events: readonly UnifiedEvent[];
  speechActivity: readonly SpeechActivityInterval[];
}): TeachingCameraSignal[] {
  const events = params.events.map((event) => parseUnifiedEvent(event));
  if (events.some((event) => event.sessionId !== params.sessionId)) {
    throw new Error('teaching_director_session_mismatch');
  }
  const sortedEvents = [...events].sort((left, right) => left.atUs - right.atUs || left.kind.localeCompare(right.kind));

  return params.timeline.windows.map((window) => {
    const startUs = window.startMs * 1_000;
    const endUs = window.endMs * 1_000;
    const windowEvents = sortedEvents.filter((event) => event.atUs >= startUs && event.atUs < endUs);
    const primary = window.primaryRoiId === null
      ? undefined
      : window.candidates.find((candidate) => candidate.roiId === window.primaryRoiId);
    const target = primary ? { ...primary.bbox } : undefined;
    const click = target
      ? windowEvents.some((event) => event.kind === 'click'
        && event.button === 'primary'
        && event.phase === 'down'
        && pointInsideRoi(event.x, event.y, target))
      : false;
    const dwellMs = target
      ? windowEvents.reduce((duration, event) => event.kind === 'dwell'
        && pointInsideRoi(event.x, event.y, target)
        ? Math.max(duration, event.durationUs / 1_000)
        : duration, 0)
      : 0;
    const speechEmphasis = params.speechActivity.some((interval) => overlapsWindow(interval, startUs, endUs));
    const ink = inkEvidence(windowEvents);

    return {
      id: `attention-${String(window.startMs).padStart(10, '0')}-${window.sceneId}`,
      atMs: window.startMs,
      sceneId: window.sceneId,
      confidence: window.confidence,
      ...(target || ink ? { target: ink?.bbox ?? target } : {}),
      ...(click ? { click: true } : {}),
      ...(dwellMs > 0 ? { dwellMs } : {}),
      ...(speechEmphasis ? { speechEmphasis: true } : {}),
      ...(ink ? {
        sustainMs: window.endMs - window.startMs,
        ink: {
          active: true,
          safeFrame: ink.safeFrame,
          ...(ink.contentExpanded ? { contentExpanded: true } : {}),
        },
      } : {}),
    } satisfies TeachingCameraSignal;
  });
}

/** Builds the three local JSON artifacts without reading frames or mutating editor state. */
export function buildTeachingDirectorArtifacts(input: TeachingDirectorArtifactsInput): TeachingDirectorArtifactSetV1 {
  if (!validIdentity(input.sourceRecordingId)
    || !validIdentity(input.sessionId)
    || !Number.isSafeInteger(input.durationUs)
    || input.durationUs <= 0
    || input.durationUs % 1_000 !== 0) {
    throw new Error('teaching_director_identity_invalid');
  }
  const events = input.events.map((event) => parseUnifiedEvent(event));
  if (events.some((event) => event.sessionId !== input.sessionId)) {
    throw new Error('teaching_director_session_mismatch');
  }
  const durationMs = input.durationUs / 1_000;
  const attention = buildAttentionTimeline({
    sourceRecordingId: input.sourceRecordingId,
    durationMs,
    observations: input.roiObservations,
    ...(input.attentionWindowMs === undefined ? {} : { windowMs: input.attentionWindowMs }),
  });
  const signals = attentionTimelineToCameraSignals({
    timeline: attention,
    sessionId: input.sessionId,
    events,
    speechActivity: input.speechActivity,
  });
  const camera = buildTeachingCameraPlan({
    sourceRecordingId: input.sourceRecordingId,
    durationMs,
    profile: input.profile,
    signals,
  });
  const cleanup = planAutoCleanup({
    sessionId: input.sessionId,
    durationUs: input.durationUs,
    events,
    speechActivity: input.speechActivity,
  });

  return {
    schemaVersion: 1,
    artifactSetVersion: 'teaching-director-artifacts-v1',
    sourceRecordingId: input.sourceRecordingId,
    sessionId: input.sessionId,
    durationUs: input.durationUs,
    artifacts: {
      attention: {
        schemaVersion: 1,
        artifactVersion: 'attention-artifact-v1',
        fileName: 'attention.json',
        sourceRecordingId: input.sourceRecordingId,
        sessionId: input.sessionId,
        payload: attention,
      },
      camera: {
        schemaVersion: 1,
        artifactVersion: 'camera-artifact-v1',
        fileName: 'camera.json',
        sourceRecordingId: input.sourceRecordingId,
        sessionId: input.sessionId,
        payload: camera,
      },
      cleanup: {
        schemaVersion: 1,
        artifactVersion: 'cleanup-artifact-v1',
        fileName: 'cleanup.json',
        sourceRecordingId: input.sourceRecordingId,
        sessionId: input.sessionId,
        payload: cleanup,
      },
    },
  };
}
