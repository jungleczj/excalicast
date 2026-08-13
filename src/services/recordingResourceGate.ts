'use client';

export interface RecordingResourceSnapshot {
  active: boolean;
  recordingIds: string[];
  revision: number;
}

type Listener = (snapshot: RecordingResourceSnapshot) => void;

/**
 * Records capture ownership without throttling or cancelling media work.
 * Noncritical callers may voluntarily wait for idle before starting downloads
 * or polling that would compete with an active recording.
 */
export class RecordingResourceGate {
  private readonly recordings = new Map<string, number>();
  private readonly listeners = new Set<Listener>();
  private readonly idleWaiters = new Set<() => void>();
  private revision = 0;

  acquire(recordingId: string): () => void {
    this.recordings.set(recordingId, (this.recordings.get(recordingId) ?? 0) + 1);
    this.publish();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.recordings.get(recordingId) ?? 0;
      if (count <= 1) this.recordings.delete(recordingId);
      else this.recordings.set(recordingId, count - 1);
      this.publish();
      if (this.isActive()) return;
      for (const resolve of [...this.idleWaiters]) resolve();
      this.idleWaiters.clear();
    };
  }

  isActive(): boolean {
    return this.recordings.size > 0;
  }

  snapshot(): RecordingResourceSnapshot {
    return {
      active: this.isActive(),
      recordingIds: [...this.recordings.keys()],
      revision: this.revision,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  waitUntilIdle(signal?: AbortSignal): Promise<void> {
    if (!this.isActive()) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(new DOMException('Task cancelled', 'AbortError'));
    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener('abort', abort);
        this.idleWaiters.delete(finish);
        resolve();
      };
      const abort = () => {
        this.idleWaiters.delete(finish);
        signal?.removeEventListener('abort', abort);
        reject(new DOMException('Task cancelled', 'AbortError'));
      };
      this.idleWaiters.add(finish);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  private publish(): void {
    this.revision += 1;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export const recordingResourceGate = new RecordingResourceGate();
