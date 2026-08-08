'use client';

import {
  getAudioPeakTrack,
  loadRecordingMediaTracks,
  saveAudioPeakTrack,
  type AudioPeakTrackRow,
} from '@/lib/db-client';

export function downsampleAudioPeaks(
  input: Float32Array | readonly Float32Array[],
  bucketCount: number,
): number[] {
  const channels = input instanceof Float32Array ? [input] : [...input];
  const sampleCount = channels.reduce((max, channel) => Math.max(max, channel.length), 0);
  const count = Math.max(0, Math.min(sampleCount, Math.round(bucketCount)));
  if (count === 0) return [];

  const peaks: number[] = [];
  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor((bucket * sampleCount) / count);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * sampleCount) / count));
    let peak = 0;
    for (const channel of channels) {
      for (let index = start; index < end && index < channel.length; index += 1) {
        peak = Math.max(peak, Math.abs(channel[index]));
      }
    }
    peaks.push(Number(Math.min(1, peak).toFixed(6)));
  }
  return peaks;
}

export async function loadOrCreateAudioPeakTrack(
  recordingId: string,
  samplesPerSecond = 12,
): Promise<AudioPeakTrackRow | null> {
  const { metadata, audioBlob } = await loadRecordingMediaTracks(recordingId, ['audio']);
  if (!audioBlob) return null;
  const signature = `${audioBlob.size}:${audioBlob.type}:${metadata.durationMs}`;
  const cached = await getAudioPeakTrack(recordingId);
  if (cached?.sourceSignature === signature && cached.samplesPerSecond === samplesPerSecond) return cached;

  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  const context = new AudioContextCtor();
  try {
    const buffer = await context.decodeAudioData(await audioBlob.arrayBuffer());
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    const peaks = downsampleAudioPeaks(channels, Math.max(1, Math.ceil((metadata.durationMs / 1000) * samplesPerSecond)));
    const track: AudioPeakTrackRow = {
      id: `${recordingId}:${signature}:${samplesPerSecond}`,
      recordingId,
      sourceSignature: signature,
      samplesPerSecond,
      peaks,
      createdAt: Date.now(),
    };
    await saveAudioPeakTrack(track);
    return track;
  } finally {
    await context.close().catch(() => undefined);
  }
}
