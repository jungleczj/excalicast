'use client';

import { hasAudiblePcm16Audio, splitDubbingSrt } from '@/lib/dubbingAudio';

export type KokoroDubbingStage = 'model' | 'synthesis' | 'assembling';

export interface KokoroDubbingProgress {
  stage: KokoroDubbingStage;
  progress: number;
  device?: 'webgpu' | 'wasm';
  completedChunks?: number;
  totalChunks?: number;
}

export interface KokoroDubbingWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

interface WorkerProgressMessage extends KokoroDubbingProgress {
  id: string;
  type: 'progress';
}

interface WorkerResultMessage {
  id: string;
  type: 'result';
  bytes: ArrayBuffer;
  device: 'webgpu' | 'wasm';
}

interface WorkerErrorMessage {
  id: string;
  type: 'error';
  error: string;
}

type WorkerMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;

async function createWorker(): Promise<KokoroDubbingWorkerLike> {
  const factory = await import('@/services/kokoroDubbingWorkerFactory');
  return factory.createKokoroDubbingWorker();
}

export async function generateKokoroDubbingAudio(
  translatedSrt: string,
  options: {
    signal?: AbortSignal;
    voice?: string;
    speed?: number;
    onProgress?: (progress: KokoroDubbingProgress) => void;
    workerFactory?: () => KokoroDubbingWorkerLike | Promise<KokoroDubbingWorkerLike>;
  } = {},
): Promise<Blob> {
  if (options.signal?.aborted) throw new DOMException('Dubbing cancelled', 'AbortError');
  const chunks = splitDubbingSrt(translatedSrt);
  const minimumDurationMs = chunks.reduce((maximum, chunk) => Math.max(maximum, chunk.endMs), 0);
  const worker = await (options.workerFactory ?? createWorker)();
  if (options.signal?.aborted) {
    worker.terminate();
    throw new DOMException('Dubbing cancelled', 'AbortError');
  }
  const id = crypto.randomUUID();

  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      worker.terminate();
      action();
    };
    const abort = () => finish(() => reject(new DOMException('Dubbing cancelled', 'AbortError')));
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => finish(() => reject(new Error(event.message || 'kokoro_worker_failed')));
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (!message || message.id !== id) return;
      if (message.type === 'progress') {
        options.onProgress?.({
          stage: message.stage,
          progress: Math.max(0, Math.min(1, message.progress)),
          device: message.device,
          completedChunks: message.completedChunks,
          totalChunks: message.totalChunks,
        });
        return;
      }
      if (message.type === 'error') {
        finish(() => reject(new Error(message.error || 'kokoro_generation_failed')));
        return;
      }
      try {
        const bytes = new Uint8Array(message.bytes);
        if (!hasAudiblePcm16Audio(bytes)) throw new Error('kokoro_generated_silent_audio');
        finish(() => resolve(new Blob([bytes], { type: 'audio/wav' })));
      } catch (error) {
        finish(() => reject(error));
      }
    };
    worker.postMessage({
      id,
      type: 'generate',
      chunks,
      minimumDurationMs,
      voice: options.voice ?? 'af_heart',
      speed: options.speed ?? 1,
    });
  });
}
