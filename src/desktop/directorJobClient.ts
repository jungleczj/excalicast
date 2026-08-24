import {
  DESKTOP_IPC_CHANNELS,
  isDesktopDirectorJobStatus,
  type DesktopDirectorJobStatus,
} from './productContract';

const RECORDING_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export interface DesktopDirectorStatusBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

export interface PollDesktopDirectorJobOptions {
  bridge: DesktopDirectorStatusBridge;
  recordingId: string;
  onStatus(status: DesktopDirectorJobStatus): void;
  signal?: AbortSignal;
  intervalMs?: number;
  wait?: () => Promise<void>;
}

function cloneStatus(value: DesktopDirectorJobStatus): DesktopDirectorJobStatus {
  return {
    ...value,
    ...(value.checkpoint ? { checkpoint: { ...value.checkpoint } } : {}),
    evidence: { ...value.evidence },
  };
}

function waitForPoll(intervalMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('desktop_director_poll_aborted'));
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, intervalMs);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(new Error('desktop_director_poll_aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function pollDesktopDirectorJob(
  options: PollDesktopDirectorJobOptions,
): Promise<DesktopDirectorJobStatus> {
  if (!RECORDING_ID.test(options.recordingId)) throw new Error('desktop_director_status_invalid');
  const wait = options.wait ?? (() => waitForPoll(options.intervalMs ?? 250, options.signal));
  while (true) {
    if (options.signal?.aborted) throw new Error('desktop_director_poll_aborted');
    const response = await options.bridge.invoke(
      DESKTOP_IPC_CHANNELS.projectDirectorStatus,
      { recordingId: options.recordingId },
    );
    if (options.signal?.aborted) throw new Error('desktop_director_poll_aborted');
    if (!isDesktopDirectorJobStatus(response) || response.recordingId !== options.recordingId) {
      throw new Error('desktop_director_status_invalid');
    }
    const status = cloneStatus(response);
    options.onStatus(status);
    if (status.status !== 'pending' && status.status !== 'generating') return status;
    await wait();
  }
}

export async function retryDesktopDirectorJob(params: {
  bridge: DesktopDirectorStatusBridge;
  recordingId: string;
}): Promise<DesktopDirectorJobStatus> {
  if (!RECORDING_ID.test(params.recordingId)) throw new Error('desktop_director_retry_invalid');
  const response = await params.bridge.invoke(
    DESKTOP_IPC_CHANNELS.projectDirectorRetry,
    { recordingId: params.recordingId },
  );
  if (!isDesktopDirectorJobStatus(response) || response.recordingId !== params.recordingId) {
    throw new Error('desktop_director_retry_invalid');
  }
  return cloneStatus(response);
}
