export interface Mp4MappedTimestamp {
  presentationTimestampUs: number;
  decodeTimestampUs: number;
  compositionTimeOffsetUs: number;
}

export interface NormalizedCaptureFrameTiming {
  timestampUs: number;
  durationUs: number;
}

function finiteTimestamp(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

/**
 * Converts capture-device timestamps into a zero-based MP4 timeline and fills
 * in the duration omitted by MediaStreamTrackProcessor in Chromium.
 */
export class CaptureFrameTimestampNormalizer {
  private readonly frameDurationUs: number;
  private firstTimestampUs: number | null = null;
  private lastTimestampUs: number | null = null;

  constructor(fps: number) {
    this.frameDurationUs = Math.max(1, Math.round(1_000_000 / Math.max(1, fps)));
  }

  push(rawTimestampUs: number, rawDurationUs: number | null | undefined): NormalizedCaptureFrameTiming {
    const rawTimestamp = finiteTimestamp(rawTimestampUs);
    if (this.firstTimestampUs === null) this.firstTimestampUs = rawTimestamp;

    const rebasedTimestamp = Math.max(0, rawTimestamp - this.firstTimestampUs);
    const timestampUs = this.lastTimestampUs === null
      ? rebasedTimestamp
      : Math.max(rebasedTimestamp, this.lastTimestampUs + this.frameDurationUs);
    const providedDuration = rawDurationUs == null ? 0 : finiteTimestamp(rawDurationUs);
    const durationUs = providedDuration > 0 ? providedDuration : this.frameDurationUs;
    this.lastTimestampUs = timestampUs;

    return { timestampUs, durationUs };
  }
}

/**
 * Rebases timestamp epochs emitted by concatenated MediaRecorder chunks.
 * Every returned timestamp is strictly greater than the previous value.
 */
export class MonotonicTimestampNormalizer {
  private offsetUs = 0;
  private lastTimestampUs: number | null = null;

  constructor(private readonly nominalStepUs = 1) {}

  push(rawTimestampUs: number): number {
    const raw = finiteTimestamp(rawTimestampUs);
    const step = Math.max(1, finiteTimestamp(this.nominalStepUs));
    let timestamp = raw + this.offsetUs;
    if (this.lastTimestampUs !== null && timestamp <= this.lastTimestampUs) {
      this.offsetUs += this.lastTimestampUs + step - timestamp;
      timestamp = raw + this.offsetUs;
    }
    this.lastTimestampUs = timestamp;
    return timestamp;
  }
}

/**
 * VideoEncoder may emit H.264 chunks in decode order while chunk.timestamp is
 * the presentation timestamp. mp4-muxer needs both values to preserve B-frame
 * reordering without treating a lower PTS as a regressing DTS.
 */
export function createMp4TimestampMapper(fps: number): (presentationTimestampUs: number) => Mp4MappedTimestamp {
  const frameDurationUs = Math.max(1, Math.round(1_000_000 / Math.max(1, fps)));
  let outputIndex = 0;
  return (presentationTimestampUs: number) => {
    const presentation = finiteTimestamp(presentationTimestampUs);
    const decode = outputIndex * frameDurationUs;
    outputIndex += 1;
    return {
      presentationTimestampUs: presentation,
      decodeTimestampUs: decode,
      compositionTimeOffsetUs: presentation - decode,
    };
  };
}
