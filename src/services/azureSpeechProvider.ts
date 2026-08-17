import {
  assembleTimedPcm16Wav,
  parsePcm16Wav,
  splitDubbingSrt,
} from '@/lib/dubbingAudio';
import type { AzureEnglishVoice } from '@/services/voiceProfile';

interface AzureSsmlInput {
  text: string;
  voice: AzureEnglishVoice;
  sourceDurationMs: number;
  estimatedDurationMs?: number;
}

interface AzureDubbingInput {
  translatedSrt: string;
  voice: AzureEnglishVoice;
  subscriptionKey: string;
  region: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  retryBaseDelayMs?: number;
}

export interface AzureDubbingResult {
  audioBytes: Uint8Array;
  voice: AzureEnglishVoice;
  billableCharacters: number;
  chunkCount: number;
  provider: 'azure-speech-f0';
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function estimateEnglishDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const punctuationPauses = (text.match(/[,.!?;:]/g) ?? []).length * 120;
  return Math.max(500, words / 150 * 60_000 + punctuationPauses);
}

export function buildAzureSpeechSsml(input: AzureSsmlInput): string {
  const estimated = input.estimatedDurationMs ?? estimateEnglishDurationMs(input.text);
  const ratio = estimated / Math.max(500, input.sourceDurationMs);
  const percent = Math.max(-12, Math.min(15, Math.round((ratio - 1) * 100)));
  const rate = percent >= 0 ? `+${percent}%` : `${percent}%`;
  return [
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">',
    `<voice name="${input.voice}">`,
    `<prosody rate="${rate}">${escapeXml(input.text.trim())}</prosody>`,
    '</voice>',
    '</speak>',
  ].join('');
}

function azureEndpoint(region: string): string {
  if (!/^[a-z0-9-]+$/i.test(region)) throw new Error('azure_speech_region_invalid');
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Dubbing cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Dubbing cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestSpeechChunk(
  input: AzureDubbingInput,
  ssml: string,
): Promise<Response> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const retryable = new Set([429, 500, 502, 503, 504]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(azureEndpoint(input.region), {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': input.subscriptionKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-48khz-16bit-mono-pcm',
        'User-Agent': 'Excalicast',
      },
      body: ssml,
      signal: input.signal,
    });
    if (response.ok || !retryable.has(response.status) || attempt === 2) return response;
    const retryAfterSeconds = Number(response.headers.get('retry-after'));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? Math.min(10_000, retryAfterSeconds * 1000)
      : (input.retryBaseDelayMs ?? 500) * (2 ** attempt);
    await waitForRetry(delayMs, input.signal);
  }
  throw new Error('azure_speech_retry_exhausted');
}

export async function synthesizeAzureDubbing(input: AzureDubbingInput): Promise<AzureDubbingResult> {
  if (!input.subscriptionKey.trim()) throw new Error('azure_speech_not_configured');
  const chunks = splitDubbingSrt(input.translatedSrt);
  const entries: Array<{ startMs: number; wav: Uint8Array }> = [];
  let billableCharacters = 0;
  for (const chunk of chunks) {
    if (input.signal?.aborted) throw new DOMException('Dubbing cancelled', 'AbortError');
    const ssml = buildAzureSpeechSsml({
      text: chunk.text,
      voice: input.voice,
      sourceDurationMs: Math.max(500, chunk.endMs - chunk.startMs),
    });
    const response = await requestSpeechChunk(input, ssml);
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`azure_speech_${response.status}${detail ? `:${detail}` : ''}`);
    }
    const wav = new Uint8Array(await response.arrayBuffer());
    parsePcm16Wav(wav);
    entries.push({ startMs: chunk.startMs, wav });
    billableCharacters += chunk.text.length;
  }
  const minimumDurationMs = Math.max(...chunks.map((chunk) => chunk.endMs));
  return {
    audioBytes: assembleTimedPcm16Wav(entries, minimumDurationMs),
    voice: input.voice,
    billableCharacters,
    chunkCount: chunks.length,
    provider: 'azure-speech-f0',
  };
}
