export type DesktopMediaWorkKind =
  | 'director'
  | 'teaching'
  | 'materialize'
  | 'final-render'
  | 'range';

export interface DesktopFinalRenderIdentity {
  readonly requestId: string;
  readonly revision: number;
  readonly intentSha256: string;
}

export interface DesktopMediaWorkSnapshot {
  readonly captureState: 'idle' | 'preparing' | 'recording';
  readonly admission: 'open' | 'capture-priority';
  readonly active: ReadonlyArray<{ kind: DesktopMediaWorkKind; identity: string }>;
  readonly queued: ReadonlyArray<{ kind: Exclude<DesktopMediaWorkKind, 'range'>; identity: string }>;
  readonly finalRenderIdentity: DesktopFinalRenderIdentity | null;
}

export interface DesktopMediaRangeLease {
  readonly signal: AbortSignal;
  release(): void;
}

export interface DesktopCapturePriorityLease {
  release(): void;
}

export class DesktopMediaWorkError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DesktopMediaWorkError';
  }
}

interface WorkEntry<T = unknown> {
  readonly kind: Exclude<DesktopMediaWorkKind, 'range'>;
  readonly identity: string;
  readonly controller: AbortController;
  readonly run: (signal: AbortSignal) => Promise<T> | T;
  readonly promise: Promise<T>;
  readonly settled: Promise<void>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason: unknown): void;
  settle(): void;
  state: 'queued' | 'active' | 'settled';
  finalIdentity?: DesktopFinalRenderIdentity;
}

interface RangeEntry {
  readonly kind: 'range';
  readonly identity: string;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  release(): void;
}

interface FinalFlight {
  readonly identity: DesktopFinalRenderIdentity;
  readonly entry: WorkEntry<unknown>;
}

const FINAL_REQUEST_ID = /^final-r([1-9][0-9]{0,8})-[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const WORK_IDENTITY = /^[^\u0000-\u001f\u007f]{1,256}$/;

function error(code: string): DesktopMediaWorkError {
  return new DesktopMediaWorkError(code);
}

function abortError(code: string): DOMException {
  return new DOMException(code, 'AbortError');
}

function validIdentity(identity: string): boolean {
  return WORK_IDENTITY.test(identity);
}

function sameFinalIdentity(left: DesktopFinalRenderIdentity, right: DesktopFinalRenderIdentity): boolean {
  return left.requestId === right.requestId
    && left.revision === right.revision
    && left.intentSha256 === right.intentSha256;
}

function validateFinalIdentity(identity: DesktopFinalRenderIdentity): void {
  const match = FINAL_REQUEST_ID.exec(identity.requestId);
  if (!match
    || !Number.isSafeInteger(identity.revision)
    || identity.revision < 1
    || Number(match[1]) !== identity.revision
    || !SHA256.test(identity.intentSha256)
    || identity.requestId.slice(-32) !== identity.intentSha256.slice(0, 32)) {
    throw error('desktop_media_final_render_identity_invalid');
  }
}

function waitWithTimeout(operation: Promise<void>, timeoutMs: number, code: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let complete = false;
    const timeout = setTimeout(() => {
      if (complete) return;
      complete = true;
      reject(error(code));
    }, Math.max(0, timeoutMs));
    operation.then(() => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      resolve();
    }, (reason) => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      reject(reason);
    });
  });
}

export class DesktopMediaWorkCoordinator {
  private captureState: DesktopMediaWorkSnapshot['captureState'] = 'idle';
  private admission: DesktopMediaWorkSnapshot['admission'] = 'open';
  private readonly active = new Set<WorkEntry | RangeEntry>();
  private readonly queued: WorkEntry[] = [];
  private finalFlight: FinalFlight | null = null;
  private latestFinalIdentity: DesktopFinalRenderIdentity | null = null;
  private captureLeaseToken: symbol | null = null;

