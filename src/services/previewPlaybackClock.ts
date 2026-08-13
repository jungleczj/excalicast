export interface PreviewPlaybackClockInput {
  expectedSourceTimeMs: number;
  audioCurrentTimeSeconds: number;
  audioReady: boolean;
  audioPaused: boolean;
  maxDriftMs?: number;
}

export interface PreviewPlaybackClockResult {
  sourceTimeMs: number;
  seekAudio: boolean;
}

/** Keep picture on the media clock; only hard-seek when a trim jump creates real drift. */
export function resolvePreviewPlaybackClock(input: PreviewPlaybackClockInput): PreviewPlaybackClockResult {
  const audioTimeMs = input.audioCurrentTimeSeconds * 1_000;
  if (!input.audioReady || input.audioPaused || !Number.isFinite(audioTimeMs)) {
    return { sourceTimeMs: input.expectedSourceTimeMs, seekAudio: false };
  }
  const maxDriftMs = Math.max(50, input.maxDriftMs ?? 250);
  if (Math.abs(audioTimeMs - input.expectedSourceTimeMs) > maxDriftMs) {
    return { sourceTimeMs: input.expectedSourceTimeMs, seekAudio: true };
  }
  return { sourceTimeMs: Math.max(0, audioTimeMs), seekAudio: false };
}
