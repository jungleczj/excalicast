'use client';

import { getClientDb } from '@/lib/db-client';
import type { ChunkWriteMetrics } from '@/services/mediaRecorderHealth';
import {
  CapturePressureController,
  captureProfileFor,
  detectBrowserCaptureCapabilities,
  preferredVideoEncoderConfigs,
  selectCapturePipeline,
} from '@/services/recordingCapturePolicy';
import { recordingMediaPath } from '@/services/recordingMediaStore';
import type {
  CapturePressureSnapshot,
  RecordingSourceConfig,
  RecordingStorageTrackManifest,
} from '@/types/recording';

type TrackProcessorConstructor = new (options: { track: MediaStreamTrack }) => {
  readable: ReadableStream<VideoFrame>;
};

type WorkerCheckpoint = {
  type: 'checkpoint' | 'finalized';
  bytes: number;
  committedBytes: number;
  fragments: number;
  durationMs: number;
  droppedFrames?: number;
};

type WorkerPressure = Omit<CapturePressureSnapshot, 'mainThreadLagMs'> & { type: 'pressure' };
type WorkerEvent = WorkerCheckpoint | WorkerPressure | { type: 'ready' } | { type: 'error'; message: string };

export interface WebCodecsDisplayHandle {
  sourceStream: MediaStream;
  recordedStream: MediaStream;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  diagnostics: () => ChunkWriteMetrics;
}

