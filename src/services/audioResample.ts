'use client';

/** Bounded, stateful cubic resampling for legacy/derived audio. Two source frames are
 * retained so a processing chunk boundary cannot become an audible seam. */
export class StreamingCubicResampler {
  private buffer = new Float32Array();
  private bufferStart = 0;
  private inputFrames = 0;
  private outputFrames = 0;
  private finalized = false;

  constructor(
    private readonly sourceSampleRate: number,
    private readonly targetSampleRate: number,
  ) {
    if (sourceSampleRate <= 0 || targetSampleRate <= 0) throw new Error('invalid_audio_sample_rate');
  }

  push(input: Float32Array): Float32Array {
    if (this.finalized) throw new Error('audio_resampler_finalized');
    if (input.length === 0) return new Float32Array();
    const next = new Float32Array(this.buffer.length + input.length);
    next.set(this.buffer);
    next.set(input, this.buffer.length);
    this.buffer = next;
    this.inputFrames += input.length;
    return this.produce(false);
  }

  flush(): Float32Array {
    if (this.finalized) return new Float32Array();
    this.finalized = true;
    return this.produce(true);
  }

  private sampleAt(index: number): number {
    const clamped = Math.max(0, Math.min(this.inputFrames - 1, index));
    const local = clamped - this.bufferStart;
    return this.buffer[Math.max(0, Math.min(this.buffer.length - 1, local))] ?? 0;
  }

  private produce(final: boolean): Float32Array {
    const limit = final
      ? Math.round(this.inputFrames * this.targetSampleRate / this.sourceSampleRate)
      : Math.max(this.outputFrames, Math.ceil(
          Math.max(0, this.inputFrames - 2) * this.targetSampleRate / this.sourceSampleRate,
        ));
    const output = new Float32Array(Math.max(0, limit - this.outputFrames));
    const firstOutputFrame = this.outputFrames;
    for (let offset = 0; offset < output.length; offset += 1) {
      const sourcePosition = (firstOutputFrame + offset) * this.sourceSampleRate / this.targetSampleRate;
      const base = Math.floor(sourcePosition);
      const fraction = sourcePosition - base;
      const p0 = this.sampleAt(base - 1);
      const p1 = this.sampleAt(base);
      const p2 = this.sampleAt(base + 1);
      const p3 = this.sampleAt(base + 2);
      const f2 = fraction * fraction;
      const f3 = f2 * fraction;
      output[offset] = 0.5 * (
        2 * p1
        + (-p0 + p2) * fraction
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * f3
      );
    }
    this.outputFrames = limit;

    const nextSourcePosition = this.outputFrames * this.sourceSampleRate / this.targetSampleRate;
    const keepFrom = Math.max(0, Math.floor(nextSourcePosition) - 1);
    const discard = Math.max(0, Math.min(this.buffer.length, keepFrom - this.bufferStart));
    if (discard > 0) {
      this.buffer = this.buffer.slice(discard);
      this.bufferStart += discard;
    }
    return output;
  }
}