  snapshot(): DesktopMediaWorkSnapshot {
    const activeFinal = [...this.active].find((entry): entry is WorkEntry => (
      entry.kind === 'final-render' && 'finalIdentity' in entry && !!entry.finalIdentity
    ));
    return {
      captureState: this.captureState,
      admission: this.admission,
      active: [...this.active].map(({ kind, identity }) => ({ kind, identity })),
      queued: this.queued.map(({ kind, identity }) => ({ kind, identity })),
      finalRenderIdentity: activeFinal?.finalIdentity ? { ...activeFinal.finalIdentity } : null,
    };
  }

  runWork<T>(input: {
    kind: Exclude<DesktopMediaWorkKind, 'range' | 'final-render'>;
    identity: string;
    run: (signal: AbortSignal) => Promise<T> | T;
  }): Promise<T> {
    if (this.admission !== 'open' || this.captureState !== 'idle') {
      return Promise.reject(error('desktop_media_capture_priority_active'));
    }
    if (!validIdentity(input.identity)) return Promise.reject(error('desktop_media_work_identity_invalid'));
    const entry = this.createEntry(input.kind, input.identity, input.run);
    this.enqueue(entry);
    return entry.promise;
  }

  acquireRangeLease(identity: string): DesktopMediaRangeLease | null {
    if (!validIdentity(identity)
      || this.admission !== 'open'
      || this.captureState !== 'idle'
      || this.queued.length > 0
      || [...this.active].some((entry) => entry.kind !== 'range')) {
      return null;
    }
    const controller = new AbortController();
    let released = false;
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
    const entry: RangeEntry = {
      kind: 'range',
      identity,
      controller,
      settled,
      release: () => {
        if (released) return;
        released = true;
        this.active.delete(entry);
        resolveSettled();
        this.pump();
      },
    };
    this.active.add(entry);
    return { signal: controller.signal, release: entry.release };
  }

  async prepareCapture(options: { timeoutMs?: number } = {}): Promise<DesktopCapturePriorityLease> {
    if (this.captureState !== 'idle' || this.admission !== 'open') {
      throw error('desktop_media_capture_priority_active');
    }
    this.captureState = 'preparing';
    this.admission = 'capture-priority';
    this.cancelQueued(abortError('desktop_media_capture_preempted'));
    const draining = [...this.active];
    for (const entry of draining) {
      entry.controller.abort(abortError('desktop_media_capture_preempted'));
    }
    try {
      await waitWithTimeout(
        Promise.all(draining.map((entry) => entry.settled)).then(() => undefined),
        options.timeoutMs ?? 3_000,
        'desktop_media_capture_drain_timeout',
      );
    } catch (reason) {
      this.captureState = 'idle';
      this.admission = 'open';
      this.pump();
      throw reason;
    }
    const token = Symbol('desktop-capture-lease');
    this.captureLeaseToken = token;
    this.captureState = 'recording';
    let released = false;
    return {
      release: () => {
        if (released || this.captureLeaseToken !== token) return;
        released = true;
        this.captureLeaseToken = null;
        this.captureState = 'idle';
        this.admission = 'open';
        this.pump();
      },
    };
  }

  runFinalRender<T>(input: {
    identity: DesktopFinalRenderIdentity;
    run: (signal: AbortSignal) => Promise<T> | T;
    drainTimeoutMs?: number;
  }): Promise<T> {
    try { validateFinalIdentity(input.identity); }
    catch (reason) { return Promise.reject(reason); }
    if (this.admission !== 'open' || this.captureState !== 'idle') {
      return Promise.reject(error('desktop_media_capture_priority_active'));
    }
    if (this.finalFlight && sameFinalIdentity(this.finalFlight.identity, input.identity)) {
      return this.finalFlight.entry.promise as Promise<T>;
    }
    const reference = this.finalFlight?.identity ?? this.latestFinalIdentity;
    if (reference) {
      if (input.identity.revision < reference.revision) {
        return Promise.reject(error('desktop_media_final_render_revision_stale'));
      }
      if (input.identity.revision === reference.revision && !sameFinalIdentity(reference, input.identity)) {
        return Promise.reject(error('desktop_media_final_render_revision_conflict'));
      }
    }

    const previous = this.finalFlight;
    const entry = this.createEntry('final-render', input.identity.requestId, input.run);
    entry.finalIdentity = { ...input.identity };
    const flight: FinalFlight = { identity: { ...input.identity }, entry: entry as WorkEntry<unknown> };
    this.finalFlight = flight;
    this.latestFinalIdentity = { ...input.identity };
    if (!previous) {
      this.enqueue(entry);
    } else {
      previous.entry.controller.abort(abortError('desktop_media_final_render_superseded'));
      if (previous.entry.state === 'queued') this.removeQueued(previous.entry);
      void this.enqueueAfterDrain(
        entry,
        previous.entry.settled,
        input.drainTimeoutMs ?? 3_000,
        flight,
      );
    }
    return entry.promise;
  }

