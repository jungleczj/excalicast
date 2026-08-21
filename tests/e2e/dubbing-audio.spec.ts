import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  assembleTimedPcm16Wav,
  computeNaturalSpeechRatePercent,
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
import { mapWithConcurrency } from '@/utils/asyncPool';
import { resolveDubbingJobStep } from '@/services/dubbingJobState';
import { decodeEdgeMp3ToPcm16Wav } from '@/services/edgeMp3Decoder';

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

function makeConstantWav(durationMs: number, amplitude: number): Uint8Array {
  const sampleRate = 16_000;
  const samples = new Int16Array(Math.round(sampleRate * durationMs / 1000));
  samples.fill(amplitude);
  const bytes = makeToneWav(durationMs);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(44 + index * 2, samples[index], true);
  }
  return bytes;
}

test('bounded async pool preserves output order while limiting concurrent TTS chunks', async () => {
  let active = 0;
  let peak = 0;
  const values = await mapWithConcurrency([30, 5, 20, 1, 10], 2, async (delay, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return `chunk-${index}`;
  });

  expect(peak).toBe(2);
  expect(values).toEqual(['chunk-0', 'chunk-1', 'chunk-2', 'chunk-3', 'chunk-4']);
});

test('real Edge MP3 decodes to clean mono PCM in the Node runtime', async () => {
  const mp3 = new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/edge-tts-clear-speech.mp3')));

  const decoded = await decodeEdgeMp3ToPcm16Wav(mp3);
  const parsed = parsePcm16Wav(decoded.wav);

  expect(decoded.decodeErrors).toEqual([]);
  expect(parsed.sampleRate).toBe(24_000);
  expect(parsed.channels).toBe(1);
  expect(parsed.durationMs).toBeGreaterThan(5_500);
  expect(parsed.durationMs).toBeLessThan(5_800);
  expect(Math.abs(decoded.durationMs - decoded.encodedDurationMs)).toBeLessThanOrEqual(48);
  expect(decoded.metrics.peak).toBeGreaterThan(0.4);
  expect(decoded.metrics.clippedSampleRatio).toBeLessThan(0.001);
  expect(Math.abs(decoded.metrics.dcOffset)).toBeLessThan(0.02);

  const reference = parsePcm16Wav(new Uint8Array(fs.readFileSync(
    path.join(process.cwd(), 'tests/fixtures/edge-tts-clear-speech-reference.wav'),
  )));
  const length = Math.min(parsed.samples.length, reference.samples.length);
  let dot = 0;
  let decodedEnergy = 0;
  let referenceEnergy = 0;
  for (let index = 0; index < length; index += 1) {
    dot += parsed.samples[index] * reference.samples[index];
    decodedEnergy += parsed.samples[index] ** 2;
    referenceEnergy += reference.samples[index] ** 2;
  }
  const correlation = dot / Math.sqrt(decodedEnergy * referenceEnergy);
  expect(correlation).toBeGreaterThan(0.999);
});

test('truncated Edge MP3 is rejected instead of becoming a ready dubbing track', async () => {
  const mp3 = new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/edge-tts-clear-speech.mp3')));
  await expect(decodeEdgeMp3ToPcm16Wav(mp3.slice(0, 180))).rejects.toThrow(/edge_tts/);
});

test('durable dubbing resumes from the persisted translation instead of repeating it', () => {
  const now = 100_000;

  expect(resolveDubbingJobStep({ status: 'pending', updatedAt: 0 }, now)).toBe('translate');
  expect(resolveDubbingJobStep({ status: 'pending', updatedAt: 0, translatedSrt: 'translated' }, now)).toBe('synthesize');
  expect(resolveDubbingJobStep({ status: 'running', updatedAt: now - 5_000, translatedSrt: 'translated' }, now)).toBe('wait');
  expect(resolveDubbingJobStep({ status: 'running', updatedAt: now - 130_000, translatedSrt: 'translated' }, now)).toBe('synthesize');
});

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

test('default dubbing chunks reduce TTS round trips while preserving nearby subtitle timing', () => {
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

  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toEqual(expect.objectContaining({ startMs: 0, endMs: 13_000 }));
});

test('default dubbing chunks preserve meaningful pauses longer than 1.2 seconds', () => {
  const chunks = splitDubbingSrt([
    '1',
    '00:00:00,000 --> 00:00:04,000',
    'Finish the first idea.',
    '',
    '2',
    '00:00:05,300 --> 00:00:09,000',
    'Start the next idea after a pause.',
    '',
  ].join('\n'));

  expect(chunks).toHaveLength(2);
});

test('ten minutes of nearby subtitle cues are grouped into a bounded number of Edge requests', () => {
  const blocks = Array.from({ length: 120 }, (_value, index) => {
    const startSeconds = index * 5;
    const endSeconds = startSeconds + 4;
    const stamp = (seconds: number) => `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},000`;
    return `${index + 1}\n${stamp(startSeconds)} --> ${stamp(endSeconds)}\nA concise translated sentence for this part.`;
  });

  const chunks = splitDubbingSrt(blocks.join('\n\n'));

  expect(chunks.length).toBeLessThanOrEqual(24);
  expect(chunks.every((chunk) => chunk.endMs - chunk.startMs <= 30_000)).toBe(true);
});

test('dubbing status polling is read-only and processing uses the bounded process endpoint', () => {
  const statusRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/dubbing/status/route.ts'), 'utf8');
  const client = fs.readFileSync(path.join(process.cwd(), 'src/services/dubbingClient.ts'), 'utf8');

  expect(statusRoute).not.toContain('synthesizeEdgeTtsDubbing');
  expect(statusRoute).not.toContain('generateDubbingTranslation');
  expect(client).toContain("fetch('/api/dubbing/process'");
});

test('dense translated speech uses a bounded but useful speaking-rate increase', () => {
  const denseText = 'This concise explanation still contains enough words to exceed a very short subtitle cue.';

  const percent = computeNaturalSpeechRatePercent(denseText, 2_500);

  expect(percent).toBeGreaterThan(15);
  expect(percent).toBeLessThanOrEqual(35);
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
  expect(ssml).toContain('rate="+35%"');
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

test('overlong dubbing chunks are sequenced instead of mixed into unreadable speech', () => {
  const output = assembleTimedPcm16Wav([
    { startMs: 0, wav: makeConstantWav(1_000, 7_000) },
    { startMs: 600, wav: makeConstantWav(1_000, -7_000) },
  ]);
  const parsed = parsePcm16Wav(output);

  expect(parsed.durationMs).toBe(2_000);
  expect(parsed.samples[Math.round(parsed.sampleRate * 0.8)]).toBeGreaterThan(6_000);
  expect(parsed.samples[Math.round(parsed.sampleRate * 1.2)]).toBeLessThan(-6_000);
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

test('dubbing job persists voice choice and exposes verified Edge audio to the client', () => {
  const submit = fs.readFileSync(path.join(process.cwd(), 'src/app/api/dubbing/submit/route.ts'), 'utf8');
  const status = fs.readFileSync(path.join(process.cwd(), 'src/app/api/dubbing/status/route.ts'), 'utf8');
  const processRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/dubbing/process/route.ts'), 'utf8');
  const client = fs.readFileSync(path.join(process.cwd(), 'src/services/dubbingClient.ts'), 'utf8');

  expect(submit).toContain('voiceName');
  expect(processRoute).toContain('synthesizeEdgeTtsChunk');
  expect(processRoute).toContain("decoder: 'mpg123-wasm'");
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
