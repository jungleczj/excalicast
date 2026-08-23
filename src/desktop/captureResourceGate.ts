import { DESKTOP_IPC_CHANNELS } from './productContract';

export interface CaptureResourceStatus {
  state: 'idle' | 'recording' | 'stopping';
}

export interface CaptureResourceGateOptions {
  readStatus?: () => Promise<CaptureResourceStatus>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export async function waitForCaptureResourceRelease(
  options: CaptureResourceGateOptions = {},
): Promise<void> {
  const readStatus = options.readStatus ?? readDesktopCaptureStatus;
  const sleep = options.sleep ?? abortableSleep;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  while (true) {
    if (options.signal?.aborted) throw new DOMException('Task cancelled', 'AbortError');
    const status = await readStatus();
    if (status.state === 'idle') return;
    await sleep(pollIntervalMs, options.signal);
  }
}

async function readDesktopCaptureStatus(): Promise<CaptureResourceStatus> {
  if (typeof window === 'undefined') return { state: 'idle' };
  const bridge = (window as Window & {
    excalicastDesktop?: { invoke(channel: string, payload?: unknown): Promise<unknown> };
  }).excalicastDesktop;
  if (!bridge) return { state: 'idle' };
  const response = await bridge.invoke(DESKTOP_IPC_CHANNELS.captureStatus);
  if (!response || typeof response !== 'object') throw new Error('desktop_capture_status_unavailable');
  const state = (response as { state?: unknown }).state;
  if (state !== 'idle' && state !== 'recording' && state !== 'stopping') {
    throw new Error('desktop_capture_status_unavailable');
  }
  return { state };
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Task cancelled', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Task cancelled', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
