'use client';

import { v4 as uuidv4 } from 'uuid';
import { getClientDb } from '@/lib/db-client';
import { startAudioRecorder, type AudioRecorderHandle } from '@/services/audioRecorder';
import { startCameraRecorder, type CameraHandle } from '@/services/cameraRecorder';
import type { RecordingMetadata } from '@/types/recording';

export interface SessionHandle {
  recordingId: string;
  startedAt: number;
  hasAudio: boolean;
  hasCamera: boolean;
  cameraStream: MediaStream | null;
  onWhiteboardChange: (
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
  ) => void;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<RecordingMetadata>;
  getElapsedMs: () => number;
}

export interface StartOptions {
  withCamera: boolean;
}

const SNAPSHOT_THROTTLE_MS = 50;

export async function startRecording(opts: StartOptions): Promise<SessionHandle> {
  const recordingId = uuidv4();
  const startedAt = Date.now();
  const db = getClientDb();

  await db.recordings.put({
    id: recordingId,
    startedAt,
    durationMs: 0,
    hasAudio: false,
    hasCamera: false,
    status: 'recording',
  });

  let audio: AudioRecorderHandle | null = null;
  try { audio = await startAudioRecorder(recordingId); } catch { audio = null; }
  const hasAudio = audio !== null;
  if (hasAudio) await db.recordings.update(recordingId, { hasAudio: true });

  let camera: CameraHandle | null = null;
  if (opts.withCamera) {
    try { camera = await startCameraRecorder(recordingId); } catch { camera = null; }
  }
  const hasCamera = camera !== null;
  if (hasCamera) await db.recordings.update(recordingId, { hasCamera: true });

  const writtenFileIds = new Set<string>();
  let lastSnapshotAt = -Infinity;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSnapshot: { elements: unknown[]; appState: Record<string, unknown>; t: number } | null = null;
  let paused = false;
  let pauseStartedAt = 0;
  let pausedTotal = 0;

  const flushSnapshot = async () => {
    if (!pendingSnapshot) return;
    const snap = pendingSnapshot;
    pendingSnapshot = null;
    pendingTimer = null;
    lastSnapshotAt = snap.t;
    await db.snapshots.add({
      recordingId,
      timestamp: snap.t,
      elements: snap.elements,
      appState: snap.appState,
    });
  };

  const elapsed = () => Date.now() - startedAt - pausedTotal - (paused ? Date.now() - pauseStartedAt : 0);

  return {
    recordingId,
    startedAt,
    hasAudio,
    hasCamera,
    cameraStream: camera?.stream ?? null,
    getElapsedMs: elapsed,
    onWhiteboardChange(elements, appState, files) {
      if (paused) return;
      const t = elapsed();

      if (files && typeof files === 'object') {
        for (const [fileId, data] of Object.entries(files)) {
          if (writtenFileIds.has(fileId)) continue;
          writtenFileIds.add(fileId);
          db.binaryFiles.add({ recordingId, fileId, data }).catch(() => { /* ignore */ });
        }
      }

      pendingSnapshot = {
        t,
        elements: structuredClone(elements as unknown[]),
        appState: structuredClone(appState),
      };

      if (t - lastSnapshotAt < SNAPSHOT_THROTTLE_MS) {
        if (pendingTimer === null) {
          pendingTimer = setTimeout(() => { void flushSnapshot(); }, SNAPSHOT_THROTTLE_MS);
        }
        return;
      }
      void flushSnapshot();
    },
    pause() {
      if (paused) return;
      paused = true;
      pauseStartedAt = Date.now();
      camera?.pause();
    },
    resume() {
      if (!paused) return;
      pausedTotal += Date.now() - pauseStartedAt;
      paused = false;
      camera?.resume();
    },
    async stop() {
      if (paused) {
        pausedTotal += Date.now() - pauseStartedAt;
        paused = false;
      }
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        await flushSnapshot();
      }
      if (audio) { try { await audio.stop(); } catch { /* ignore */ } }
      if (camera) { try { await camera.stop(); } catch { /* ignore */ } }
      const durationMs = Date.now() - startedAt - pausedTotal;
      await db.recordings.update(recordingId, {
        durationMs,
        status: 'done',
      });
      const meta = await db.recordings.get(recordingId);
      if (!meta) throw new Error('recording_lost_after_stop');
      return meta;
    },
  };
}
