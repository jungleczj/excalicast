import {
  recoverMediaTask,
  type MediaTaskKind,
  type MediaTaskRecord,
  type MediaTaskResourceClass,
} from '@/services/mediaTaskDomain';
import type { ExportDiagnosticReport, ExportProgressDetails } from '@/types/exportDiagnostics';

export interface MediaTaskProgress {
  phase: string;
  ratio: number;
  etaMs?: number | null;
  checkpoint?: MediaTaskRecord['checkpoint'];
  details?: ExportProgressDetails | Record<string, unknown>;
  diagnostics?: ExportDiagnosticReport;
}

export interface StartExportTaskInput {
  recordingId: string;
  configSnapshot: object;
}

export interface StartMediaTaskInput {
  recordingId: string;
  kind: MediaTaskKind;
  resourceClass: MediaTaskResourceClass;
  configSnapshot?: object;
}

export interface MediaTaskRunResult {
  resultBlob?: Blob;
  resultRef?: string;
  details?: Record<string, unknown>;
}

export type MediaTaskRunner = (
  report: (progress: MediaTaskProgress) => void,
  signal: AbortSignal,
) => Promise<MediaTaskRunResult | Blob | void>;

export interface CoordinatedMediaTask extends MediaTaskRecord {
  phase?: string;
  resultBlob?: Blob;
  details?: ExportProgressDetails | Record<string, unknown>;
  diagnostics?: ExportDiagnosticReport;
}

interface CoordinatorDependencies {
  persist: (task: MediaTaskRecord) => Promise<void>;
  runExport?: (
    input: StartExportTaskInput,
    report: (progress: MediaTaskProgress) => void,
    signal: AbortSignal,
  ) => Promise<Blob>;
  now?: () => number;
  createId?: () => string;
}

type Listener = (tasks: CoordinatedMediaTask[]) => void;

const clampProgress = (value: number) => Math.max(0, Math.min(1, value));

function normalizeMediaTaskError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error.trim()) return new Error(error.trim());
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; name?: unknown };
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      const normalized = new Error(candidate.message.trim());
      if (typeof candidate.name === 'string' && candidate.name.trim()) normalized.name = candidate.name.trim();
      return normalized;
    }
  }
  return new Error('media_task_failed');
}

export class MediaTaskCoordinator {
  private readonly tasks = new Map<string, CoordinatedMediaTask>();
  private readonly activeByKey = new Map<string, Promise<CoordinatedMediaTask>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly runners = new Map<string, { input: StartMediaTaskInput; runner: MediaTaskRunner }>();
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;
  private readonly createId: () => string;
  private heavyTail: Promise<void> | null = null;

