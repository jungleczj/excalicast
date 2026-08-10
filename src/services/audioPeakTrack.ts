'use client';

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
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

  const peaks = await createAudioPeaksForBlob(audioBlob, metadata.durationMs, samplesPerSecond);
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
}

export async function createAudioPeaksForBlob(
  audioBlob: Blob,
  durationMs: number,
  samplesPerSecond = 12,
): Promise<number[]> {
  const bucketCount = Math.max(1, Math.ceil((durationMs / 1000) * samplesPerSecond));
  const peaks = new Float32Array(bucketCount);
  const input = new Input({
    source: new BlobSource(audioBlob, { maxCacheSize: 4 * 1024 * 1024, useStreamReader: true }),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return [];
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples()) {
      try {
        for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
          const plane = new Float32Array(sample.numberOfFrames);
          sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
          for (let frame = 0; frame < plane.length; frame += 1) {
            const time = sample.timestamp + frame / sample.sampleRate;
            const bucket = Math.min(bucketCount - 1, Math.max(0, Math.floor(time * samplesPerSecond)));
            peaks[bucket] = Math.max(peaks[bucket], Math.abs(plane[frame]));
          }
        }
      } finally {
        sample.close();
      }
    }
    return Array.from(peaks, (peak) => Number(Math.min(1, peak).toFixed(6)));
  } finally {
    input.dispose();
  }
}
