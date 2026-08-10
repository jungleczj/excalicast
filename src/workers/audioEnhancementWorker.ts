/// <reference lib="webworker" />

import { Rnnoise, type DenoiseState } from '@shiguredo/rnnoise-wasm';
import type { NoiseReductionMode } from '@/types/recording';

type Request =
  | { type: 'process'; requestId: number; mode: NoiseReductionMode; samples: Float32Array; sampleRate: number }
  | { type: 'dispose' };

let rnnoiseStatePromise: Promise<{ frameSize: number; state: DenoiseState }> | null = null;
let highPassPreviousInput = 0;
let highPassPreviousOutput = 0;
let noiseFloor = 0.008;

function standardDenoise(samples: Float32Array, sampleRate: number): Int16Array {
  const output = new Int16Array(samples.length);
  const highPassAlpha = Math.exp(-2 * Math.PI * 85 / Math.max(8_000, sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    const input = samples[index];
    const highPassed = highPassAlpha * (highPassPreviousOutput + input - highPassPreviousInput);
    highPassPreviousInput = input;
    highPassPreviousOutput = highPassed;
    const level = Math.abs(highPassed);
    if (level < noiseFloor * 2.8) noiseFloor = noiseFloor * 0.997 + level * 0.003;
    const threshold = Math.max(0.0025, noiseFloor * 2.4);
    const gain = level <= threshold ? 0.2 + 0.8 * Math.pow(level / threshold, 2) : 1;
    output[index] = Math.round(Math.max(-1, Math.min(1, highPassed * gain)) * 32767);
  }
  return output;
}

async function enhancedDenoise(samples: Float32Array, sampleRate: number): Promise<Int16Array> {
  if (sampleRate !== 48_000) throw new Error(`rnnoise_requires_48000hz:${sampleRate}`);
  if (!rnnoiseStatePromise) {
    rnnoiseStatePromise = Rnnoise.load().then((rnnoise) => ({ frameSize: rnnoise.frameSize, state: rnnoise.createDenoiseState() }));
  }
  const { frameSize, state } = await rnnoiseStatePromise;
  const output = new Int16Array(samples.length);
  const frame = new Float32Array(frameSize);
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    frame.fill(0);
    const length = Math.min(frameSize, samples.length - offset);
    for (let index = 0; index < length; index += 1) frame[index] = Math.max(-1, Math.min(1, samples[offset + index])) * 32767;
    state.processFrame(frame);
    for (let index = 0; index < length; index += 1) output[offset + index] = Math.round(Math.max(-32768, Math.min(32767, frame[index])));
  }
  return output;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data;
  if (message.type === 'dispose') {
    if (rnnoiseStatePromise) {
      const value = await rnnoiseStatePromise.catch(() => null);
      value?.state.destroy();
    }
    close();
    return;
  }
  try {
    const result = message.mode === 'enhanced'
      ? await enhancedDenoise(message.samples, message.sampleRate)
      : standardDenoise(message.samples, message.sampleRate);
    self.postMessage({ type: 'result', requestId: message.requestId, samples: result }, [result.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', requestId: message.requestId, error: error instanceof Error ? error.message : 'audio_enhancement_failed' });
  }
};

export {};
