import { parseUnifiedEvent, type UnifiedEvent } from './unifiedEventSchema';

export interface SpeechActivityInterval {
  startUs: number;
  endUs: number;
  confidence: number;
  semanticStatus?: 'recognized' | 'uncertain' | 'possible-mistake';
}

export interface CleanupSourceRange {
  startUs: number;
  endUs: number;
}

export type CleanupActionReason =
  | 'confirmed-undo'
  | 'confirmed-erase'
  | 'silent-dead-time'
  | 'stable-window-loading'
  | 'stable-window-roundtrip';

export interface CleanupActionV1 {
  id: string;
  kind: 'remove-events' | 'time-compress' | 'remove-range';
  sourceRanges: CleanupSourceRange[];
  reason: CleanupActionReason;
  confidence: number;
  reversible: true;
  playbackRate?: number;
}

export interface AutoCleanupPlanV1 {
  schemaVersion: 1;
  plannerVersion: 'conservative-cleanup-v1';
  sessionId: string;
  durationUs: number;
  actions: CleanupActionV1[];
}

export interface AutoCleanupInput {
  sessionId: string;
  durationUs: number;
  events: readonly UnifiedEvent[];
  speechActivity: readonly SpeechActivityInterval[];
  deadTimeThresholdUs?: number;
}

interface CandidateAction extends Omit<CleanupActionV1, 'id'> {
  sortOrder: number;
}

function validIdentity(input: AutoCleanupInput): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(input.sessionId)
    && Number.isSafeInteger(input.durationUs)
    && input.durationUs > 0;
}

function normalizeEvents(input: AutoCleanupInput): UnifiedEvent[] {
  const parsed = input.events.map((value) => parseUnifiedEvent(value));
  if (parsed.some((value) => value.sessionId !== input.sessionId)) {
    throw new Error('auto_cleanup_session_mismatch');
  }
  return parsed
    .filter((value) => value.atUs < input.durationUs)
    .sort((a, b) => a.atUs - b.atUs || a.kind.localeCompare(b.kind));
}

function pointRange(atUs: number, durationUs: number): CleanupSourceRange {
  return { startUs: atUs, endUs: Math.min(durationUs, atUs + 1) };
}

