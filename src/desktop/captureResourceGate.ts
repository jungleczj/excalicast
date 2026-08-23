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

export interface CaptureResourceLease {
  signal: AbortSignal;
  release(): void;
}

interface ActiveCaptureResource {
  controller: AbortController;
  released: Promise<void>;
  release(): void;
}

export class CaptureResourceCoordinator {
  private readonly active = new Set<ActiveCaptureResource>();
  private capturePriority = false;

  acquire(externalSignal?: AbortSignal): CaptureResourceLease {
    if (this.capturePriority) throw new DOMException('capture_priority_active', 'AbortError');
    if (externalSignal?.aborted) {
      throw externalSignal.reason ?? new DOMException('Task cancelled', 'AbortError');
    }
    const controller = new AbortController();
    let resolveReleased: () => void = () => undefined;
    let released = false;
    const releasedPromise = new Promise<void>((resolve) => { resolveReleased = resolve; });
    const onExternalAbort = () => controller.abort(
      externalSignal?.reason ?? new DOMException('Task cancelled', 'AbortError'),
    );
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const resource: ActiveCaptureResource = {
      controller,
      released: releasedPromise,
      release: () => {
        if (released) return;
        released = true;
        externalSignal?.removeEventListener('abort', onExternalAbort);
        this.active.delete(resource);
        resolveReleased();
      },
    };
    this.active.add(resource);
    return { signal: controller.signal, release: resource.release };
  }

  async beginCapturePriority(timeoutMs = 3_000): Promise<void> {
    if (this.capturePriority) throw new Error('capture_priority_already_active');
    this.capturePriority = true;
    const resources = [...this.active];
    for (const resource of resources) {
      resource.controller.abort(new DOMException('capture_resource_preempted', 'AbortError'));
    }
    if (resources.length === 0) return;
    const drained = Promise.all(resources.map((resource) => resource.released)).then(() => true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
    });
    const didDrain = await Promise.race([drained, timedOut]);
    if (timeout) clearTimeout(timeout);
    if (!didDrain) {
      this.capturePriority = false;
      throw new Error('capture_resources_did_not_drain');
    }
  }

  endCapturePriority(): void {
    this.capturePriority = false;
  }

  isCapturePriorityActive(): boolean {
    return this.capturePriority;
  }
}

const sharedCaptureResourceCoordinator = new CaptureResourceCoordinator();

export function tryAcquireCaptureResourceLeaseImmediately(
  signal?: AbortSignal,
): CaptureResourceLease | null {
  if (hasDesktopCaptureBridge() || sharedCaptureResourceCoordinator.isCapturePriorityActive()) {
    return null;
  }
  return sharedCaptureResourceCoordinator.acquire(signal);
}

export async function acquireCaptureResourceLease(
  options: CaptureResourceGateOptions = {},
): Promise<CaptureResourceLease> {
  while (true) {
    await waitForCaptureResourceRelease(options);
    try {
      return sharedCaptureResourceCoordinator.acquire(options.signal);
    } catch (error) {
      if (!(error instanceof DOMException)
        || error.name !== 'AbortError'
        || error.message !== 'capture_priority_active') {
        throw error;
      }
      await abortableSleep(25, options.signal);
    }
  }
}

export async function withCaptureResourceLease<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: CaptureResourceGateOptions = {},
): Promise<T> {
  const lease = await acquireCaptureResourceLease(options);
  try {
    return await operation(lease.signal);
  } finally {
    lease.release();
  }
}

export async function startDesktopCaptureWithResourcePriority<T = unknown>(
  payload: unknown,
  options: {
    coordinator?: CaptureResourceCoordinator;
    invoke?: (channel: string, payload?: unknown) => Promise<T>;
    drainTimeoutMs?: number;
  } = {},
): Promise<T> {
  const coordinator = options.coordinator ?? sharedCaptureResourceCoordinator;
  const invoke = options.invoke ?? invokeDesktop;
  let ownsPriority = false;
  try {
    await coordinator.beginCapturePriority(options.drainTimeoutMs);
    ownsPriority = true;
    return await invoke(DESKTOP_IPC_CHANNELS.captureStart, payload);
  } finally {
    if (ownsPriority) coordinator.endCapturePriority();
  }
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
  if (!hasDesktopCaptureBridge()) return { state: 'idle' };
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

function hasDesktopCaptureBridge(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as Window & { excalicastDesktop?: unknown }).excalicastDesktop;
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (typeof window === 'undefined') throw new Error('desktop_bridge_unavailable');
  const bridge = (window as Window & {
    excalicastDesktop?: { invoke(channel: string, payload?: unknown): Promise<unknown> };
  }).excalicastDesktop;
  if (!bridge) throw new Error('desktop_bridge_unavailable');
  return bridge.invoke(channel, payload) as Promise<T>;
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
