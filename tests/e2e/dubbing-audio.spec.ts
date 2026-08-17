import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  assembleTimedPcm16Wav,
  hasAudiblePcm16Audio,
  parsePcm16Wav,
  splitDubbingSrt,
} from '@/lib/dubbingAudio';
import { isUsableLocalizedTrack } from '@/lib/localizedTrack';
import { generateKokoroDubbingAudio, type KokoroDubbingWorkerLike } from '@/services/kokoroDubbingClient';
import { shouldUseMediaJobMocks } from '@/services/mediaJobMode';
import {
  analyzeVoiceProfile,
  analyzeVoiceProfileFromBlob,
  resolveAzureVoice,
  resolveAzureVoiceChoice,
} from '@/services/voiceProfile';
import {
  buildAzureSpeechSsml,
  synthesizeAzureDubbing,
} from '@/services/azureSpeechProvider';

function makeToneWav(durationMs: number, frequency = 330): Uint8Array {
  const sampleRate = 16_000;
  const samples = Math.round(sampleRate * durationMs / 1000);
  const pcm = new Int16Array(samples);
  for (let index = 0; index < samples; index += 1) {
    pcm[index] = Math.round(Math.sin(index / sampleRate * Math.PI * 2 * frequency) * 9_000);
  }
  const bytes = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  new Int16Array(bytes.buffer, 44).set(pcm);
  return bytes;
}

test('long dubbing text is split on subtitle timing instead of becoming one short audio clip', () => {
  const srt = [
    '1',
    '00:00:00,000 --> 00:00:03,000',
    'Welcome to the first section of this lesson.',
    '',
    '2',
    '00:01:04,000 --> 00:01:08,000',
    'This explanation belongs more than a minute later.',
    '',
  ].join('\n');

  const chunks = splitDubbingSrt(srt, { maxCharacters: 80, maxSpanMs: 20_000 });

  expect(chunks).toEqual([
    expect.objectContaining({ startMs: 0, endMs: 3_000 }),
    expect.objectContaining({ startMs: 64_000, endMs: 68_000 }),
  ]);
});

test('default dubbing chunks stay within natural phrase-sized timing windows', () => {
  const srt = [
    '1',
    '00:00:00,000 --> 00:00:04,000',
    'First complete idea.',
    '',
    '2',
    '00:00:04,300 --> 00:00:08,000',
    'Second complete idea.',
    '',
    '3',
    '00:00:08,300 --> 00:00:13,000',
    'Third complete idea.',
    '',
  ].join('\n');

  const chunks = splitDubbingSrt(srt);

  expect(chunks).toHaveLength(2);
  expect(chunks[0]).toEqual(expect.objectContaining({ startMs: 0, endMs: 8_000 }));
  expect(chunks[1]).toEqual(expect.objectContaining({ startMs: 8_300, endMs: 13_000 }));
});

test('voice profile maps low and high speech registers to different Azure voices', () => {
  const sampleRate = 16_000;
  const tone = (frequency: number) => Float32Array.from(
    { length: sampleRate * 3 },
    (_value, index) => Math.sin(index / sampleRate * Math.PI * 2 * frequency) * 0.3,
  );

  const lower = analyzeVoiceProfile(tone(118), sampleRate);
  const higher = analyzeVoiceProfile(tone(225), sampleRate);

  expect(lower.register).toBe('masculine');
  expect(resolveAzureVoice(lower)).toBe('en-US-AndrewMultilingualNeural');
  expect(higher.register).toBe('feminine');
  expect(resolveAzureVoice(higher)).toBe('en-US-AvaMultilingualNeural');
  expect(lower.confidence).toBeGreaterThan(0.5);
  expect(higher.confidence).toBeGreaterThan(0.5);
});

test('manual voice choice overrides automatic voice analysis', () => {
  const masculine = { register: 'masculine' as const };

  expect(resolveAzureVoiceChoice(masculine, 'auto')).toBe('en-US-AndrewMultilingualNeural');
  expect(resolveAzureVoiceChoice(masculine, 'feminine')).toBe('en-US-AvaMultilingualNeural');
  expect(resolveAzureVoiceChoice({ register: 'uncertain' }, 'auto')).toBe('en-US-AvaMultilingualNeural');
});

