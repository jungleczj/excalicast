export interface DubbingSpeechChunk {
  startMs: number;
  endMs: number;
  text: string;
}

export interface ParsedPcm16Wav {
  sampleRate: number;
  channels: number;
  samples: Int16Array;
  durationMs: number;
}

function parseSrtTimestamp(value: string): number {
  const match = value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) throw new Error('invalid_dubbing_srt_timestamp');
  return Number(match[1]) * 3_600_000
    + Number(match[2]) * 60_000
    + Number(match[3]) * 1000
    + Number(match[4]);
}

export function splitDubbingSrt(
  srt: string,
  options: { maxCharacters?: number; maxSpanMs?: number; maxGapMs?: number } = {},
): DubbingSpeechChunk[] {
  const maxCharacters = options.maxCharacters ?? 900;
  const maxSpanMs = options.maxSpanMs ?? 45_000;
  const maxGapMs = options.maxGapMs ?? 2_500;
  const cues = srt.trim().split(/\r?\n\s*\r?\n/).flatMap((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) return [];
    const timing = lines[timingIndex].match(/^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/);
    if (!timing) return [];
    const text = lines.slice(timingIndex + 1).join(' ').trim();
    if (!text) return [];
    try {
      return [{ startMs: parseSrtTimestamp(timing[1]), endMs: parseSrtTimestamp(timing[2]), text }];
    } catch {
      return [];
    }
  });

  if (cues.length === 0) throw new Error('invalid_translated_srt');
  const chunks: DubbingSpeechChunk[] = [];
  for (const cue of cues) {
    const current = chunks[chunks.length - 1];
    const combinedText = current ? `${current.text} ${cue.text}` : cue.text;
    const canMerge = !!current
      && cue.startMs - current.endMs <= maxGapMs
      && cue.endMs - current.startMs <= maxSpanMs
      && combinedText.length <= maxCharacters;
    if (canMerge) {
      current.endMs = cue.endMs;
      current.text = combinedText;
    } else {
      chunks.push({ ...cue });
    }
  }
  return chunks;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(view.getUint8(offset + index));
  return value;
}

export function parsePcm16Wav(bytes: Uint8Array): ParsedPcm16Wav {
  if (bytes.byteLength < 44) throw new Error('dubbing_audio_too_small');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('dubbing_audio_not_wav');
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    if (payloadOffset + chunkLength > view.byteLength) throw new Error('dubbing_audio_truncated');
    if (chunkId === 'fmt ' && chunkLength >= 16) {
      audioFormat = view.getUint16(payloadOffset, true);
      channels = view.getUint16(payloadOffset + 2, true);
      sampleRate = view.getUint32(payloadOffset + 4, true);
      bitsPerSample = view.getUint16(payloadOffset + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = payloadOffset;
      dataLength = chunkLength;
      break;
    }
    offset = payloadOffset + chunkLength + (chunkLength % 2);
  }
  const pcm16 = audioFormat === 1 && bitsPerSample === 16;
  const float32 = audioFormat === 3 && bitsPerSample === 32;
  if ((!pcm16 && !float32) || channels < 1 || sampleRate < 8_000 || dataOffset < 0) {
    throw new Error('dubbing_audio_unsupported_wav');
  }
  const bytesPerSample = bitsPerSample / 8;
  if (dataLength % bytesPerSample !== 0) throw new Error('dubbing_audio_truncated');
  const sampleCount = dataLength / bytesPerSample;
  const samples = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    if (pcm16) {
      samples[index] = view.getInt16(dataOffset + index * bytesPerSample, true);
      continue;
    }
    const value = view.getFloat32(dataOffset + index * bytesPerSample, true);
    if (!Number.isFinite(value)) throw new Error('dubbing_audio_invalid_samples');
    const clamped = Math.max(-1, Math.min(1, value));
    samples[index] = Math.round(clamped < 0 ? clamped * 32_768 : clamped * 32_767);
  }
  return {
    sampleRate,
    channels,
    samples,
    durationMs: sampleCount / channels / sampleRate * 1000,
  };
}

function encodePcm16Wav(samples: Int16Array, sampleRate: number, channels: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.byteLength);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.byteLength, true);
  for (let index = 0; index < samples.length; index += 1) view.setInt16(44 + index * 2, samples[index], true);
  return bytes;
}

export function assembleTimedPcm16Wav(
  entries: Array<{ startMs: number; wav: Uint8Array }>,
  minimumDurationMs = 0,
): Uint8Array {
  if (entries.length === 0) throw new Error('dubbing_audio_missing_chunks');
  const parsed = entries.map((entry) => ({ ...entry, audio: parsePcm16Wav(entry.wav) }));
  const { sampleRate, channels } = parsed[0].audio;
  for (const entry of parsed) {
    if (entry.audio.sampleRate !== sampleRate || entry.audio.channels !== channels) {
      throw new Error('dubbing_audio_format_mismatch');
    }
  }
  const lastSample = parsed.reduce((maximum, entry) => {
    const start = Math.max(0, Math.round(entry.startMs / 1000 * sampleRate)) * channels;
    return Math.max(maximum, start + entry.audio.samples.length);
  }, Math.ceil(minimumDurationMs / 1000 * sampleRate) * channels);
  const output = new Int16Array(lastSample);
  for (const entry of parsed) {
    const start = Math.max(0, Math.round(entry.startMs / 1000 * sampleRate)) * channels;
    const frameCount = Math.floor(entry.audio.samples.length / channels);
    const fadeFrames = Math.min(Math.round(sampleRate * 0.005), Math.floor(frameCount / 2));
    for (let index = 0; index < entry.audio.samples.length && start + index < output.length; index += 1) {
      const frame = Math.floor(index / channels);
      const fadeIn = fadeFrames > 0 && frame < fadeFrames
        ? Math.sin((frame / fadeFrames) * Math.PI / 2)
        : 1;
      const framesFromEnd = frameCount - 1 - frame;
      const fadeOut = fadeFrames > 0 && framesFromEnd < fadeFrames
        ? Math.sin((Math.max(0, framesFromEnd) / fadeFrames) * Math.PI / 2)
        : 1;
      const sample = Math.round(entry.audio.samples[index] * Math.min(fadeIn, fadeOut));
      const mixed = output[start + index] + sample;
      output[start + index] = Math.max(-32_768, Math.min(32_767, mixed));
    }
  }
  return encodePcm16Wav(output, sampleRate, channels);
}

export function hasAudiblePcm16Audio(bytes: Uint8Array): boolean {
  const { samples } = parsePcm16Wav(bytes);
  if (samples.length === 0) return false;
  let peak = 0;
  let energy = 0;
  const stride = Math.max(1, Math.floor(samples.length / 200_000));
  let measured = 0;
  for (let index = 0; index < samples.length; index += stride) {
    const absolute = Math.abs(samples[index]);
    peak = Math.max(peak, absolute);
    energy += absolute * absolute;
    measured += 1;
  }
  return peak >= 256 && Math.sqrt(energy / measured) >= 16;
}
