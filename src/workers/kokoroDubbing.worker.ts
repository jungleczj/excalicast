/// <reference lib="webworker" />

import { env, KokoroTTS } from 'kokoro-js';
import { assembleTimedPcm16Wav, type DubbingSpeechChunk } from '@/lib/dubbingAudio';

declare const self: DedicatedWorkerGlobalScope;

env.wasmPaths = '/onnxruntime/';

interface GenerateMessage {
  id: string;
  type: 'generate';
  chunks: DubbingSpeechChunk[];
  minimumDurationMs: number;
  voice: string;
  speed: number;
}

type Device = 'webgpu' | 'wasm';

function postProgress(id: string, stage: 'model' | 'synthesis' | 'assembling', progress: number, extra: Record<string, unknown> = {}) {
  self.postMessage({ id, type: 'progress', stage, progress, ...extra });
}

function normalizedModelProgress(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as { progress?: unknown; loaded?: unknown; total?: unknown };
  if (typeof input.progress === 'number') return input.progress > 1 ? input.progress / 100 : input.progress;
  if (typeof input.loaded === 'number' && typeof input.total === 'number' && input.total > 0) return input.loaded / input.total;
  return null;
}

async function loadModel(id: string): Promise<{ tts: KokoroTTS; device: Device }> {
  const hasWebGpu = 'gpu' in self.navigator;
  if (hasWebGpu) {
    try {
      const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8',
        device: 'webgpu',
        progress_callback: (value) => {
          const progress = normalizedModelProgress(value);
          if (progress !== null) postProgress(id, 'model', progress * 0.9, { device: 'webgpu' });
        },
      });
      postProgress(id, 'model', 1, { device: 'webgpu' });
      return { tts, device: 'webgpu' };
    } catch {
      postProgress(id, 'model', 0, { device: 'wasm' });
    }
  }
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (value) => {
      const progress = normalizedModelProgress(value);
      if (progress !== null) postProgress(id, 'model', progress * 0.9, { device: 'wasm' });
    },
  });
  postProgress(id, 'model', 1, { device: 'wasm' });
  return { tts, device: 'wasm' };
}

self.onmessage = async (event: MessageEvent<GenerateMessage>) => {
  const message = event.data;
  if (!message || message.type !== 'generate') return;
  try {
    const { tts, device } = await loadModel(message.id);
    const rendered: Array<{ startMs: number; wav: Uint8Array }> = [];
    for (let index = 0; index < message.chunks.length; index += 1) {
      const chunk = message.chunks[index];
      const audio = await tts.generate(chunk.text, {
        voice: message.voice as Parameters<KokoroTTS['generate']>[1] extends { voice?: infer Voice } ? Voice : never,
        speed: message.speed,
      });
      rendered.push({ startMs: chunk.startMs, wav: new Uint8Array(audio.toWav()) });
      postProgress(message.id, 'synthesis', (index + 1) / message.chunks.length, {
        device,
        completedChunks: index + 1,
        totalChunks: message.chunks.length,
      });
    }
    postProgress(message.id, 'assembling', 0.5, { device });
    const bytes = assembleTimedPcm16Wav(rendered, message.minimumDurationMs);
    postProgress(message.id, 'assembling', 1, { device });
    self.postMessage({ id: message.id, type: 'result', bytes: bytes.buffer, device }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({
      id: message.id,
      type: 'error',
      error: error instanceof Error ? error.message : 'kokoro_generation_failed',
    });
  }
};

export {};
