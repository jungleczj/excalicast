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
  pendingBatches: number;
  pendingChunks: number;
  pendingBytes: number;
  maxPendingBatches: number;
  maxPendingChunks: number;
  maxPendingBytes: number;
  oldestPendingAgeMs: number;
  persistedChunks: number;
  persistedBytes: number;
  writeP50Ms: number;
  writeP95Ms: number;
  writeMaxMs: number;
  inputBytesPerSecond: number;
  persistedBytesPerSecond: number;
}

export type ChunkWritePressureLevel = 'high' | 'critical';

interface WaterMark {
  batches: number;
  chunks: number;
  bytes: number;
}

interface PendingBatch<T> {
  items: T[];
  bytes: number;
  enqueuedAt: number;
}

export class ChunkWriteBatcher<T> {
  private queue: T[] = [];
  private queueBytes = 0;
  private queueStartedAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending: PendingBatch<T>[] = [];
  private activeBatch: PendingBatch<T> | null = null;
  private drainPromise: Promise<void> | null = null;
  private failure: unknown = null;
  private pressureLevel: ChunkWritePressureLevel | null = null;
  private firstEnqueuedAt: number | null = null;
  private lastEnqueuedAt: number | null = null;
  private firstPersistedAt: number | null = null;
  private lastPersistedAt: number | null = null;
  private readonly writeDurations: number[] = [];
  private readonly stats: ChunkWriteMetrics = {
    chunks: 0,
    bytes: 0,
    batches: 0,
    queuedChunks: 0,
    maxQueuedChunks: 0,
    totalWriteMs: 0,
    lastWriteMs: 0,
    pendingBatches: 0,
    pendingChunks: 0,
    pendingBytes: 0,
    maxPendingBatches: 0,
    maxPendingChunks: 0,
    maxPendingBytes: 0,
    oldestPendingAgeMs: 0,
    persistedChunks: 0,
    persistedBytes: 0,
    writeP50Ms: 0,
    writeP95Ms: 0,
    writeMaxMs: 0,
    inputBytesPerSecond: 0,
    persistedBytesPerSecond: 0,
  };

  constructor(private readonly options: {
    writeBatch: (items: T[]) => Promise<unknown>;
    sizeOf?: (item: T) => number;
    batchSize?: number;
    flushIntervalMs?: number;
    now?: () => number;
    highWaterMark?: Partial<WaterMark>;
    lowWaterMark?: Partial<WaterMark>;
    criticalWaterMark?: Partial<WaterMark>;
    onPressure?: (level: ChunkWritePressureLevel, metrics: ChunkWriteMetrics) => void;
  }) {}

  enqueue(item: T): void {
    const now = this.now();
    this.firstEnqueuedAt ??= now;
    this.lastEnqueuedAt = now;
    if (this.queue.length === 0) this.queueStartedAt = now;
    const bytes = this.sizeOf(item);
    this.queue.push(item);
    this.queueBytes += bytes;
    this.stats.chunks += 1;
    this.stats.bytes += bytes;
    this.stats.queuedChunks = this.queue.length;
    this.stats.maxQueuedChunks = Math.max(this.stats.maxQueuedChunks, this.queue.length);
    if (this.queue.length >= Math.max(1, this.options.batchSize ?? 4)) {
      this.scheduleBatch();
    } else if (this.timer === null) {
      this.timer = setTimeout(() => this.scheduleBatch(), Math.max(1, this.options.flushIntervalMs ?? 1_000));
    }
    this.updateMetrics();
    this.reportPressure();
  }

  async flush(): Promise<void> {
    this.scheduleBatch();
    while (this.drainPromise) await this.drainPromise;
    if (this.failure) throw this.failure;
  }

  metrics(): ChunkWriteMetrics {
    this.updateMetrics();
    return { ...this.stats };
  }