test('voice profile can be analyzed from a recorded audio blob without uploading it', async () => {
  const wav = makeToneWav(3_000, 120);
  const profile = await analyzeVoiceProfileFromBlob(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }));

  expect(profile.register).toBe('masculine');
  expect(profile.analyzedDurationMs).toBeGreaterThan(2_900);
});

test('Azure SSML escapes translated text and bounds duration fitting rate', () => {
  const ssml = buildAzureSpeechSsml({
    text: 'Look <here> & continue.',
    voice: 'en-US-AndrewMultilingualNeural',
    sourceDurationMs: 2_000,
    estimatedDurationMs: 3_000,
  });

  expect(ssml).toContain('en-US-AndrewMultilingualNeural');
  expect(ssml).toContain('Look &lt;here&gt; &amp; continue.');
  expect(ssml).toContain('rate="+15%"');
});

test('Azure dubbing assembles audible phrase results on the subtitle timeline', async () => {
  const calls: string[] = [];
  const result = await synthesizeAzureDubbing({
    translatedSrt: [
      '1',
      '00:00:00,000 --> 00:00:03,000',
      'Welcome to the lesson.',
      '',
      '2',
      '00:00:09,000 --> 00:00:12,000',
      'Now continue with the example.',
      '',
    ].join('\n'),
    voice: 'en-US-AvaMultilingualNeural',
    subscriptionKey: 'test-key',
    region: 'eastus',
    fetchImpl: async (_input, init) => {
      calls.push(String(init?.body));
      return new Response(makeToneWav(1_200).buffer as ArrayBuffer, {
        status: 200,
        headers: { 'Content-Type': 'audio/wav' },
      });
    },
  });

  expect(calls).toHaveLength(2);
  expect(result.billableCharacters).toBeGreaterThan(20);
  expect(result.voice).toBe('en-US-AvaMultilingualNeural');
  const parsed = parsePcm16Wav(result.audioBytes);
  expect(parsed.durationMs).toBeGreaterThanOrEqual(12_000);
  const late = parsed.samples.slice(parsed.sampleRate * 9, parsed.sampleRate * 10);
  expect(Array.from(late).some((sample) => Math.abs(sample) > 1_000)).toBe(true);
});

test('Azure dubbing retries transient throttling without duplicating timeline chunks', async () => {
  let attempts = 0;
  const result = await synthesizeAzureDubbing({
    translatedSrt: ['1', '00:00:00,000 --> 00:00:02,000', 'Try again naturally.', ''].join('\n'),
    voice: 'en-US-AndrewMultilingualNeural',
    subscriptionKey: 'test-key',
    region: 'eastus',
    retryBaseDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return new Response('busy', { status: 429 });
      return new Response(makeToneWav(900).buffer as ArrayBuffer, { status: 200 });
    },
  });

  expect(attempts).toBe(2);
  expect(result.chunkCount).toBe(1);
});

test('dubbed wav keeps audible speech at each subtitle position', () => {
  const output = assembleTimedPcm16Wav([
    { startMs: 0, wav: makeToneWav(900) },
    { startMs: 64_000, wav: makeToneWav(900, 440) },
  ], 68_000);
  const parsed = parsePcm16Wav(output);

  expect(parsed.durationMs).toBeGreaterThanOrEqual(68_000);
  expect(hasAudiblePcm16Audio(output)).toBe(true);
  const lateStart = Math.floor(parsed.sampleRate * 64.1) * parsed.channels;
  const lateEnd = Math.floor(parsed.sampleRate * 64.7) * parsed.channels;
  expect(Array.from(parsed.samples.slice(lateStart, lateEnd)).some((sample) => Math.abs(sample) > 1_000)).toBe(true);
});

test('dubbed speech chunks use short edge fades without changing timeline length', () => {
  const output = assembleTimedPcm16Wav([{ startMs: 250, wav: makeToneWav(900) }], 1_500);
  const parsed = parsePcm16Wav(output);
  const start = Math.round(parsed.sampleRate * 0.25) * parsed.channels;
  const middleStart = Math.round(parsed.sampleRate * 0.45) * parsed.channels;
  const middleEnd = Math.round(parsed.sampleRate * 0.55) * parsed.channels;
  const end = Math.round(parsed.sampleRate * 1.15) * parsed.channels - 1;

  expect(parsed.durationMs).toBe(1_500);
  expect(Math.abs(parsed.samples[start])).toBeLessThanOrEqual(1);
  expect(Math.max(...parsed.samples.slice(middleStart, middleEnd).map(Math.abs))).toBeGreaterThan(1_000);
  expect(Math.abs(parsed.samples[end])).toBeLessThan(200);
});

