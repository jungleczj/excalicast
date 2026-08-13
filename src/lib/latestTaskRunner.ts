export class LatestTaskRunner<T> {
  private running = false;
  private pending: T | undefined;
  private pendingWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  private activeController: AbortController | null = null;
  private disposed = false;

  constructor(private readonly task: (value: T, signal: AbortSignal) => Promise<void>) {}

  push(value: T, options: { abortRunning?: boolean } = {}): Promise<void> {
    if (this.disposed) return Promise.reject(new DOMException('Task runner disposed', 'AbortError'));
    this.pending = value;
    if (options.abortRunning ?? true) this.activeController?.abort();
    const promise = new Promise<void>((resolve, reject) => {
      this.pendingWaiters.push({ resolve, reject });
    });
    if (!this.running) void this.drain();
    return promise;
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.pending !== undefined) {
      const value = this.pending;
      const waiters = this.pendingWaiters;
      this.pending = undefined;
      this.pendingWaiters = [];
      const controller = new AbortController();
      this.activeController = controller;
      try {
        await this.task(value, controller.signal);
        waiters.forEach(({ resolve }) => resolve());
      } catch (error) {
        waiters.forEach(({ reject }) => reject(error));
      }
    }
    this.activeController = null;
    this.running = false;
  }

  dispose(): void {
    this.disposed = true;
    this.pending = undefined;
    this.activeController?.abort();
    const error = new DOMException('Task runner disposed', 'AbortError');
    this.pendingWaiters.forEach(({ reject }) => reject(error));
    this.pendingWaiters = [];
  }
}