function normalizeSpeech(input: AutoCleanupInput): CleanupSourceRange[] {
  const intervals = input.speechActivity.map((item) => {
    if (!Number.isSafeInteger(item.startUs) || !Number.isSafeInteger(item.endUs)
      || item.startUs < 0 || item.endUs <= item.startUs || item.endUs > input.durationUs
      || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1
      || (item.semanticStatus !== undefined
        && !['recognized', 'uncertain', 'possible-mistake'].includes(item.semanticStatus))) {
      throw new Error('auto_cleanup_speech_invalid');
    }
    return { startUs: item.startUs, endUs: item.endUs };
  }).sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs);
  const merged: CleanupSourceRange[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.startUs <= previous.endUs) {
      previous.endUs = Math.max(previous.endUs, interval.endUs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function isContentChange(event: UnifiedEvent): boolean {
  return event.kind === 'ink'
    || event.kind === 'undo'
    || event.kind === 'mode-change'
    || event.kind === 'camera-control';
}

function mergeActivityRanges(ranges: CleanupSourceRange[]): CleanupSourceRange[] {
  const sorted = [...ranges].sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs);
  const merged: CleanupSourceRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.startUs <= previous.endUs) {
      previous.endUs = Math.max(previous.endUs, range.endUs);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function overlaps(left: CleanupSourceRange, right: CleanupSourceRange): boolean {
  return left.startUs < right.endUs && right.startUs < left.endUs;
}

function activeWindowStateEqual(
  left: Extract<UnifiedEvent, { kind: 'active-window' }>,
  right: Extract<UnifiedEvent, { kind: 'active-window' }>,
): boolean {
  return left.windowId === right.windowId
    && left.application === right.application
    && (left.title ?? '') === (right.title ?? '');
}

function windowBoundsEqual(
  left: Extract<UnifiedEvent, { kind: 'window-bounds' }>,
  right: Extract<UnifiedEvent, { kind: 'window-bounds' }>,
): boolean {
  return left.windowId === right.windowId
    && left.x === right.x && left.y === right.y
    && left.width === right.width && left.height === right.height;
}

function looksLikeLoading(title: string | undefined): boolean {
  return /(?:loading|please wait|加载|正在载入|请稍候)/i.test(title ?? '');
}

export function planAutoCleanup(input: AutoCleanupInput): AutoCleanupPlanV1 {
  if (!validIdentity(input)) throw new Error('auto_cleanup_identity_invalid');
  const candidates: CandidateAction[] = [];
  const events = normalizeEvents(input);
  const speech = normalizeSpeech(input);
  for (const item of events) {
    if (item.kind === 'undo') {
      candidates.push({
        kind: 'remove-events',
        sourceRanges: [pointRange(item.atUs, input.durationUs)],
        reason: 'confirmed-undo',
        confidence: 1,
        reversible: true,
        sortOrder: 0,
      });
    } else if (item.kind === 'ink' && item.operation === 'erase') {
      candidates.push({
        kind: 'remove-events',
        sourceRanges: [pointRange(item.atUs, input.durationUs)],
        reason: 'confirmed-erase',
        confidence: 1,
        reversible: true,
        sortOrder: 1,
      });
    }
  }
  const rangeIsSilentAndContentStable = (range: CleanupSourceRange) => (
    !speech.some((item) => overlaps(item, range))
    && !events.some((item) => isContentChange(item)
      && item.atUs >= range.startUs && item.atUs <= range.endUs)
  );
  const activeWindows = events.filter(
    (item): item is Extract<UnifiedEvent, { kind: 'active-window' }> => item.kind === 'active-window',
  );
  for (let index = 1; index + 1 < activeWindows.length; index += 1) {
    const before = activeWindows[index - 1];
    const transient = activeWindows[index];
    const after = activeWindows[index + 1];
    const range = { startUs: transient.atUs, endUs: after.atUs };
    if (!activeWindowStateEqual(before, after)
      || activeWindowStateEqual(before, transient)
      || !looksLikeLoading(transient.title)
      || !rangeIsSilentAndContentStable(range)) continue;
    candidates.push({
      kind: 'remove-range',
      sourceRanges: [range],
      reason: 'stable-window-loading',
      confidence: 0.97,
      reversible: true,
      sortOrder: 2,
    });
  }
  const bounds = events.filter(
    (item): item is Extract<UnifiedEvent, { kind: 'window-bounds' }> => item.kind === 'window-bounds',
  );
  for (let index = 1; index + 1 < bounds.length; index += 1) {
    const before = bounds[index - 1];
    const transient = bounds[index];
    const after = bounds[index + 1];
    const range = { startUs: transient.atUs, endUs: after.atUs };
    if (!windowBoundsEqual(before, after)
      || windowBoundsEqual(before, transient)
      || !rangeIsSilentAndContentStable(range)) continue;
    candidates.push({
      kind: 'remove-range',
      sourceRanges: [range],
      reason: 'stable-window-roundtrip',
      confidence: 0.96,
      reversible: true,
      sortOrder: 3,
    });
  }
  const deadTimeThresholdUs = input.deadTimeThresholdUs ?? 2_000_000;
  if (!Number.isSafeInteger(deadTimeThresholdUs) || deadTimeThresholdUs < 1_000_000) {
    throw new Error('auto_cleanup_dead_time_threshold_invalid');
  }
  const activity = mergeActivityRanges([
    ...speech,
    ...events.filter(isContentChange).map((item) => ({ startUs: item.atUs, endUs: item.atUs })),
  ]);
  const safetyHandleUs = 500_000;
  for (let index = 1; index < activity.length; index += 1) {
    const previous = activity[index - 1];
    const next = activity[index];
    if (next.startUs - previous.endUs < deadTimeThresholdUs) continue;
    const range = {
      startUs: previous.endUs + safetyHandleUs,
      endUs: next.startUs - safetyHandleUs,
    };
    if (range.endUs <= range.startUs) continue;
    candidates.push({
      kind: 'time-compress',
      sourceRanges: [range],
      reason: 'silent-dead-time',
      confidence: 0.98,
      reversible: true,
      playbackRate: 4,
      sortOrder: 4,
    });
  }
  const specificRemovalRanges = candidates
    .filter((candidate) => candidate.kind === 'remove-range')
    .flatMap((candidate) => candidate.sourceRanges);
  const actions = candidates
    .filter((candidate) => candidate.kind !== 'time-compress'
      || !candidate.sourceRanges.some((range) => specificRemovalRanges.some((item) => overlaps(range, item))))
    .sort((a, b) => a.sourceRanges[0].startUs - b.sourceRanges[0].startUs || a.sortOrder - b.sortOrder)
    .map(({ sortOrder: _sortOrder, ...action }, index) => ({
      ...action,
      id: `cleanup-${String(index).padStart(4, '0')}`,
    }));
  return {
    schemaVersion: 1,
    plannerVersion: 'conservative-cleanup-v1',
    sessionId: input.sessionId,
    durationUs: input.durationUs,
    actions,
  };
}
