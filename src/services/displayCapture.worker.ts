/// <reference lib="webworker" />

import {
  AppendOnlyStreamTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';

type SyncAccessHandle = {
  write(data: BufferSource, options?: { at?: number }): number;
  flush(): void;
  truncate(newSize: number): void;
  close(): void;
};

type WorkerStartMessage = {
  type: 'start';
  recordingId: string;
  path: string;
  stream: ReadableStream<VideoFrame>;
  config: VideoEncoderConfig;
};

type WorkerControlMessage = { type: 'pause' | 'resume' | 'stop' }
  | { type: 'degrade'; level: 'B' | 'C' | 'D' };
type IncomingMessage = WorkerStartMessage | WorkerControlMessage;

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let paused = false;
let stopping = false;
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let encoder: VideoEncoder | null = null;
let finalizePromise: Promise<void> | null = null;
let activeConfig: VideoEncoderConfig | null = null;

async function openSyncHandle(path: string): Promise<SyncAccessHandle> {
  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error('opfs_path_invalid');
  let directory = await navigator.storage.getDirectory();
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  const file = await directory.getFileHandle(fileName, { create: true });
  const syncFile = file as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> };
  const handle = await syncFile.createSyncAccessHandle();
  handle.truncate(0);
  return handle;
}

async function record(message: WorkerStartMessage): Promise<void> {
  const handle = await openSyncHandle(message.path);
  let writeOffset = 0;
  let fragments = 0;
  let droppedFrames = 0;
  let lastTimestamp = 0;
  let lastKeyFrameTimestamp = Number.NEGATIVE_INFINITY;
  let lastWriteMs = 0;
  let pendingFragmentTimestamp = 0;
  let writeChain = Promise.resolve();

  const writable = new WritableStream<Uint8Array>({
    write(data) {
      const startedAt = performance.now();
      const copy = data.slice();
      writeChain = writeChain.then(() => {
        const written = handle.write(copy, { at: writeOffset });
        if (written !== copy.byteLength) throw new Error('opfs_partial_write');
        writeOffset += written;
        lastWriteMs = performance.now() - startedAt;
      });
      return writeChain;
    },
  });
  const format = new Mp4OutputFormat({
    fastStart: 'fragmented',
    minimumFragmentDuration: 2,
    onMoof: (_data, _position, timestamp) => { pendingFragmentTimestamp = timestamp; },
    onMdat: (data, position) => {
      const committedBytes = position + data.byteLength;
      fragments += 1;
      void writeChain.then(() => workerScope.postMessage({
        type: 'checkpoint',
        bytes: writeOffset,
        committedBytes,
        fragments,
        durationMs: Math.max(lastTimestamp / 1_000, pendingFragmentTimestamp * 1_000),
      }));
    },
  });
  const output = new Output({ format, target: new AppendOnlyStreamTarget(writable) });
  const packetSource = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(packetSource);
  await output.start();

  let packetChain = Promise.resolve();
  encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      packetChain = packetChain.then(() => packetSource.add(EncodedPacket.fromEncodedChunk(chunk), metadata));
    },
    error: (error) => workerScope.postMessage({ type: 'error', message: error.message }),
  });
  encoder.configure(message.config);
  activeConfig = message.config;
  reader = message.stream.getReader();
  workerScope.postMessage({ type: 'ready' });

  try {
    while (!stopping) {
      const result = await reader.read();
      if (result.done) break;
      const frame = result.value;
      lastTimestamp = Math.max(lastTimestamp, frame.timestamp);
      try {
        if (paused || encoder.encodeQueueSize > 2) {
          droppedFrames += 1;
          continue;
        }
        const keyFrame = frame.timestamp - lastKeyFrameTimestamp >= 2_000_000;
        if (keyFrame) lastKeyFrameTimestamp = frame.timestamp;
        encoder.encode(frame, { keyFrame });
      } finally {
        // VideoFrame may retain a GPU-backed IOSurface. Never leave cleanup to GC.
        frame.close();
      }
      workerScope.postMessage({
        type: 'pressure',
        encoderQueueSize: encoder.encodeQueueSize,
        pendingWriteBytes: 0,
        oldestWriteAgeMs: lastWriteMs,
        droppedFrames,
      });
    }
  } finally {
    await encoder.flush();
    encoder.close();
    encoder = null;
    await packetChain;
    packetSource.close();
    await output.finalize();
    await writeChain;
    handle.flush();
    handle.close();
    workerScope.postMessage({
      type: 'finalized',
      bytes: writeOffset,
      committedBytes: writeOffset,
      fragments,
      durationMs: lastTimestamp / 1_000,
      droppedFrames,
    });
  }
}

workerScope.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  if (message.type === 'start') {
    paused = false;
    stopping = false;
    finalizePromise = record(message).catch((error: unknown) => {
      workerScope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'capture_worker_failed',
      });
    });
    return;
  }
  if (message.type === 'pause') paused = true;
  if (message.type === 'resume') paused = false;
  if (message.type === 'degrade' && encoder && activeConfig) {
    const scale = message.level === 'B' ? 0.75 : message.level === 'C' ? 0.55 : 0.35;
    activeConfig = {
      ...activeConfig,
      bitrate: Math.max(3_000_000, Math.round((activeConfig.bitrate ?? 8_000_000) * scale)),
      framerate: message.level === 'B' ? 24 : message.level === 'C' ? 20 : 15,
    };
    encoder.configure(activeConfig);
  }
  if (message.type === 'stop') {
    stopping = true;
    void reader?.cancel().catch(() => undefined);
    void finalizePromise;
  }
};

export {};
