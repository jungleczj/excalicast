import { recoverMediaTask, type MediaTaskRecord } from '@/services/mediaTaskDomain';
import type { ExportDiagnosticReport, ExportProgressDetails } from '@/types/exportDiagnostics';

export interface MediaTaskProgress {
  phase: string;
  ratio: number;
  checkpoint?: MediaTaskRecord['checkpoint'];
  details?: ExportProgressDetails;
  diagnostics?: ExportDiagnosticReport;
}

export interface StartExportTaskInput {
  recordingId: string;
  configSnapshot: object;
}

export interface CoordinatedMediaTask extends MediaTaskRecord {
  phase?: string;
  resultBlob?: Blob;
  details?: ExportProgressDetails;
  diagnostics?: ExportDiagnosticReport;
}

interface CoordinatorDependencies {
  persist: (task: MediaTaskRecord) => Promise<void>;
  runExport: (
    input: StartExportTaskInput,
    report: (progress: MediaTaskProgress) => void,
    signal: AbortSignal,
  ) => Promise<Blob>;
  now?: () => number;
  createId?: () => string;
}

type Listener = (tasks: CoordinatedMediaTask[]) => void;

const clampProgress = (value: number) => Math.max(0, Math.min(1, value));

export class MediaTaskCoordinator {
  private readonly tasks = new Map<string, CoordinatedMediaTask>();
  private readonly activeByRecording = new Map<string, Promise<CoordinatedMediaTask>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;
  private readonly createId: () => string;

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
    const active = this.activeByRecording.get(input.recordingId);
    if (active) return active;

    const now = this.now();
    const recoverable = this.snapshot().find((candidate) =>
      candidate.recordingId === input.recordingId
      && candidate.kind === 'export'
      && (candidate.status === 'paused' || candidate.status === 'failed'));
    const task: CoordinatedMediaTask = recoverable
      ? { ...recoverable, status: 'running', phase: 'preparing', error: undefined, updatedAt: now }
      : {
          id: this.createId(),
          recordingId: input.recordingId,
          kind: 'export',
          status: 'running',
          progress: 0,
          phase: 'preparing',
          configSnapshot: structuredClone(input.configSnapshot) as Record<string, unknown>,
          createdAt: now,
          updatedAt: now,
        };
    const executionInput: StartExportTaskInput = recoverable?.configSnapshot
      ? { recordingId: input.recordingId, configSnapshot: structuredClone(recoverable.configSnapshot) }
      : input;
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    this.replaceTask(task);

    const report = (progress: MediaTaskProgress) => {
      const current = this.tasks.get(task.id);
      if (!current || current.status !== 'running') return;
      this.replaceTask({
        ...current,
        phase: progress.phase,
        progress: clampProgress(progress.ratio),
        checkpoint: progress.checkpoint ?? current.checkpoint,
        details: progress.details ?? current.details,
        diagnostics: progress.diagnostics ?? current.diagnostics,
        updatedAt: this.now(),
      });
    };

    let execution: Promise<Blob>;
    try {
      execution = this.dependencies.runExport(executionInput, report, controller.signal);
    } catch (error) {
      execution = Promise.reject(error);
    }

    const promise = execution.then(async (resultBlob) => {
      const completed: CoordinatedMediaTask = {
        ...(this.tasks.get(task.id) ?? task),
        status: 'completed',
        phase: 'completed',
        progress: 1,
        resultBlob,
        updatedAt: this.now(),
        error: undefined,
      };
      await this.replaceTask(completed, true);
      return completed;
    }).catch(async (error: unknown) => {
      const cancelled = controller.signal.aborted;
      const failed: CoordinatedMediaTask = {
        ...(this.tasks.get(task.id) ?? task),
        status: cancelled ? 'cancelled' : 'failed',
        phase: cancelled ? 'cancelled' : 'failed',
        updatedAt: this.now(),
        error: cancelled ? undefined : error instanceof Error ? error.message : 'media_task_failed',
      };
      await this.replaceTask(failed, true);
      if (!cancelled) throw error;
      return failed;
    }).finally(() => {
      this.activeByRecording.delete(input.recordingId);
      this.controllers.delete(task.id);
    });

    this.activeByRecording.set(input.recordingId, promise);
    return promise;
  }

  cancel(taskId: string): void {
    this.controllers.get(taskId)?.abort();
  }

  private replaceTask(task: CoordinatedMediaTask, awaitPersistence = false): Promise<void> | void {
    this.tasks.set(task.id, task);
    this.notify();
    const {
      resultBlob: _resultBlob,
      phase: _phase,
      details: _details,
      diagnostics: _diagnostics,
      ...persisted
    } = task;
    const persistence = this.dependencies.persist(persisted);
    if (awaitPersistence) return persistence;
    void persistence.catch(() => undefined);
  }

  private notify(): void {
    const tasks = this.snapshot();
    for (const listener of this.listeners) listener(tasks);
  }
}
