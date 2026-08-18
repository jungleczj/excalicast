import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import {
  assembleTimedPcm16Wav,
  encodePcm16Wav,
  splitDubbingSrt,
} from '@/lib/dubbingAudio';
import type { AzureEnglishVoice } from '@/services/voiceProfile';

/**
 * Edge TTS provider — Microsoft Edge's free neural text-to-speech endpoint
 * (the same service behind the `edge-tts` CLI), re-implemented natively so it
 * needs no API key and no third-party process. Used as the primary dubbing
 * synthesis provider, with Azure Speech as fallback.
 *
 * Protocol (edge-tts 7.x): the `Sec-MS-GEC` token is computed locally as
 * SHA256(windows-file-time-rounded-to-5min + TrustedClientToken) — there is no
 * token endpoint to call. Each synthesis is a short-lived WebSocket to
 * speech.platform.bing.com that returns an MP3 stream (the endpoint only
 * supports MP3; riff/raw PCM formats return empty), which we decode to PCM WAV
 * so the result plugs into the existing assembleTimedPcm16Wav pipeline.
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const SEC_MS_GEC_VERSION = '1-143.0.3650.75';
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';
const WIN_EPOCH_SECONDS = 11644473600;

interface EdgeTtsDubbingInput {
  translatedSrt: string;
  voice: AzureEnglishVoice;
  signal?: AbortSignal;
}

export interface EdgeTtsDubbingResult {
  audioBytes: Uint8Array;
  voice: AzureEnglishVoice;
  billableCharacters: number;
  chunkCount: number;
  provider: 'edge-tts';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Replicates edge-tts's date_to_string(): "%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)". */
function dateToString(): string {
  const d = new Date();
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCDate())} ${d.getUTCFullYear()} `
    + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} `
    + 'GMT+0000 (Coordinated Universal Time)';
}

/** Replicates edge-tts's DRM.generate_sec_ms_gec(): SHA256 of Windows-file-time (5-min bucket) + trusted token. */
function generateSecMsGec(): string {
  const nowSeconds = Date.now() / 1000;
  let ticks = nowSeconds + WIN_EPOCH_SECONDS;
  ticks = Math.floor(ticks / 300) * 300;
  ticks = ticks * 1e7;
  const strToHash = `${Math.round(ticks)}${TRUSTED_CLIENT_TOKEN}`;
  return createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
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

/** Mirror Azure's rate calculation so each chunk's speech fits its source time window. */
function computeRate(text: string, sourceDurationMs: number): string {
  const estimated = estimateEnglishDurationMs(text);
  const ratio = estimated / Math.max(500, sourceDurationMs);
  const percent = Math.max(-12, Math.min(15, Math.round((ratio - 1) * 100)));
  return percent >= 0 ? `+${percent}%` : `${percent}%`;
}

interface EdgeMessage {
  type: 'audio';
  data: Uint8Array;
}

/** One WebSocket round-trip: synthesize a single text chunk and return its MP3 bytes. */
function synthesizeChunk(
  voice: string,
  text: string,
  rate: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Dubbing cancelled', 'AbortError'));
      return;
    }
    const url = `${WSS_URL}&ConnectionId=${randomBytes(16).toString('hex')}`
      + `&Sec-MS-GEC=${generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
    const ws = new WebSocket(url, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: ORIGIN,
        'Sec-WebSocket-Version': '13',
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
      },
    });

    const chunks: Buffer[] = [];
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.terminate();
      reject(new DOMException('Dubbing cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      ws.terminate();
      reject(new Error('edge_tts_timeout'));
    }, 30_000);

    ws.on('open', () => {
      const config = 'X-Timestamp:' + dateToString() + '\r\n'
        + 'Content-Type:application/json; charset=utf-8\r\n'
        + 'Path:speech.config\r\n\r\n'
        + '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}';
      const ssml = '<speak version=\'1.0\' xmlns=\'http://www.w3.org/2001/10/synthesis\' xml:lang=\'en-US\'>'
        + `<voice name='${voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
      const ssmlRequest = 'X-RequestId:' + randomBytes(16).toString('hex') + '\r\n'
        + 'Content-Type:application/ssml+xml\r\n'
        + 'X-Timestamp:' + dateToString() + 'Z\r\n'
        + 'Path:ssml\r\n\r\n'
        + ssml;
      ws.send(config);
      ws.send(ssmlRequest);
    });

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (settled) return;
      if (isBinary) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (buffer.length < 2) {
          settled = true;
          clearTimeout(timeout);
          signal?.removeEventListener('abort', onAbort);
          ws.terminate();
          reject(new Error('edge_tts_binary_too_short'));
          return;
        }
        const headerLength = buffer.readUInt16BE(0);
        const body = buffer.subarray(headerLength + 2);
        if (body.length > 0) chunks.push(body);
        return;
      }
      const textMessage = data.toString();
      if (textMessage.includes('turn.end')) {
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        ws.close();
        if (chunks.length === 0) {
          reject(new Error('edge_tts_no_audio'));
          return;
        }
        resolve(Buffer.concat(chunks));
      }
    });

    ws.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    });

    ws.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('edge_tts_closed_before_audio'));
    });
  });
}

