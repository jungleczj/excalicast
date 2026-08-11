export type MediaTaskKind =
  | 'export'
  | 'asr'
  | 'dubbing'
  | 'cursor_analysis'
  | 'audio_peaks'
  | 'auto_edit'
  | 'noise_reduction'
  | 'key_point_motion';
export type MediaTaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type MediaTaskResourceClass = 'local_heavy' | 'network';

export type ActionAvailability =
  | { state: 'ready' }
  | { state: 'paywall'; tier: 'pro' | 'max' }
  | { state: 'prerequisite'; reason: string; action?: string }
  | { state: 'running'; taskId: string }
  | { state: 'unsupported'; reason: string; alternative?: string };

export interface MediaTaskCheckpoint {
  segmentIndex?: number;
  processedFrames?: number;
  uploadedBytes?: number;
  remoteJobId?: string;
  [key: string]: unknown;
}

export interface MediaTaskRecord {
  id: string;
  recordingId: string;
  kind: MediaTaskKind;
  status: MediaTaskStatus;
  progress: number;
  phase?: string;
  resourceClass?: MediaTaskResourceClass;
  etaMs?: number | null;
  resultRef?: string;
  createdAt: number;
  updatedAt: number;
  checkpoint?: MediaTaskCheckpoint;
  configSnapshot?: Record<string, unknown>;
  error?: string;
  ownerId?: string;
}

export interface ExportTaskSegment {
  index: number;
  startMs: number;
  endMs: number;
}

export function planExportSegments(durationMs: number, segmentDurationMs = 10_000): ExportTaskSegment[] {
  const duration = Math.max(0, Math.round(durationMs));
  const span = Math.max(1_000, Math.round(segmentDurationMs));
  const segments: ExportTaskSegment[] = [];
  for (let startMs = 0, index = 0; startMs < duration; startMs += span, index += 1) {
    segments.push({ index, startMs, endMs: Math.min(duration, startMs + span) });
  }
  return segments;
}

export function recoverMediaTask(task: MediaTaskRecord, now = Date.now()): MediaTaskRecord {
  if (task.status !== 'running') return task;
  const hasCheckpoint = task.checkpoint && Object.keys(task.checkpoint).length > 0;
  if (!hasCheckpoint) {
    return {
      ...task,
      status: 'failed',
      progress: 0,
      updatedAt: now,
      error: 'interrupted_without_checkpoint',
    };
  }
  return {
    ...task,
    status: 'paused',
    updatedAt: now,
    error: 'interrupted',
  };
}
