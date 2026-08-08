export type RecorderTrackKind = 'audio' | 'camera' | 'screen';

export type ChunkWriteOutcome =
  | { ok: true }
  | { ok: false; error: unknown };

export interface ChunkWriteMetrics {
  chunks: number;
  bytes: number;
  batches: number;
  queuedChunks: number;
  maxQueuedChunks: number;
  totalWriteMs: number;
  lastWriteMs: number;
}

export class ChunkWriteBatcher<T> {
  private queue: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  private readonly stats: ChunkWriteMetrics = {
    chunks: 0,
    bytes: 0,
    batches: 0,
    queuedChunks: 0,
    maxQueuedChunks: 0,
    totalWriteMs: 0,
    lastWriteMs: 0,
  };

  constructor(private readonly options: {
    writeBatch: (items: T[]) => Promise<unknown>;
    sizeOf?: (item: T) => number;
    batchSize?: number;
    flushIntervalMs?: number;
    now?: () => number;
  }) {}

  enqueue(item: T): void {
    this.queue.push(item);
    this.stats.chunks += 1;
    this.stats.bytes += Math.max(0, this.options.sizeOf?.(item) ?? 0);
    this.stats.queuedChunks = this.queue.length;
    this.stats.maxQueuedChunks = Math.max(this.stats.maxQueuedChunks, this.queue.length);
    if (this.queue.length >= Math.max(1, this.options.batchSize ?? 4)) {
      this.scheduleBatch();
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => this.scheduleBatch(), Math.max(1, this.options.flushIntervalMs ?? 1_000));
    }
  }

  private scheduleBatch(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.stats.queuedChunks = 0;
    const now = this.options.now ?? (() => performance.now());
    this.chain = this.chain.then(async () => {
      const startedAt = now();
      await this.options.writeBatch(batch);
      const elapsed = Math.max(0, now() - startedAt);
      this.stats.batches += 1;
      this.stats.lastWriteMs = elapsed;
      this.stats.totalWriteMs += elapsed;
    }).catch((error) => {
      this.failure ??= error;
    });
  }

  async flush(): Promise<void> {
    this.scheduleBatch();
    await this.chain;
    if (this.failure) throw this.failure;
  }

  metrics(): ChunkWriteMetrics {
    return { ...this.stats, queuedChunks: this.queue.length };
  }
}

export function trackChunkWrite(write: Promise<unknown>): Promise<ChunkWriteOutcome> {
  return write.then<ChunkWriteOutcome, ChunkWriteOutcome>(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error }),
  );
}

export async function settleChunkWrites(
  track: RecorderTrackKind,
  writes: Promise<ChunkWriteOutcome>[],
): Promise<void> {
  const results = await Promise.all(writes);
  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    throw new Error(`${track}_chunk_write_failed:${failures.length}`);
  }
}

export function collectRecorderWarnings(entries: Array<{
  track: RecorderTrackKind;
  result: PromiseSettledResult<void>;
}>): string[] {
  return entries.flatMap(({ track, result }) => {
    if (result.status === 'fulfilled') return [];
    const detail = result.reason instanceof Error ? result.reason.message : 'finalization_failed';
    return [`${track}:${detail}`];
  });
}
