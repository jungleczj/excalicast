export type TeachingCameraMode = 'FULL_CONTEXT' | 'FOCUS' | 'FOLLOW' | 'REVEAL' | 'HOLD';
export type CameraPlannerProfile = 'Calm' | 'Balanced' | 'Dynamic';

export interface CameraPlannerProfileParameters {
  minimumShotDurationMs: number;
  cooldownMs: number;
  hysteresis: number;
  sustainMs: number;
  maxZoom: number;
  confidenceFloor: number;
}

export const CAMERA_PLANNER_PROFILES: Readonly<Record<CameraPlannerProfile, Readonly<CameraPlannerProfileParameters>>> = Object.freeze({
  Calm: Object.freeze({
    minimumShotDurationMs: 2_600,
    cooldownMs: 1_800,
    hysteresis: 0.12,
    sustainMs: 700,
    maxZoom: 1.45,
    confidenceFloor: 0.72,
  }),
  Balanced: Object.freeze({
    minimumShotDurationMs: 1_800,
    cooldownMs: 1_200,
    hysteresis: 0.09,
    sustainMs: 500,
    maxZoom: 1.7,
    confidenceFloor: 0.66,
  }),
  Dynamic: Object.freeze({
    minimumShotDurationMs: 1_200,
    cooldownMs: 800,
    hysteresis: 0.06,
    sustainMs: 320,
    maxZoom: 2,
    confidenceFloor: 0.58,
  }),
});

