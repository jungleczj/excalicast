import 'server-only';

export type DubbingJobStatus = 'pending' | 'running' | 'done' | 'failed';
export type DubbingLipSyncStatus = 'done' | 'skipped' | 'failed';

export interface DubbingJob {
  id: string;
  userId: string;
  recordingId: string;
  targetLang: 'en';
  sourceAudioHash: string;
  audioToken?: string;
  audioType?: string;
  sourceSrt?: string;
  status: DubbingJobStatus;
  createdAt: number;
  updatedAt: number;
  audioBytes: Uint8Array;
  cameraBytes?: Uint8Array;
  translatedSrt?: string;
  dubbedAudio?: Uint8Array;
  dubbedAudioType?: string;
  lipSyncCamera?: Uint8Array;
  lipSyncCameraType?: string;
  lipSync?: DubbingLipSyncStatus;
  provider?: string;
  error?: string;
}

const TTL_MS = 30 * 60 * 1000;
const jobs = new Map<string, DubbingJob>();

function prune(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff) jobs.delete(id);
  }
}

export function createDubbingJob(job: DubbingJob): void {
  prune();
  jobs.set(job.id, job);
}

export function getDubbingJob(id: string): DubbingJob | undefined {
  prune();
  return jobs.get(id);
}

export function getDubbingJobByAudioToken(token: string): DubbingJob | undefined {
  prune();
  for (const job of jobs.values()) {
    if (job.audioToken === token) return job;
  }
  return undefined;
}

export function updateDubbingJob(id: string, patch: Partial<Omit<DubbingJob, 'id'>>): DubbingJob | undefined {
  const current = getDubbingJob(id);
  if (!current) return undefined;
  const next = { ...current, ...patch, updatedAt: Date.now() };
  jobs.set(id, next);
  return next;
}