  private scheduleBatch(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.queue.length === 0) return;
    this.pending.push({
      items: this.queue,
      bytes: this.queueBytes,
      enqueuedAt: this.queueStartedAt ?? this.now(),
    });
    this.queue = [];
    this.queueBytes = 0;
    this.queueStartedAt = null;
    this.stats.queuedChunks = 0;
    this.updateMetrics();
    this.startDrain();
  }

  private startDrain(): void {
    if (this.drainPromise || this.failure) return;
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
      if (this.pending.length > 0 && !this.failure) this.startDrain();
    });
  }

  private async drain(): Promise<void> {
    while (this.pending.length > 0 && !this.failure) {
      const batch = this.pending.shift()!;
      this.activeBatch = batch;
      const startedAt = this.now();
      try {
        await this.options.writeBatch(batch.items);
      } catch (error) {
        this.failure ??= error;
        break;
      }
      const finishedAt = this.now();
      const elapsed = Math.max(0, finishedAt - startedAt);
      this.stats.batches += 1;
      this.stats.persistedChunks += batch.items.length;
      this.stats.persistedBytes += batch.bytes;
      this.stats.lastWriteMs = elapsed;
      this.stats.totalWriteMs += elapsed;
      this.firstPersistedAt ??= startedAt;
      this.lastPersistedAt = finishedAt;
      this.writeDurations.push(elapsed);
      if (this.writeDurations.length > 256) this.writeDurations.shift();
      this.activeBatch = null;
      this.updateMetrics();
      this.reportPressure();
    }
    this.activeBatch = null;
    this.updateMetrics();
  }

  private updateMetrics(): void {
    const batches = [...(this.activeBatch ? [this.activeBatch] : []), ...this.pending];
    const pendingChunks = this.queue.length + batches.reduce((sum, batch) => sum + batch.items.length, 0);
    const pendingBytes = this.queueBytes + batches.reduce((sum, batch) => sum + batch.bytes, 0);
    const pendingStarts = [this.queueStartedAt, ...batches.map((batch) => batch.enqueuedAt)]
      .filter((value): value is number => value !== null);
    const oldestAt = pendingStarts.length > 0 ? Math.min(...pendingStarts) : null;
    this.stats.queuedChunks = this.queue.length;
    this.stats.pendingBatches = batches.length + (this.queue.length > 0 ? 1 : 0);
    this.stats.pendingChunks = pendingChunks;
    this.stats.pendingBytes = pendingBytes;
    this.stats.maxPendingBatches = Math.max(this.stats.maxPendingBatches, this.stats.pendingBatches);
    this.stats.maxPendingChunks = Math.max(this.stats.maxPendingChunks, pendingChunks);
    this.stats.maxPendingBytes = Math.max(this.stats.maxPendingBytes, pendingBytes);
    this.stats.oldestPendingAgeMs = oldestAt === null ? 0 : Math.max(0, this.now() - oldestAt);
    const sorted = [...this.writeDurations].sort((a, b) => a - b);
    const percentile = (ratio: number) => sorted.length === 0
      ? 0
      : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
    this.stats.writeP50Ms = percentile(0.5);
    this.stats.writeP95Ms = percentile(0.95);
    this.stats.writeMaxMs = sorted.at(-1) ?? 0;
    const inputSpan = this.firstEnqueuedAt === null || this.lastEnqueuedAt === null
      ? 0
      : Math.max(1, this.lastEnqueuedAt - this.firstEnqueuedAt);
    const persistedSpan = this.firstPersistedAt === null || this.lastPersistedAt === null
      ? 0
      : Math.max(1, this.lastPersistedAt - this.firstPersistedAt);
    this.stats.inputBytesPerSecond = inputSpan > 0 ? Math.round(this.stats.bytes * 1_000 / inputSpan) : 0;
    this.stats.persistedBytesPerSecond = persistedSpan > 0
      ? Math.round(this.stats.persistedBytes * 1_000 / persistedSpan)
      : 0;
  }

  private reportPressure(): void {
    const high = { batches: 32, chunks: 128, bytes: 128 * 1024 * 1024, ...this.options.highWaterMark };
    const low = { batches: 12, chunks: 48, bytes: 48 * 1024 * 1024, ...this.options.lowWaterMark };
    const critical = { batches: 96, chunks: 384, bytes: 384 * 1024 * 1024, ...this.options.criticalWaterMark };
    const exceeds = (mark: WaterMark) => this.stats.pendingBatches >= mark.batches
      || this.stats.pendingChunks >= mark.chunks
      || this.stats.pendingBytes >= mark.bytes;
    const belowLow = this.stats.pendingBatches <= low.batches
      && this.stats.pendingChunks <= low.chunks
      && this.stats.pendingBytes <= low.bytes;
    const next: ChunkWritePressureLevel | null = exceeds(critical)
      ? 'critical'
      : exceeds(high)
        ? 'high'
        : this.pressureLevel && !belowLow
          ? this.pressureLevel
          : null;
    if (next === this.pressureLevel) return;
    if (next === null) {
      this.pressureLevel = null;
      return;
    }
    if (this.pressureLevel === 'critical') return;
    this.pressureLevel = next;
    this.options.onPressure?.(next, this.metrics());
  }

  private now(): number {
    return (this.options.now ?? (() => performance.now()))();
  }

  private sizeOf(item: T): number {
    return Math.max(0, this.options.sizeOf?.(item) ?? 0);
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
  if (failures.length > 0) throw new Error(`${track}_chunk_write_failed:${failures.length}`);
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