  private createEntry<T>(
    kind: Exclude<DesktopMediaWorkKind, 'range'>,
    identity: string,
    run: (signal: AbortSignal) => Promise<T> | T,
  ): WorkEntry<T> {
    const controller = new AbortController();
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    let settle!: () => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const settled = new Promise<void>((resolveSettled) => { settle = resolveSettled; });
    return {
      kind,
      identity,
      controller,
      run,
      promise,
      settled,
      resolve,
      reject,
      settle,
      state: 'queued',
    };
  }

  private enqueue(entry: WorkEntry): void {
    if (entry.state === 'settled') return;
    entry.state = 'queued';
    this.queued.push(entry);
    this.pump();
  }

  private async enqueueAfterDrain(
    entry: WorkEntry,
    drained: Promise<void>,
    timeoutMs: number,
    flight: FinalFlight,
  ): Promise<void> {
    try {
      await waitWithTimeout(drained, timeoutMs, 'desktop_media_final_render_drain_timeout');
      if (entry.controller.signal.aborted) {
        this.settleCancelled(entry);
        return;
      }
      if (this.finalFlight !== flight) {
        this.settleCancelled(entry);
        return;
      }
      if (this.admission !== 'open' || this.captureState !== 'idle') {
        this.settleRejected(entry, error('desktop_media_capture_priority_active'));
        return;
      }
      this.enqueue(entry);
    } catch (reason) {
      this.settleRejected(entry, reason);
    }
  }

  private pump(): void {
    if (this.captureState !== 'idle'
      || this.admission !== 'open'
      || this.active.size > 0
      || this.queued.length < 1) return;
    const entry = this.queued.shift();
    if (!entry) return;
    if (entry.controller.signal.aborted) {
      this.settleCancelled(entry);
      this.pump();
      return;
    }
    entry.state = 'active';
    this.active.add(entry);
    void this.execute(entry);
  }

  private async execute<T>(entry: WorkEntry<T>): Promise<void> {
    let outcome: { ok: true; value: T } | { ok: false; reason: unknown };
    try {
      if (entry.controller.signal.aborted) throw entry.controller.signal.reason;
      outcome = { ok: true, value: await entry.run(entry.controller.signal) };
    } catch (reason) {
      outcome = { ok: false, reason };
    }
    entry.state = 'settled';
    this.active.delete(entry);
    entry.settle();
    this.clearFinalFlight(entry);
    this.pump();
    if (outcome.ok) entry.resolve(outcome.value);
    else entry.reject(outcome.reason);
  }

  private cancelQueued(reason: DOMException): void {
    for (const entry of this.queued.splice(0)) {
      entry.controller.abort(reason);
      this.settleCancelled(entry);
    }
  }

  private removeQueued(entry: WorkEntry): void {
    const index = this.queued.indexOf(entry);
    if (index >= 0) this.queued.splice(index, 1);
    this.settleCancelled(entry);
  }

  private settleCancelled(entry: WorkEntry): void {
    this.settleRejected(
      entry,
      entry.controller.signal.reason ?? abortError('desktop_media_work_cancelled'),
    );
  }

  private settleRejected(entry: WorkEntry, reason: unknown): void {
    if (entry.state === 'settled') return;
    entry.state = 'settled';
    entry.settle();
    this.clearFinalFlight(entry);
    entry.reject(reason);
  }

  private clearFinalFlight(entry: WorkEntry): void {
    if (this.finalFlight?.entry === entry) this.finalFlight = null;
  }
}
