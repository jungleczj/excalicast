import type { LocalizedTimingSegment } from '@/types/recording';
import type { TimeSegment } from '@/types/recording';

export type LocalizedTimingStrategy = LocalizedTimingSegment['strategy'];

export interface LocalizedTimingInput {
  sourceStartMs: number;
  sourceEndMs: number;
  audioDurationMs: number;
  speechRatePercent: number;
}

const MIN_SPEECH_RATE_PERCENT = -10;
const MAX_SPEECH_RATE_PERCENT = 15;
const NATURAL_PAUSE_MS = 150;
const DURATION_TOLERANCE = 0.03;

export function edgeTtsCacheFingerprintMaterial(text: string, targetDurationMs: number): string {
  return `edge-tts-v3\0${Math.max(0, Math.round(targetDurationMs))}\0${text}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function parseSpeechRatePercent(value: string | number): number {
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value.replace('%', ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatSpeechRatePercent(value: number): string {
  const rounded = Math.round(clamp(value, MIN_SPEECH_RATE_PERCENT, MAX_SPEECH_RATE_PERCENT));
  return rounded >= 0 ? `+${rounded}%` : `${rounded}%`;
}

export function resolveAdaptiveSpeechRatePercent(input: {
  currentRatePercent: number;
  actualDurationMs: number;
  targetDurationMs: number;
}): number {
  const current = clamp(input.currentRatePercent, MIN_SPEECH_RATE_PERCENT, MAX_SPEECH_RATE_PERCENT);
  const target = Math.max(1, input.targetDurationMs);
  const actual = Math.max(1, input.actualDurationMs);
  if (Math.abs(actual - target) / target <= DURATION_TOLERANCE) return Math.round(current);
  const currentFactor = 1 + current / 100;
  const requiredFactor = currentFactor * actual / target;
  return Math.round(clamp((requiredFactor - 1) * 100, MIN_SPEECH_RATE_PERCENT, MAX_SPEECH_RATE_PERCENT));
}

export function buildLocalizedTimingMap(
  values: LocalizedTimingInput[],
  options: { retainedPauseMs?: number } = {},
): LocalizedTimingSegment[] {
  const retainedPauseMs = Math.max(0, options.retainedPauseMs ?? NATURAL_PAUSE_MS);
  const sorted = [...values]
    .filter((value) => value.sourceEndMs > value.sourceStartMs && value.audioDurationMs > 0)
    .sort((a, b) => a.sourceStartMs - b.sourceStartMs);
  let outputCursorMs = 0;
  let previousOriginalEndMs = 0;
  return sorted.map((value, index) => {
    const sourceDurationMs = value.sourceEndMs - value.sourceStartMs;
    const sourceGapMs = index === 0 ? value.sourceStartMs : value.sourceStartMs - previousOriginalEndMs;
    outputCursorMs += Math.min(retainedPauseMs, Math.max(0, sourceGapMs));
    const outputStartMs = outputCursorMs;
    const isShorter = value.audioDurationMs + retainedPauseMs < sourceDurationMs;
    const isLonger = value.audioDurationMs > sourceDurationMs;
    const visibleSourceDurationMs = isShorter
      ? Math.min(sourceDurationMs, value.audioDurationMs + retainedPauseMs)
      : sourceDurationMs;
    const outputDurationMs = isLonger
      ? value.audioDurationMs
      : visibleSourceDurationMs;
    const sourceEndMs = value.sourceStartMs + visibleSourceDurationMs;
    const outputEndMs = outputStartMs + outputDurationMs;
    const segment: LocalizedTimingSegment = {
      sourceStartMs: value.sourceStartMs,
      sourceEndMs,
      outputStartMs,
      outputEndMs,
      audioStartMs: outputStartMs,
      audioEndMs: outputStartMs + value.audioDurationMs,
      speechRatePercent: Math.round(value.speechRatePercent),
      videoRate: visibleSourceDurationMs / Math.max(1, outputDurationMs),
      strategy: isShorter ? 'trim_silence' : isLonger ? 'slow_video' : 'natural',
    };
    previousOriginalEndMs = value.sourceEndMs;
    outputCursorMs = outputEndMs;
    return segment;
  });
}

export function localizedTimelineDuration(map: LocalizedTimingSegment[]): number {
  return map.length > 0 ? map[map.length - 1].outputEndMs : 0;
}

export function localizedToSourceTime(map: LocalizedTimingSegment[], outputTimeMs: number): number {
  if (map.length === 0) return Math.max(0, outputTimeMs);
  const time = Math.max(0, outputTimeMs);
  for (let index = 0; index < map.length; index += 1) {
    const segment = map[index];
    if (time < segment.outputStartMs) return segment.sourceStartMs;
    if (time <= segment.outputEndMs) {
      const ratio = (time - segment.outputStartMs) / Math.max(1, segment.outputEndMs - segment.outputStartMs);
      return segment.sourceStartMs + ratio * (segment.sourceEndMs - segment.sourceStartMs);
    }
  }
  return map[map.length - 1].sourceEndMs;
}

export function sourceToLocalizedTime(map: LocalizedTimingSegment[], sourceTimeMs: number): number {
  if (map.length === 0) return Math.max(0, sourceTimeMs);
  const time = Math.max(0, sourceTimeMs);
  for (let index = 0; index < map.length; index += 1) {
    const segment = map[index];
    if (time < segment.sourceStartMs) return index === 0 ? segment.outputStartMs : map[index - 1].outputEndMs;
    if (time <= segment.sourceEndMs) {
      const ratio = (time - segment.sourceStartMs) / Math.max(1, segment.sourceEndMs - segment.sourceStartMs);
      return segment.outputStartMs + ratio * (segment.outputEndMs - segment.outputStartMs);
    }
  }
  return map[map.length - 1].outputEndMs;
}

export function mapSourceSegmentsToLocalized(
  segments: TimeSegment[],
  map: LocalizedTimingSegment[],
): TimeSegment[] {
  if (map.length === 0) return segments;
  return segments.flatMap((segment) => {
    const start = sourceToLocalizedTime(map, segment.start);
    const end = sourceToLocalizedTime(map, segment.end);
    return end > start ? [{ start, end }] : [];
  });
}

function parseSrtTimestamp(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  return Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1000 + Number(match[4]);
}

function formatSrtTimestamp(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  const hours = Math.floor(rounded / 3_600_000);
  const minutes = Math.floor((rounded % 3_600_000) / 60_000);
  const seconds = Math.floor((rounded % 60_000) / 1000);
  const milliseconds = rounded % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

export function mapSrtToLocalizedTimeline(srt: string, map: LocalizedTimingSegment[]): string {
  if (map.length === 0) return srt;
  return srt.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*)(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})(.*)$/);
    if (!match) return line;
    const start = parseSrtTimestamp(match[2]);
    const end = parseSrtTimestamp(match[3]);
    if (start === null || end === null) return line;
    const mappedStart = sourceToLocalizedTime(map, start);
    const mappedEnd = Math.max(mappedStart + 1, sourceToLocalizedTime(map, end));
    return `${match[1]}${formatSrtTimestamp(mappedStart)} --> ${formatSrtTimestamp(mappedEnd)}${match[4]}`;
  }).join('\n');
}
