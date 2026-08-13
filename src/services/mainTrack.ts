import type { MainTrackClip } from '@/types/recording';

export interface RecordingClipInput {
  recordingId: string;
  durationMs: number;
  title?: string;
}

function clipId(recordingId: string): string {
  return `clip-${recordingId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeMainTrack(clips: MainTrackClip[] | undefined): MainTrackClip[] {
  return (clips ?? [])
    .filter((clip) => (
      typeof clip.id === 'string'
      && typeof clip.recordingId === 'string'
      && Number.isFinite(clip.sourceStart)
      && Number.isFinite(clip.sourceEnd)
      && clip.sourceEnd - clip.sourceStart >= 1
    ))
    .map((clip) => ({
      ...clip,
      sourceStart: Math.max(0, Math.round(clip.sourceStart)),
      sourceEnd: Math.max(1, Math.round(clip.sourceEnd)),
    }));
}

export function createRecordingClip(input: RecordingClipInput): MainTrackClip {
  return {
    id: clipId(input.recordingId),
    recordingId: input.recordingId,
    sourceStart: 0,
    sourceEnd: Math.max(1, Math.round(input.durationMs)),
    title: input.title?.trim() || undefined,
  };
}

export function mainTrackDuration(clips: MainTrackClip[]): number {
  return normalizeMainTrack(clips).reduce((total, clip) => total + clip.sourceEnd - clip.sourceStart, 0);
}

export function appendRecordingClip(clips: MainTrackClip[], input: RecordingClipInput): MainTrackClip[] {
  return [...normalizeMainTrack(clips), createRecordingClip(input)];
}

export function resolveMainTrackPosition(clips: MainTrackClip[], outputTimeMs: number): {
  clipId: string;
  clipIndex: number;
  recordingId: string;
  sourceTimeMs: number;
  outputStartMs: number;
  outputEndMs: number;
} | null {
  const normalized = normalizeMainTrack(clips);
  if (normalized.length === 0) return null;
  const target = Math.max(0, Math.min(mainTrackDuration(normalized), outputTimeMs));
  let outputStartMs = 0;
  for (let clipIndex = 0; clipIndex < normalized.length; clipIndex += 1) {
    const clip = normalized[clipIndex];
    const duration = clip.sourceEnd - clip.sourceStart;
    const outputEndMs = outputStartMs + duration;
    if (target < outputEndMs || clipIndex === normalized.length - 1) {
      return {
        clipId: clip.id,
        clipIndex,
        recordingId: clip.recordingId,
        sourceTimeMs: Math.min(clip.sourceEnd, clip.sourceStart + Math.max(0, target - outputStartMs)),
        outputStartMs,
        outputEndMs,
      };
    }
    outputStartMs = outputEndMs;
  }
  return null;
}

export function insertRecordingClip(
  clips: MainTrackClip[],
  input: RecordingClipInput,
  outputTimeMs: number,
): MainTrackClip[] {
  const normalized = normalizeMainTrack(clips);
  const inserted = createRecordingClip(input);
  if (normalized.length === 0) return [inserted];
  const position = resolveMainTrackPosition(normalized, outputTimeMs);
  if (!position) return [...normalized, inserted];
  const current = normalized[position.clipIndex];
  if (position.sourceTimeMs <= current.sourceStart + 1) {
    return [...normalized.slice(0, position.clipIndex), inserted, ...normalized.slice(position.clipIndex)];
  }
  if (position.sourceTimeMs >= current.sourceEnd - 1) {
    return [...normalized.slice(0, position.clipIndex + 1), inserted, ...normalized.slice(position.clipIndex + 1)];
  }
  return [
    ...normalized.slice(0, position.clipIndex),
    { ...current, id: clipId(current.recordingId), sourceEnd: position.sourceTimeMs },
    inserted,
    { ...current, id: clipId(current.recordingId), sourceStart: position.sourceTimeMs },
    ...normalized.slice(position.clipIndex + 1),
  ];
}

export function moveMainTrackClip(clips: MainTrackClip[], fromIndex: number, toIndex: number): MainTrackClip[] {
  const next = normalizeMainTrack(clips);
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= next.length || toIndex >= next.length) return next;
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function splitMainTrackClip(clips: MainTrackClip[], outputTimeMs: number, minimumMs = 200): MainTrackClip[] {
  const normalized = normalizeMainTrack(clips);
  const position = resolveMainTrackPosition(normalized, outputTimeMs);
  if (!position) return normalized;
  const clip = normalized[position.clipIndex];
  if (position.sourceTimeMs <= clip.sourceStart + minimumMs || position.sourceTimeMs >= clip.sourceEnd - minimumMs) return normalized;
  return [
    ...normalized.slice(0, position.clipIndex),
    { ...clip, id: clipId(clip.recordingId), sourceEnd: position.sourceTimeMs },
    { ...clip, id: clipId(clip.recordingId), sourceStart: position.sourceTimeMs },
    ...normalized.slice(position.clipIndex + 1),
  ];
}

export function removeMainTrackClip(clips: MainTrackClip[], index: number): MainTrackClip[] {
  const normalized = normalizeMainTrack(clips);
  if (normalized.length <= 1 || index < 0 || index >= normalized.length) return normalized;
  return normalized.filter((_, candidate) => candidate !== index);
}

export function trimMainTrackClip(
  clips: MainTrackClip[],
  index: number,
  side: 'start' | 'end',
  sourceTimeMs: number,
  minimumMs = 200,
): MainTrackClip[] {
  const next = normalizeMainTrack(clips);
  const clip = next[index];
  if (!clip) return next;
  if (side === 'start') clip.sourceStart = Math.max(0, Math.min(sourceTimeMs, clip.sourceEnd - minimumMs));
  else clip.sourceEnd = Math.max(clip.sourceStart + minimumMs, sourceTimeMs);
  return next;
}

export function mapProjectRangeToClip<T extends { start: number; end: number }>(
  item: T,
  clip: MainTrackClip,
  outputStartMs: number,
): T | null {
  const outputEndMs = outputStartMs + clip.sourceEnd - clip.sourceStart;
  const overlapStart = Math.max(item.start, outputStartMs);
  const overlapEnd = Math.min(item.end, outputEndMs);
  if (overlapEnd <= overlapStart) return null;
  return {
    ...item,
    start: clip.sourceStart + overlapStart - outputStartMs,
    end: clip.sourceStart + overlapEnd - outputStartMs,
  };
}