test('localhost uses real media jobs unless mocks are explicitly enabled', () => {
  expect(shouldUseMediaJobMocks(undefined)).toBe(false);
  expect(shouldUseMediaJobMocks('0')).toBe(false);
  expect(shouldUseMediaJobMocks('1')).toBe(true);
});

test('local Kokoro worker result becomes a complete audible dubbing blob', async () => {
  const progress: string[] = [];
  const worker: KokoroDubbingWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      const request = message as { id: string; minimumDurationMs: number };
      queueMicrotask(() => this.onmessage?.({ data: { id: request.id, type: 'progress', stage: 'model', progress: 0.4 } } as MessageEvent));
      queueMicrotask(() => this.onmessage?.({ data: {
        id: request.id,
        type: 'result',
        bytes: assembleTimedPcm16Wav([
          { startMs: 0, wav: makeToneWav(900) },
          { startMs: 64_000, wav: makeToneWav(900, 440) },
        ], request.minimumDurationMs).buffer,
        device: 'webgpu',
      } } as MessageEvent));
    },
    terminate() {},
  };

  const blob = await generateKokoroDubbingAudio([
    '1',
    '00:00:00,000 --> 00:00:03,000',
    'Welcome to the lesson.',
    '',
    '2',
    '00:01:04,000 --> 00:01:08,000',
    'Now we continue with the second section.',
    '',
  ].join('\n'), {
    workerFactory: () => worker,
    onProgress: (value) => progress.push(value.stage),
  });

  expect(blob.type).toBe('audio/wav');
  expect(hasAudiblePcm16Audio(new Uint8Array(await blob.arrayBuffer()))).toBe(true);
  expect(progress).toContain('model');
});

test('legacy mock dubbing tracks cannot mute the original audio', () => {
  expect(isUsableLocalizedTrack({
    id: 'legacy',
    recordingId: 'recording',
    targetLang: 'en',
    status: 'ready',
    createdAt: Date.now(),
    provider: 'mock-asr+mock-dubbing',
    sourceAudioHash: 'hash',
    translatedSrt: 'placeholder',
    audioBlob: new Blob([makeToneWav(900).buffer as ArrayBuffer], { type: 'audio/wav' }),
  })).toBe(false);
});

test('server dubbing provider only translates SRT and never manufactures audio', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/services/dubbingProviders.ts'), 'utf8');
  expect(source).toContain('generateDubbingTranslation');
  expect(source).toContain('deepseek-v4-flash');
  expect(source).not.toContain('makeMockWav');
  expect(source).not.toContain('audioBytes');
  expect(source).not.toContain('OPENAI_API_KEY');
});

test('dubbing job persists Azure voice choice and exposes synthesized audio to the client', () => {
  const submit = fs.readFileSync(path.join(process.cwd(), 'src/app/api/dubbing/submit/route.ts'), 'utf8');
  const status = fs.readFileSync(path.join(process.cwd(), 'src/app/api/dubbing/status/route.ts'), 'utf8');
  const client = fs.readFileSync(path.join(process.cwd(), 'src/services/dubbingClient.ts'), 'utf8');

  expect(submit).toContain('voiceName');
  expect(status).toContain('synthesizeAzureDubbing');
  expect(status).toContain("'audio.wav'");
  expect(client).toContain('status.audioUrl');
});

test('Kokoro uses quantized weights with WebGPU first and WASM fallback', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/workers/kokoroDubbing.worker.ts'), 'utf8');
  expect(source).toMatch(/dtype:\s*'q8',[\s\S]*device:\s*'webgpu'/);
  expect(source).toMatch(/dtype:\s*'q8',[\s\S]*device:\s*'wasm'/);
  expect(source).toContain("env.wasmPaths = '/onnxruntime/'");
});

test('aborting local synthesis terminates the worker and rejects without saving silence', async () => {
  let terminated = false;
  const worker: KokoroDubbingWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage() {},
    terminate() { terminated = true; },
  };
  const controller = new AbortController();
  const pending = generateKokoroDubbingAudio([
    '1',
    '00:00:00,000 --> 00:00:03,000',
    'Welcome to the lesson.',
    '',
  ].join('\n'), { signal: controller.signal, workerFactory: () => worker });
  controller.abort();

  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(terminated).toBe(true);
});
