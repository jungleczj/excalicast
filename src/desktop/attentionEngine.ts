export interface NormalizedRoi {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AttentionFeatureVector {
  inkActivity: number;
  speechReference: number;
  clickDwell: number;
  objectSalience: number;
  windowFocus: number;
  recency: number;
  motionNoise: number;
  uiControlPenalty: number;
}

export interface AttentionObservation {
  id: string;
  sceneId: string;
  roiId: string;
  atMs: number;
  bbox: NormalizedRoi;
  features: AttentionFeatureVector;
}

export const ATTENTION_WEIGHTS_V1: Readonly<Record<keyof AttentionFeatureVector, number>> = Object.freeze({
  inkActivity: 0.28,
  speechReference: 0.26,
  clickDwell: 0.18,
  objectSalience: 0.1,
  windowFocus: 0.08,
  recency: 0.06,
  motionNoise: -0.12,
  uiControlPenalty: -0.18,
});

export interface AttentionCandidateV1 {
  roiId: string;
  bbox: NormalizedRoi;
  score: number;
  evidenceIds: string[];
}

export interface AttentionWindowV1 {
  sceneId: string;
  startMs: number;
  endMs: number;
  primaryRoiId: string | null;
  confidence: number;
  candidates: AttentionCandidateV1[];
}

export interface AttentionTimelineV1 {
  schemaVersion: 1;
  engineVersion: 'attention-v1';
  sourceRecordingId: string;
  durationMs: number;
  windowMs: number;
  windows: AttentionWindowV1[];
}

const PRIMARY_SCORE_FLOOR = 0.5;
const PRIMARY_MARGIN = 0.08;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validBox(value: NormalizedRoi): boolean {
  return [value.x, value.y, value.width, value.height].every(Number.isFinite)
    && value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0
    && value.x + value.width <= 1 && value.y + value.height <= 1;
}

function validFeatures(value: AttentionFeatureVector): boolean {
  return (Object.keys(ATTENTION_WEIGHTS_V1) as (keyof AttentionFeatureVector)[])
    .every((key) => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1);
}

function score(features: AttentionFeatureVector): number {
  const weighted = (Object.keys(ATTENTION_WEIGHTS_V1) as (keyof AttentionFeatureVector)[])
    .reduce((sum, key) => sum + features[key] * ATTENTION_WEIGHTS_V1[key], 0);
  return Number(clamp01(weighted).toFixed(4));
}

function normalizeObservations(observations: AttentionObservation[], durationMs: number): AttentionObservation[] {
  return observations
    .filter((item) => item && typeof item.id === 'string' && item.id.length > 0
      && typeof item.sceneId === 'string' && item.sceneId.length > 0
      && typeof item.roiId === 'string' && item.roiId.length > 0
      && Number.isFinite(item.atMs) && item.atMs >= 0 && item.atMs < durationMs
      && validBox(item.bbox) && validFeatures(item.features))
    .map((item) => ({
      ...item,
      bbox: { ...item.bbox },
      features: { ...item.features },
    }))
    .sort((a, b) => a.atMs - b.atMs
      || a.sceneId.localeCompare(b.sceneId)
      || a.roiId.localeCompare(b.roiId)
      || a.id.localeCompare(b.id));
}

/**
 * Builds the deterministic data plane consumed by the camera planner. It does
 * not inspect video frames and deliberately returns no primary ROI when the
 * evidence is weak or ambiguous, preserving full context by default.
 */
export function buildAttentionTimeline(input: {
  sourceRecordingId: string;
  durationMs: number;
  observations: AttentionObservation[];
  windowMs?: number;
}): AttentionTimelineV1 {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.sourceRecordingId)
    || !Number.isSafeInteger(input.durationMs) || input.durationMs <= 0) {
    throw new Error('attention_timeline_identity_invalid');
  }
  const windowMs = input.windowMs ?? 1_000;
  if (!Number.isSafeInteger(windowMs) || windowMs < 250 || windowMs > 10_000) {
    throw new Error('attention_timeline_window_invalid');
  }

  const groups = new Map<string, AttentionObservation[]>();
  for (const item of normalizeObservations(input.observations, input.durationMs)) {
    const startMs = Math.floor(item.atMs / windowMs) * windowMs;
    const key = `${String(startMs).padStart(16, '0')}:${item.sceneId}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const windows: AttentionWindowV1[] = [];
  for (const observations of groups.values()) {
    const startMs = Math.floor(observations[0].atMs / windowMs) * windowMs;
    const candidatesByRoi = new Map<string, AttentionObservation[]>();
    for (const item of observations) {
      const values = candidatesByRoi.get(item.roiId) ?? [];
      values.push(item);
      candidatesByRoi.set(item.roiId, values);
    }
    const candidates = [...candidatesByRoi.entries()].map(([roiId, values]) => {
      const best = [...values].sort((a, b) => score(b.features) - score(a.features) || a.id.localeCompare(b.id))[0];
      return {
        roiId,
        bbox: { ...best.bbox },
        score: score(best.features),
        evidenceIds: values.map((value) => value.id).sort(),
      } satisfies AttentionCandidateV1;
    }).sort((a, b) => b.score - a.score || a.roiId.localeCompare(b.roiId));

    const best = candidates[0];
    const runnerUp = candidates[1];
    const confident = Boolean(best)
      && best.score >= PRIMARY_SCORE_FLOOR
      && (!runnerUp || best.score - runnerUp.score >= PRIMARY_MARGIN);
    windows.push({
      sceneId: observations[0].sceneId,
      startMs,
      endMs: Math.min(input.durationMs, startMs + windowMs),
      primaryRoiId: confident ? best.roiId : null,
      confidence: confident ? Number(best.score.toFixed(4)) : 0,
      candidates,
    });
  }

  return {
    schemaVersion: 1,
    engineVersion: 'attention-v1',
    sourceRecordingId: input.sourceRecordingId,
    durationMs: input.durationMs,
    windowMs,
    windows,
  };
}