  constructor(private readonly dependencies: CoordinatorDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): CoordinatedMediaTask[] {
    return [...this.tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  hydrate(tasks: MediaTaskRecord[]): void {
    for (const stored of tasks) {
      const recovered = recoverMediaTask(stored, this.now());
      this.tasks.set(recovered.id, recovered);
      if (recovered !== stored) void this.dependencies.persist(recovered).catch(() => undefined);
    }
    this.notify();
  }

  startExport(input: StartExportTaskInput): Promise<CoordinatedMediaTask> {
    if (!this.dependencies.runExport) throw new Error('export_runner_missing');
    const stored = this.snapshot().find((candidate) =>
      candidate.recordingId === input.recordingId
      && candidate.kind === 'export'
      && (candidate.status === 'paused' || candidate.status === 'failed'));
    const executionInput: StartExportTaskInput = stored?.configSnapshot
      ? { recordingId: input.recordingId, configSnapshot: structuredClone(stored.configSnapshot) }
      : { recordingId: input.recordingId, configSnapshot: structuredClone(input.configSnapshot) };
    return this.startTask({
      recordingId: input.recordingId,
      kind: 'export',
      resourceClass: 'local_heavy',
      configSnapshot: executionInput.configSnapshot,
    }, async (report, signal) => ({
      resultBlob: await this.dependencies.runExport!(executionInput, report, signal),
    }));
  }

  startTask(input: StartMediaTaskInput, runner: MediaTaskRunner): Promise<CoordinatedMediaTask> {
    const activeKey = `${input.recordingId}:${input.kind}`;
    const active = this.activeByKey.get(activeKey);
    if (active) return active;

    const now = this.now();
    const recoverable = this.snapshot().find((candidate) =>
      candidate.recordingId === input.recordingId
      && candidate.kind === input.kind
      && (candidate.status === 'paused' || candidate.status === 'failed'));
    const task: CoordinatedMediaTask = recoverable
      ? {
          ...recoverable,
          status: input.resourceClass === 'local_heavy' && this.heavyTail ? 'queued' : 'running',
          phase: 'preparing',
          resourceClass: input.resourceClass,
          error: undefined,
          updatedAt: now,
        }
      : {
          id: this.createId(),
          recordingId: input.recordingId,
          kind: input.kind,
          status: input.resourceClass === 'local_heavy' && this.heavyTail ? 'queued' : 'running',
          progress: 0,
          phase: 'preparing',
          resourceClass: input.resourceClass,
          configSnapshot: input.configSnapshot
            ? structuredClone(input.configSnapshot) as Record<string, unknown>
            : undefined,
          createdAt: now,
          updatedAt: now,
        };
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    this.runners.set(task.id, { input: { ...input, configSnapshot: task.configSnapshot }, runner });
    this.replaceTask(task);

    const report = (progress: MediaTaskProgress) => {
      const current = this.tasks.get(task.id);
      if (!current || current.status !== 'running') return;
      this.replaceTask({
        ...current,
        phase: progress.phase,
        progress: clampProgress(progress.ratio),
        etaMs: progress.etaMs ?? current.etaMs,
        checkpoint: progress.checkpoint ?? current.checkpoint,
        details: progress.details ?? current.details,
        diagnostics: progress.diagnostics ?? current.diagnostics,
        updatedAt: this.now(),
      });
    };

    const execute = async (): Promise<MediaTaskRunResult | Blob | void> => {
      if (controller.signal.aborted) throw new DOMException('Task cancelled', 'AbortError');
      const current = this.tasks.get(task.id);
      if (current?.status === 'queued') {
        this.replaceTask({ ...current, status: 'running', updatedAt: this.now() });
      }
      return runner(report, controller.signal);
    };
    let execution: Promise<MediaTaskRunResult | Blob | void>;
    if (input.resourceClass === 'local_heavy' && this.heavyTail) {
      execution = this.heavyTail.then(execute, execute);
    } else {
      try {
        execution = Promise.resolve(execute());
      } catch (error) {
        execution = Promise.reject(error);
      }
    }

    const promise = execution.then(async (result) => {
      const normalized = result instanceof Blob ? { resultBlob: result } : (result ?? {});
      const completed: CoordinatedMediaTask = {
        ...(this.tasks.get(task.id) ?? task),
        status: 'completed',
        phase: 'completed',
        progress: 1,
        resultBlob: normalized.resultBlob,
        resultRef: normalized.resultRef,
        details: normalized.details ?? this.tasks.get(task.id)?.details,
        updatedAt: this.now(),
        error: undefined,
      };
      this.replaceTask(completed);
      return completed;
    }).catch(async (error: unknown) => {
      const cancelled = controller.signal.aborted;
      const normalizedError = normalizeMediaTaskError(error);
      const failed: CoordinatedMediaTask = {
        ...(this.tasks.get(task.id) ?? task),
        status: cancelled ? 'cancelled' : 'failed',
        phase: cancelled ? 'cancelled' : (this.tasks.get(task.id)?.phase ?? task.phase ?? 'failed'),
        updatedAt: this.now(),
        error: cancelled ? undefined : normalizedError.message,
      };
      this.replaceTask(failed);
      if (!cancelled) throw normalizedError;
      return failed;
    }).finally(() => {
      this.activeByKey.delete(activeKey);
      this.controllers.delete(task.id);
    });

    this.activeByKey.set(activeKey, promise);
    if (input.resourceClass === 'local_heavy') {
      const tail = promise.then(() => undefined, () => undefined);
      this.heavyTail = tail;
      void tail.finally(() => {
        if (this.heavyTail === tail) this.heavyTail = null;
      });
    }
    return promise;
  }

  cancel(taskId: string): void {
    this.controllers.get(taskId)?.abort();
  }

  retry(taskId: string): Promise<CoordinatedMediaTask> | null {
    const registration = this.runners.get(taskId);
    const task = this.tasks.get(taskId);
    if (!registration || !task || !['failed', 'paused', 'cancelled'].includes(task.status)) return null;
    this.tasks.set(taskId, { ...task, status: 'paused', error: undefined, updatedAt: this.now() });
    this.notify();
    return this.startTask(registration.input, registration.runner);
  }

  dismiss(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.controllers.get(taskId)?.abort();
    this.replaceTask({
      ...task,
      status: 'cancelled',
      phase: 'cancelled',
      updatedAt: this.now(),
      error: undefined,
    });
  }

  private replaceTask(task: CoordinatedMediaTask): void {
    this.tasks.set(task.id, task);
    this.notify();
    const {
      resultBlob: _resultBlob,
      details: _details,
      diagnostics: _diagnostics,
      ...persisted
    } = task;
    // Persistence is task history, not part of the media result or the
    // local-heavy resource lock. Defer it so synchronous storage failures
    // cannot turn an already-produced Blob into a failed export.
    void Promise.resolve()
      .then(() => this.dependencies.persist(persisted))
      .catch(() => undefined);
  }

  private notify(): void {
    const tasks = this.snapshot();
    for (const listener of this.listeners) listener(tasks);
  }
}

export function collectNewlyCompletedTaskIds(
  previous: ReadonlyArray<Pick<MediaTaskRecord, 'id' | 'status'>>,
  next: ReadonlyArray<Pick<MediaTaskRecord, 'id' | 'status'>>,
): string[] {
  const previousStatuses = new Map(previous.map((task) => [task.id, task.status]));
  return next
    .filter((task) => task.status === 'completed' && previousStatuses.get(task.id) !== 'completed')
    .map((task) => task.id);
}