function emptyMetrics(): ChunkWriteMetrics {
  return {
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
}

async function supportedAvcConfig(
  sourceStream: MediaStream,
): Promise<VideoEncoderConfig | null> {
  const settings = sourceStream.getVideoTracks()[0]?.getSettings() ?? {};
  const profile = captureProfileFor({
    width: settings.width ?? 1920,
    height: settings.height ?? 1080,
    frameRate: settings.frameRate,
  }, 'adaptive');
  for (const config of preferredVideoEncoderConfigs(profile).filter((candidate) => candidate.codec.startsWith('avc1'))) {
    const result = await VideoEncoder.isConfigSupported(config).catch(() => null);
    if (result?.supported && result.config) return result.config;
  }
  return null;
}

export async function startWebCodecsDisplayRecorder(
  recordingId: string,
  _source: RecordingSourceConfig,
  sourceStream: MediaStream,
): Promise<WebCodecsDisplayHandle | null> {
  if (selectCapturePipeline(detectBrowserCaptureCapabilities()) !== 'webcodecs-opfs') return null;
  // Until the audio processor path is enabled, do not silently discard system/tab audio.
  if (sourceStream.getAudioTracks().length > 0) return null;
  const track = sourceStream.getVideoTracks()[0];
  if (!track) return null;
  const config = await supportedAvcConfig(sourceStream);
  if (!config) return null;

  const Processor = (globalThis as typeof globalThis & {
    MediaStreamTrackProcessor: TrackProcessorConstructor;
  }).MediaStreamTrackProcessor;
  const processor = new Processor({ track });
  const worker = new Worker(new URL('./displayCapture.worker.ts', import.meta.url), { type: 'module' });
  const path = recordingMediaPath(recordingId, 'screen');
  const db = getClientDb();
  const pressureController = new CapturePressureController('A');
  const metrics = emptyMetrics();
  let mainThreadLagMs = 0;
  let stopping = false;
  let endedUnexpectedly = false;
  let finalized: WorkerCheckpoint | null = null;
  let rejectFinalized: ((error: Error) => void) | null = null;
  let resolveFinalized: ((value: WorkerCheckpoint) => void) | null = null;
  const finalizedPromise = new Promise<WorkerCheckpoint>((resolve, reject) => {
    resolveFinalized = resolve;
    rejectFinalized = reject;
  });
  let manifestWriteChain = Promise.resolve();

  const persistManifest = (checkpoint: WorkerCheckpoint, status: RecordingStorageTrackManifest['status']) => {
    manifestWriteChain = manifestWriteChain.catch(() => undefined).then(async () => {
      const metadata = await db.recordings.get(recordingId);
      if (!metadata) return;
      await db.recordings.update(recordingId, {
        mediaStorage: {
          pipeline: 'webcodecs-opfs',
          screen: {
            path,
            mimeType: 'video/mp4',
            bytes: checkpoint.bytes,
            committedBytes: checkpoint.committedBytes,
            fragments: checkpoint.fragments,
            durationMs: checkpoint.durationMs,
            status,
          },
        },
      });
    });
    return manifestWriteChain;
  };

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('capture_worker_start_timeout')), 5_000);
    worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
      const message = event.data;
      if (message.type === 'ready') {
        window.clearTimeout(timeout);
        resolve();
        return;
      }
      if (message.type === 'error') {
        window.clearTimeout(timeout);
        const error = new Error(message.message);
        reject(error);
        rejectFinalized?.(error);
        return;
      }
      if (message.type === 'checkpoint') {
        metrics.chunks = message.fragments;
        metrics.persistedChunks = message.fragments;
        metrics.bytes = message.bytes;
        metrics.persistedBytes = message.committedBytes;
        void persistManifest(message, 'recording');
        return;
      }
      if (message.type === 'pressure') {
        metrics.pendingBytes = message.pendingWriteBytes;
        metrics.maxPendingBytes = Math.max(metrics.maxPendingBytes, message.pendingWriteBytes);
        metrics.oldestPendingAgeMs = message.oldestWriteAgeMs;
        const decision = pressureController.observe({ ...message, mainThreadLagMs });
        if (decision.action === 'degrade') {
          const nextFrameRate = decision.level === 'B' ? 24 : decision.level === 'C' ? 20 : 15;
          void track.applyConstraints({ frameRate: { max: nextFrameRate } }).catch(() => undefined);
          worker.postMessage({ type: 'degrade', level: decision.level });
        }
        if (decision.action === 'stop' && !stopping) {
          stopping = true;
          worker.postMessage({ type: 'stop' });
        }
        return;
      }
      finalized = message;
      void persistManifest(message, endedUnexpectedly ? 'interrupted' : 'done')
        .then(() => resolveFinalized?.(message))
        .catch((error: unknown) => rejectFinalized?.(
          error instanceof Error ? error : new Error('recording_manifest_write_failed'),
        ));
    };
  });

  let expectedTick = performance.now() + 500;
  const lagTimer = window.setInterval(() => {
    const now = performance.now();
    mainThreadLagMs = Math.max(0, now - expectedTick);
    expectedTick = now + 500;
  }, 500);
  track.addEventListener('ended', () => {
    if (!stopping) endedUnexpectedly = true;
  });

  try {
    const readable = processor.readable;
    worker.postMessage({ type: 'start', recordingId, path, stream: readable, config }, [readable]);
    await readyPromise;
    await db.recordings.update(recordingId, {
      mediaStorage: {
        pipeline: 'webcodecs-opfs',
        screen: {
          path,
          mimeType: 'video/mp4',
          bytes: 0,
          committedBytes: 0,
          fragments: 0,
          durationMs: 0,
          status: 'recording',
        },
      },
    });
  } catch {
    window.clearInterval(lagTimer);
    worker.terminate();
    return null;
  }

  return {
    sourceStream,
    recordedStream: sourceStream,
    pause: () => worker.postMessage({ type: 'pause' }),
    resume: () => worker.postMessage({ type: 'resume' }),
    stop: async () => {
      if (!finalized) {
        stopping = true;
        worker.postMessage({ type: 'stop' });
        finalized = await finalizedPromise;
      }
      await manifestWriteChain;
      window.clearInterval(lagTimer);
      sourceStream.getTracks().forEach((streamTrack) => streamTrack.stop());
      worker.terminate();
      if (endedUnexpectedly) throw new Error('screen_track_ended');
    },
    diagnostics: () => ({ ...metrics }),
  };
}
