import 'server-only';

import { deepseekChat } from '@/services/deepseekClient';
import {
  fetchTranscriptionResult,
  mockSrt,
  pollTranscriptionTaskOnce,
  sentencesToSrt,
  submitTranscriptionTask,
} from '@/services/qwenAsr';

export interface DubbingProviderResult {
  translatedSrt: string;
  audioBytes: Uint8Array;
  audioType: string;
  lipSyncCamera?: Uint8Array;
  lipSyncCameraType?: string;
  lipSync: 'done' | 'skipped' | 'failed';
  provider: string;
}

function msToSrtTime(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const hh = String(Math.floor(safe / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((safe % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((safe % 60_000) / 1000)).padStart(2, '0');
  const mmm = String(safe % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss},${mmm}`;
}

function mockEnglishSrt(): string {
  return [
    '1',
    `${msToSrtTime(0)} --> ${msToSrtTime(3000)}`,
    'This is the English narrated version.',
    '',
    '2',
    `${msToSrtTime(3000)} --> ${msToSrtTime(7000)}`,
    'Your original voice is muted in preview and export.',
    '',
  ].join('\n');
}

function srtToPlainText(srt: string): string {
  return srt
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/^\d+$/.test(line.trim()) && !line.includes('-->'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeMockWav(durationMs = 1400): Uint8Array {
  const sampleRate = 16_000;
  const samples = Math.max(400, Math.round(sampleRate * durationMs / 1000));
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const env = Math.min(1, i / 800) * Math.min(1, (samples - i) / 800);
    const value = Math.sin(t * Math.PI * 2 * 220) * 0.18 * env;
    view.setInt16(44 + i * 2, Math.round(value * 32767), true);
  }
  return bytes;
}

async function translateToEnglishSrt(sourceSrt: string): Promise<string> {
  if (!sourceSrt.trim()) return mockEnglishSrt();
  if (!process.env.DEEPSEEK_API_KEY) return mockEnglishSrt();
  try {
    const result = await deepseekChat({
      jsonMode: false,
      timeoutMs: 45_000,
      systemPrompt: 'Translate the SRT captions into concise natural English. Preserve numbering and exact timestamps. Return only SRT text.',
      prompt: sourceSrt,
    });
    return result.text.trim() || mockEnglishSrt();
  } catch {
    return mockEnglishSrt();
  }
}

async function transcribeSourceAudio(fileUrl: string): Promise<{ srt: string; provider: string }> {
  if (!process.env.DASHSCOPE_API_KEY) {
    return { srt: mockSrt(), provider: 'mock-asr' };
  }

  try {
    const submit = await submitTranscriptionTask({ fileUrl, languageHints: ['zh', 'en'] });
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const poll = await pollTranscriptionTaskOnce(submit.taskId);
      if (poll.status === 'SUCCEEDED' && poll.transcriptionUrl) {
        const sentences = await fetchTranscriptionResult(poll.transcriptionUrl);
        const srt = sentencesToSrt(sentences);
        return { srt: srt.trim() || mockSrt(), provider: 'qwen-asr' };
      }
      if (poll.status === 'NO_SPEECH') {
        throw new Error('no_speech_detected');
      }
      if (poll.status === 'FAILED' || poll.status === 'CANCELED') {
        throw new Error(`DashScope task ${poll.status}: ${poll.errorMessage ?? 'unknown'}`);
      }
    }
    throw new Error('asr_timeout');
  } catch (error) {
    if (error instanceof Error && error.message === 'no_speech_detected') throw error;
    return { srt: mockSrt(), provider: 'mock-asr' };
  }
}

async function resolveSourceSrt(sourceSrt: string | undefined, sourceAudioFileUrl: string | undefined): Promise<{ srt: string; provider: string }> {
  if (sourceSrt?.trim()) return { srt: sourceSrt, provider: 'source-srt' };
  if (!sourceAudioFileUrl) return { srt: mockSrt(), provider: 'mock-asr' };
  return transcribeSourceAudio(sourceAudioFileUrl);
}

async function synthesizeEnglishAudio(translatedSrt: string): Promise<{ bytes: Uint8Array; type: string; provider: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  const input = srtToPlainText(translatedSrt) || 'This is the English narrated version.';
  if (!apiKey) {
    return { bytes: makeMockWav(Math.max(1400, Math.min(8000, input.length * 55))), type: 'audio/wav', provider: 'mock-dubbing' };
  }
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
      voice: process.env.OPENAI_TTS_VOICE ?? 'alloy',
      input,
      response_format: 'wav',
    }),
  });
  if (!res.ok) {
    return { bytes: makeMockWav(Math.max(1400, Math.min(8000, input.length * 55))), type: 'audio/wav', provider: 'mock-dubbing' };
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: 'audio/wav', provider: 'openai-tts' };
}

async function runLipSync(cameraBytes: Uint8Array | undefined): Promise<Pick<DubbingProviderResult, 'lipSyncCamera' | 'lipSyncCameraType' | 'lipSync'>> {
  if (!cameraBytes || cameraBytes.byteLength === 0) return { lipSync: 'skipped' };
  // Real lip-sync providers such as HeyGen's async video translation/lipsync API
  // require public video + audio URLs and a separate poll/download cycle. Keep
  // V1 honest: only mark lip-sync as done when a mock run is explicitly enabled.
  if (process.env.DUBBING_MOCK_LIPSYNC !== '1') return { lipSync: 'skipped' };
  return { lipSync: 'done', lipSyncCamera: cameraBytes, lipSyncCameraType: 'video/webm' };
}

export async function generateDubbingAssets(params: {
  sourceSrt?: string;
  sourceAudioFileUrl?: string;
  cameraBytes?: Uint8Array;
}): Promise<DubbingProviderResult> {
  const source = await resolveSourceSrt(params.sourceSrt, params.sourceAudioFileUrl);
  const translatedSrt = await translateToEnglishSrt(source.srt);
  const audio = await synthesizeEnglishAudio(translatedSrt);
  const lip = await runLipSync(params.cameraBytes);
  return {
    translatedSrt,
    audioBytes: audio.bytes,
    audioType: audio.type,
    provider: `${source.provider}+${audio.provider}`,
    ...lip,
  };
}