export interface CameraFocusRegion {
  /** Normalized canvas coordinates in the inclusive 0–1 range. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TeachingCameraSignal {
  id: string;
  atMs: number;
  sceneId: string;
  confidence: number;
  target?: CameraFocusRegion;
  click?: boolean;
  dwellMs?: number;
  speechEmphasis?: boolean;
  sustainMs?: number;
  ink?: {
    active: boolean;
    safeFrame: boolean;
    contentExpanded?: boolean;
  };
}

export interface CameraPlannerInput {
  sourceRecordingId: string;
  durationMs: number;
  profile: CameraPlannerProfile;
  signals: TeachingCameraSignal[];
}

export type TeachingCameraReason =
  | 'initial-context'
  | 'new-scene'
  | 'low-confidence'
  | 'click-dwell-speech'
  | 'ink-safe-frame'
  | 'ink-follow'
  | 'content-expanded';

export interface TeachingCameraShotV1 {
  id: string;
  mode: TeachingCameraMode;
  reason: TeachingCameraReason;
  startMs: number;
  endMs: number;
  zoom: number;
  target?: CameraFocusRegion;
}

export interface TeachingCameraPlanV1 {
  schemaVersion: 1;
  plannerVersion: 'teaching-camera-v1';
  sourceRecordingId: string;
  profile: CameraPlannerProfile;
  durationMs: number;
  shots: TeachingCameraShotV1[];
}

interface CameraCandidate {
  mode: TeachingCameraMode;
  reason: TeachingCameraReason;
  zoom: number;
  target?: CameraFocusRegion;
}

function validRegion(region: CameraFocusRegion | undefined): region is CameraFocusRegion {
  return Boolean(region)
    && Number.isFinite(region?.x)
    && Number.isFinite(region?.y)
    && Number.isFinite(region?.width)
    && Number.isFinite(region?.height)
    && region!.x >= 0
    && region!.y >= 0
    && region!.width > 0
    && region!.height > 0
    && region!.x + region!.width <= 1
    && region!.y + region!.height <= 1;
}

function copyRegion(region: CameraFocusRegion | undefined): CameraFocusRegion | undefined {
  return validRegion(region) ? { ...region } : undefined;
}

function centerDistance(previous: CameraFocusRegion | undefined, next: CameraFocusRegion | undefined): number {
  if (!validRegion(previous) || !validRegion(next)) return 0;
  const previousX = previous.x + previous.width / 2;
  const previousY = previous.y + previous.height / 2;
  const nextX = next.x + next.width / 2;
  const nextY = next.y + next.height / 2;
  return Math.hypot(nextX - previousX, nextY - previousY);
}

function focusZoom(target: CameraFocusRegion | undefined, maxZoom: number): number {
  if (!validRegion(target)) return maxZoom;
  const regionScale = 1 / Math.sqrt(Math.max(0.08, target.width * target.height));
  return Math.min(maxZoom, Math.max(1, Number(regionScale.toFixed(3))));
}

function normalizeSignals(signals: TeachingCameraSignal[], durationMs: number): TeachingCameraSignal[] {
  return signals
    .filter((signal) => (
      typeof signal.id === 'string'
      && signal.id.length > 0
      && typeof signal.sceneId === 'string'
      && signal.sceneId.length > 0
      && Number.isFinite(signal.atMs)
      && signal.atMs >= 0
      && signal.atMs < durationMs
      && Number.isFinite(signal.confidence)
      && signal.confidence >= 0
      && signal.confidence <= 1
    ))
    .map((signal) => ({ ...signal, target: copyRegion(signal.target), ink: signal.ink ? { ...signal.ink } : undefined }))
    .sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
}

function candidateForSignal(params: {
  signal: TeachingCameraSignal;
  previousSceneId: string;
  previousTarget: CameraFocusRegion | undefined;
  profile: Readonly<CameraPlannerProfileParameters>;
}): CameraCandidate | null {
  const { signal, previousSceneId, previousTarget, profile } = params;

  if (signal.confidence < profile.confidenceFloor) {
    return { mode: 'FULL_CONTEXT', reason: 'low-confidence', zoom: 1 };
  }
  if (signal.sceneId !== previousSceneId) {
    return { mode: 'FULL_CONTEXT', reason: 'new-scene', zoom: 1 };
  }
  if (signal.ink?.contentExpanded) {
    return { mode: 'REVEAL', reason: 'content-expanded', zoom: 1 };
  }
  if (signal.ink?.active && signal.ink.safeFrame) {
    const sustainedMovement = centerDistance(previousTarget, signal.target) >= profile.hysteresis
      && (signal.sustainMs ?? 0) >= profile.sustainMs;
    if (sustainedMovement) {
      return {
        mode: 'FOLLOW',
        reason: 'ink-follow',
        zoom: Math.min(profile.maxZoom, 1.25),
        target: copyRegion(signal.target),
      };
    }
    return {
      mode: 'HOLD',
      reason: 'ink-safe-frame',
      zoom: Math.min(profile.maxZoom, 1.15),
      target: copyRegion(signal.target ?? previousTarget),
    };
  }
  if (
    signal.click === true
    && signal.speechEmphasis === true
    && (signal.dwellMs ?? 0) >= profile.sustainMs
  ) {
    return {
      mode: 'FOCUS',
      reason: 'click-dwell-speech',
      zoom: focusZoom(signal.target, profile.maxZoom),
      target: copyRegion(signal.target),
    };
  }
  return null;
}

/**
 * Produces a deterministic camera intent track from normalized teaching telemetry.
 * It is deliberately media-agnostic: consumers may preview or render the plan,
 * but this module never mutates a timeline or invokes a native capture surface.
 */
export function buildTeachingCameraPlan(input: CameraPlannerInput): TeachingCameraPlanV1 {
  if (!input.sourceRecordingId || !Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    throw new Error('camera_plan_identity_invalid');
  }
  const profile = CAMERA_PLANNER_PROFILES[input.profile];
  if (!profile) throw new Error('camera_plan_profile_invalid');

  const signals = normalizeSignals(input.signals, input.durationMs);
  const shots: TeachingCameraShotV1[] = [{
    id: 'camera-shot-001',
    mode: 'FULL_CONTEXT',
    reason: 'initial-context',
    startMs: 0,
    endMs: input.durationMs,
    zoom: 1,
  }];
  let previousSceneId = signals[0]?.sceneId ?? 'initial';
  let previousTarget = copyRegion(signals[0]?.target);
  let lastTransitionAt = 0;

  for (const signal of signals) {
    if (signal.atMs === 0) {
      previousSceneId = signal.sceneId;
      previousTarget = copyRegion(signal.target) ?? previousTarget;
      continue;
    }

    const candidate = candidateForSignal({ signal, previousSceneId, previousTarget, profile });
    previousTarget = copyRegion(signal.target) ?? previousTarget;
    if (!candidate) continue;
    if (candidate.mode === shots.at(-1)?.mode) {
      // A scene observed while already at FULL_CONTEXT needs no visual cut,
      // but it does become the new context authority for later signals.
      if (candidate.reason === 'new-scene') previousSceneId = signal.sceneId;
      continue;
    }

    const currentShot = shots.at(-1)!;
    const currentDuration = signal.atMs - currentShot.startMs;
    const sinceTransition = signal.atMs - lastTransitionAt;
    if (currentDuration < profile.minimumShotDurationMs || sinceTransition < profile.cooldownMs) continue;

    currentShot.endMs = signal.atMs;
    shots.push({
      id: `camera-shot-${String(shots.length + 1).padStart(3, '0')}`,
      mode: candidate.mode,
      reason: candidate.reason,
      startMs: signal.atMs,
      endMs: input.durationMs,
      zoom: candidate.zoom,
      ...(candidate.target ? { target: candidate.target } : {}),
    });
    previousSceneId = signal.sceneId;
    lastTransitionAt = signal.atMs;
  }

  return {
    schemaVersion: 1,
    plannerVersion: 'teaching-camera-v1',
    sourceRecordingId: input.sourceRecordingId,
    profile: input.profile,
    durationMs: input.durationMs,
    shots,
  };
}