async function decodeMp3ToWav(mp3: Uint8Array): Promise<Uint8Array> {
  const { ALL_FORMATS, AudioSampleSink, BlobSource, Input } = await import('mediabunny');
  const input = new Input({
    source: new BlobSource(new Blob([mp3], { type: 'audio/mpeg' })),
    formats: ALL_FORMATS,
  });
  let sampleRate = 0;
  const parts: Float32Array[] = [];
  let totalFrames = 0;
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('edge_tts_decode_no_track');
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples()) {
      try {
        if (!sampleRate) sampleRate = sample.sampleRate;
        const mono = new Float32Array(sample.numberOfFrames);
        for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
          const plane = new Float32Array(sample.numberOfFrames);
          sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
          for (let index = 0; index < sample.numberOfFrames; index += 1) {
            mono[index] += plane[index] / sample.numberOfChannels;
          }
        }
        parts.push(mono);
        totalFrames += mono.length;
      } finally {
        sample.close();
      }
    }
  } finally {
    input.dispose();
  }
  if (!sampleRate || totalFrames === 0) throw new Error('edge_tts_decode_empty');
  const int16 = new Int16Array(totalFrames);
  let offset = 0;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      const clamped = Math.max(-1, Math.min(1, part[index]));
      int16[offset + index] = Math.round(clamped < 0 ? clamped * 32_768 : clamped * 32_767);
    }
    offset += part.length;
  }
  return encodePcm16Wav(int16, sampleRate, 1);
}

export async function synthesizeEdgeTtsDubbing(
  input: EdgeTtsDubbingInput,
): Promise<EdgeTtsDubbingResult> {
  const chunks = splitDubbingSrt(input.translatedSrt);
  const entries: Array<{ startMs: number; wav: Uint8Array }> = [];
  let billableCharacters = 0;
  for (const chunk of chunks) {
    if (input.signal?.aborted) throw new DOMException('Dubbing cancelled', 'AbortError');
    const rate = computeRate(chunk.text, Math.max(500, chunk.endMs - chunk.startMs));
    const mp3 = await synthesizeChunk(input.voice, chunk.text, rate, input.signal);
    const wav = await decodeMp3ToWav(mp3);
    entries.push({ startMs: chunk.startMs, wav });
    billableCharacters += chunk.text.length;
  }
  const minimumDurationMs = Math.max(...chunks.map((chunk) => chunk.endMs));
  return {
    audioBytes: assembleTimedPcm16Wav(entries, minimumDurationMs),
    voice: input.voice,
    billableCharacters,
    chunkCount: chunks.length,
    provider: 'edge-tts',
  };
}
