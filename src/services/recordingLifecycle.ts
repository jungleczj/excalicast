interface LifecycleSession<TResult = unknown> {
  recordingId: string;
  stop: (status?: 'done' | 'interrupted') => Promise<TResult>;
}

export class RecordingLifecycleCoordinator<
  TSession extends LifecycleSession<TResult>,
  TResult = Awaited<ReturnType<TSession['stop']>>,
> {
  private session: TSession | null = null;
  private finalization: Promise<TResult | null> | null = null;

  attach(session: TSession): void {
    if (this.session && this.session !== session) {
      throw new Error(`recording_already_active:${this.session.recordingId}`);
    }
    this.session = session;
  }

  activeSession(): TSession | null {
    return this.session;
  }

  detachView(): void {
    // The media session is application-owned. Route components may come and go
    // without changing the recorder or its hardware tracks.
  }

  stop(status: 'done' | 'interrupted' = 'done'): Promise<TResult | null> {
    if (this.finalization) return this.finalization;
    const current = this.session;
    if (!current) return Promise.resolve(null);

    let stopping: Promise<TResult>;
    try {
      stopping = current.stop(status) as Promise<TResult>;
    } catch (error) {
      stopping = Promise.reject(error);
    }
    this.finalization = stopping.finally(() => {
      if (this.session === current) this.session = null;
      this.finalization = null;
    });
    return this.finalization;
  }
}
