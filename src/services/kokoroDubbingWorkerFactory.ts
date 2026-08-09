'use client';

import type { KokoroDubbingWorkerLike } from '@/services/kokoroDubbingClient';

export function createKokoroDubbingWorker(): KokoroDubbingWorkerLike {
  return new Worker(new URL('../workers/kokoroDubbing.worker.ts', import.meta.url), { type: 'module' });
}
