/// <reference lib="webworker" />

import { Rnnoise, type DenoiseState } from '@shiguredo/rnnoise-wasm';
import type { NoiseReductionMode } from '@/types/recording';
import type { AudioRepairSettings } from '@/services/audioRepairDomain';

type Request =
  | { type: 'process'; requestId: number; mode: NoiseReductionMode; samples: Float32Array; sampleRate: number; repairSettings?: AudioRepairSettings }
  | { type: 'dispose' };

let rnnoiseStatePromise: Promise<{ frameSize: number; state: DenoiseState }> | null = null;
let highPassPreviousInput = 0;
let highPassPreviousOutput = 0;
let noiseFloor = 0.008;
let repairPreviousInput = 0;
let repairPreviousHighPass = 0;
let repairPreviousOutput = 0;

function repairVoice(samples: Float32Array, sampleRate: number, settings: AudioRepairSettings): Float32Array {
  const output = new Float32Array(samples.length);
  const strength = settings.repairStrength / 100;
  const clarity = settings.clarity / 100;
  const warmth = settings.warmth / 100;
  const originalMix = settings.originalMix / 100;
  const highPassAlpha = Math.exp(-2 * Math.PI * 72 / Math.max(8_000, sampleRate));
  const lowPassAlpha = 1 - Math.exp(-2 * Math.PI * 3_600 / Math.max(8_000, sampleRate));
  let smoothed = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const original = samples[index];
    let repaired = highPassAlpha * (repairPreviousHighPass + original - repairPreviousInput);
    repairPreviousInput = original;
    repairPreviousHighPass = repaired;

    if (settings.repairs.clicks && index > 0 && index + 1 < samples.length) {
      const neighborhood = (samples[index - 1] + samples[index + 1]) * 0.5;
      if (Math.abs(original - neighborhood) > 0.3) repaired = repaired * (1 - strength) + neighborhood * strength;
    }
    if (settings.repairs.clipping && Math.abs(original) > 0.94) repaired = Math.tanh(repaired * (1.2 + strength * 0.8)) / Math.tanh(1.2 + strength * 0.8);
    if (settings.repairs.hiss) {
      const gate = 0.002 + strength * 0.008;
      if (Math.abs(repaired) < gate) repaired *= 0.18 + (1 - strength) * 0.55;
    }

    smoothed += (repaired - smoothed) * lowPassAlpha;
    const presence = repaired - smoothed;
    repaired += presence * clarity * (settings.repairs.sibilance ? 0.32 : 0.58);
    repaired += smoothed * warmth * 0.22;
    if (settings.repairs.sibilance && Math.abs(presence) > 0.08) repaired -= presence * (0.18 + strength * 0.24);

    repaired = repaired * (1 - originalMix * 0.65) + original * originalMix * 0.65;
    repaired = Math.tanh(repaired * 1.08) / Math.tanh(1.08);
    repairPreviousOutput = repairPreviousOutput * 0.12 + repaired * 0.88;
    output[index] = repairPreviousOutput;
  }
  return output;
}

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
    let result: Int16Array;
    if (message.repairSettings) {
      const repaired = repairVoice(message.samples, message.sampleRate, message.repairSettings);
      result = message.mode === 'enhanced'
        ? await enhancedDenoise(repaired, message.sampleRate)
        : Int16Array.from(repaired, (sample) => Math.round(Math.max(-1, Math.min(1, sample)) * 32767));
    } else {
      result = message.mode === 'enhanced'
        ? await enhancedDenoise(message.samples, message.sampleRate)
        : standardDenoise(message.samples, message.sampleRate);
    }
    self.postMessage({ type: 'result', requestId: message.requestId, samples: result }, [result.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', requestId: message.requestId, error: error instanceof Error ? error.message : 'audio_enhancement_failed' });
  }
};

export {};
