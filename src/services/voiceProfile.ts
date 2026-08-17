export type VoiceRegister = 'masculine' | 'feminine' | 'uncertain';

export interface VoiceProfile {
  register: VoiceRegister;
  confidence: number;
  medianPitchHz: number | null;
  pitchRangeHz: number;
  voicedFrameRatio: number;
  analyzedDurationMs: number;
  analyzerVersion: 'voice-profile-v1';
}

export type AzureEnglishVoice =
  | 'en-US-AndrewMultilingualNeural'
  | 'en-US-AvaMultilingualNeural';

export type DubbingVoiceChoice = 'auto' | 'masculine' | 'feminine';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function estimatePitch(frame: Float32Array, sampleRate: number): number | null {
  let energy = 0;
  let mean = 0;
  for (const sample of frame) mean += sample;
  mean /= Math.max(1, frame.length);
  for (const sample of frame) {
    const centered = sample - mean;
    energy += centered * centered;
  }
  const rms = Math.sqrt(energy / Math.max(1, frame.length));
  if (rms < 0.012) return null;

  const minimumLag = Math.max(2, Math.floor(sampleRate / 350));
  const maximumLag = Math.min(frame.length - 2, Math.ceil(sampleRate / 75));
  let bestLag = 0;
  let bestCorrelation = 0;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index < frame.length - lag; index += 1) {
      const left = frame[index] - mean;
      const right = frame[index + lag] - mean;
      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const normalized = correlation / Math.sqrt(Math.max(1e-12, leftEnergy * rightEnergy));
    if (normalized > bestCorrelation) {
      bestCorrelation = normalized;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || bestCorrelation < 0.58) return null;
  return sampleRate / bestLag;
}

export function analyzeVoiceProfile(samples: Float32Array, sampleRate: number): VoiceProfile {
  const frameSize = Math.max(256, Math.round(sampleRate * 0.04));
  const availableFrames = Math.max(1, Math.floor((samples.length - frameSize) / Math.max(1, frameSize / 2)));
  const hopSize = Math.max(128, Math.round((samples.length - frameSize) / Math.min(160, availableFrames)));
  const pitches: number[] = [];
  let totalFrames = 0;
  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    totalFrames += 1;
    const pitch = estimatePitch(samples.subarray(offset, offset + frameSize), sampleRate);
    if (pitch) pitches.push(pitch);
  }

  const medianPitchHz = pitches.length > 0 ? median(pitches) : null;
  const sorted = [...pitches].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const high = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? low;
  const voicedFrameRatio = pitches.length / Math.max(1, totalFrames);
  let register: VoiceRegister = 'uncertain';
  let pitchConfidence = 0;
  if (medianPitchHz !== null && medianPitchHz <= 165) {
    register = 'masculine';
    pitchConfidence = Math.min(1, (175 - medianPitchHz) / 45);
  } else if (medianPitchHz !== null && medianPitchHz >= 190) {
    register = 'feminine';
    pitchConfidence = Math.min(1, (medianPitchHz - 180) / 45);
  }
  const confidence = Math.max(0, Math.min(1, pitchConfidence * Math.min(1, voicedFrameRatio / 0.35)));

  return {
    register,
    confidence,
    medianPitchHz,
    pitchRangeHz: Math.max(0, high - low),
    voicedFrameRatio,
    analyzedDurationMs: samples.length / Math.max(1, sampleRate) * 1000,
    analyzerVersion: 'voice-profile-v1',
  };
}

export function resolveAzureVoice(
  profile: Pick<VoiceProfile, 'register'>,
  fallback: AzureEnglishVoice = 'en-US-AvaMultilingualNeural',
): AzureEnglishVoice {
  if (profile.register === 'masculine') return 'en-US-AndrewMultilingualNeural';
  if (profile.register === 'feminine') return 'en-US-AvaMultilingualNeural';
  return fallback;
}

export function resolveAzureVoiceChoice(
  profile: Pick<VoiceProfile, 'register'>,
  choice: DubbingVoiceChoice,
): AzureEnglishVoice {
  if (choice === 'masculine') return 'en-US-AndrewMultilingualNeural';
  if (choice === 'feminine') return 'en-US-AvaMultilingualNeural';
  return resolveAzureVoice(profile);
}

export async function analyzeVoiceProfileFromBlob(
  blob: Blob,
  options: { signal?: AbortSignal; maxDurationMs?: number } = {},
): Promise<VoiceProfile> {
  const { ALL_FORMATS, AudioSampleSink, BlobSource, Input } = await import('mediabunny');
  const input = new Input({
    source: new BlobSource(blob, { maxCacheSize: 4 * 1024 * 1024, useStreamReader: true }),
    formats: ALL_FORMATS,
  });
  const maxDurationMs = Math.max(3_000, Math.min(30_000, options.maxDurationMs ?? 12_000));
  const parts: Float32Array[] = [];
  let totalFrames = 0;
  let sampleRate = 0;
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('voice_profile_audio_missing');
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples()) {
      try {
        if (options.signal?.aborted) throw new DOMException('Voice analysis cancelled', 'AbortError');
        if (!sampleRate) sampleRate = sample.sampleRate;
        if (sample.sampleRate !== sampleRate) throw new Error('voice_profile_sample_rate_changed');
        const remaining = Math.max(0, Math.round(sampleRate * maxDurationMs / 1000) - totalFrames);
        if (remaining === 0) break;
        const frameCount = Math.min(sample.numberOfFrames, remaining);
        const mono = new Float32Array(frameCount);
        for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
          const plane = new Float32Array(sample.numberOfFrames);
          sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
          for (let index = 0; index < frameCount; index += 1) mono[index] += plane[index] / sample.numberOfChannels;
        }
        parts.push(mono);
        totalFrames += frameCount;
        if (totalFrames >= Math.round(sampleRate * maxDurationMs / 1000)) break;
      } finally {
        sample.close();
      }
    }
  } finally {
    input.dispose();
  }
  if (!sampleRate || totalFrames === 0) throw new Error('voice_profile_audio_empty');
  const samples = new Float32Array(totalFrames);
  let offset = 0;
  for (const part of parts) {
    samples.set(part, offset);
    offset += part.length;
  }
  return analyzeVoiceProfile(samples, sampleRate);
}
