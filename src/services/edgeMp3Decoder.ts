import { MPEGDecoder } from 'mpg123-decoder';
import { encodePcm16Wav } from '@/lib/dubbingAudio';

export interface EdgePcmQualityMetrics {
  peak: number;
  rms: number;
  dcOffset: number;
  clippedSampleRatio: number;
}

export interface DecodedEdgeMp3 {
  wav: Uint8Array;
  sampleRate: number;
  sampleCount: number;
  durationMs: number;
  encodedDurationMs: number;
  decodeErrors: string[];
  metrics: EdgePcmQualityMetrics;
}

function analyzeSamples(samples: Float32Array): EdgePcmQualityMetrics {
  let peak = 0;
  let sum = 0;
  let energy = 0;
  let clipped = 0;
  for (const value of samples) {
    if (!Number.isFinite(value)) throw new Error('edge_tts_pcm_non_finite');
    const absolute = Math.abs(value);
    peak = Math.max(peak, absolute);
    sum += value;
    energy += value * value;
    if (absolute >= 0.999) clipped += 1;
  }
  const count = Math.max(1, samples.length);
  return {
    peak,
    rms: Math.sqrt(energy / count),
    dcOffset: sum / count,
    clippedSampleRatio: clipped / count,
  };
}

function assertUsableEdgeAudio(
  sampleRate: number,
  inputChannelCount: number,
  samplesDecoded: number,
  metrics: EdgePcmQualityMetrics,
  decodeErrors: string[],
): void {
  if (decodeErrors.length > 0) throw new Error(`edge_tts_mp3_decode_error:${decodeErrors[0]}`);
  if (sampleRate !== 24_000) throw new Error(`edge_tts_unexpected_sample_rate:${sampleRate}`);
  if (inputChannelCount < 1 || inputChannelCount > 2) throw new Error(`edge_tts_unexpected_channel_count:${inputChannelCount}`);
  if (samplesDecoded <= 0) throw new Error('edge_tts_pcm_empty');
  if (metrics.peak < 0.01 || metrics.rms < 0.001) throw new Error('edge_tts_pcm_silent');
  if (metrics.clippedSampleRatio > 0.01) throw new Error('edge_tts_pcm_clipped');
  if (Math.abs(metrics.dcOffset) > 0.05) throw new Error('edge_tts_pcm_dc_offset');
}

export async function decodeEdgeMp3ToPcm16Wav(mp3: Uint8Array): Promise<DecodedEdgeMp3> {
  if (mp3.byteLength < 128) throw new Error('edge_tts_mp3_too_small');
  const decoder = new MPEGDecoder({ enableGapless: true });
  try {
    await decoder.ready;
    const decoded = decoder.decode(mp3);
    const decodeErrors = decoded.errors.map((error) => error.message);
    const mono = new Float32Array(decoded.samplesDecoded);
    for (const channel of decoded.channelData) {
      if (channel.length !== decoded.samplesDecoded) throw new Error('edge_tts_pcm_channel_length_mismatch');
      for (let index = 0; index < channel.length; index += 1) mono[index] += channel[index] / decoded.channelData.length;
    }
    const metrics = analyzeSamples(mono);
    assertUsableEdgeAudio(decoded.sampleRate, decoded.channelData.length, decoded.samplesDecoded, metrics, decodeErrors);

    // Edge returns 48 kbps CBR MP3. Comparing encoded bytes to decoded samples
    // catches truncated or duplicated packet assembly without parsing MP3 twice.
    const encodedDurationMs = mp3.byteLength * 8 / 48_000 * 1000;
    const durationMs = mono.length / decoded.sampleRate * 1000;
    if (Math.abs(durationMs - encodedDurationMs) > 48) throw new Error('edge_tts_mp3_duration_mismatch');

    const pcm = new Int16Array(mono.length);
    for (let index = 0; index < mono.length; index += 1) {
      const value = Math.max(-1, Math.min(1, mono[index]));
      pcm[index] = Math.round(value < 0 ? value * 32_768 : value * 32_767);
    }
    return {
      wav: encodePcm16Wav(pcm, decoded.sampleRate, 1),
      sampleRate: decoded.sampleRate,
      sampleCount: pcm.length,
      durationMs,
      encodedDurationMs,
      decodeErrors,
      metrics,
    };
  } finally {
    decoder.free();
  }
}
