'use client';

export function createAudioEnhancementWorker(): Worker {
  return new Worker(new URL('../workers/audioEnhancementWorker.ts', import.meta.url), { type: 'module' });
}
