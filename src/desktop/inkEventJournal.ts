export type DesktopInkEvent =
  | {
      kind: 'scene-delta';
      atUnixMs: number;
      upserts: Record<string, unknown>[];
      deletedIds: string[];
      fileUpserts: Record<string, Record<string, unknown>>;
    }
  | {
      kind: 'viewport';
      atUnixMs: number;
      scrollX: number;
      scrollY: number;
      zoom: number;
    }
  | {
      kind: 'pointer';
      atUnixMs: number;
      x: number;
      y: number;
      tool: string;
      phase: 'down' | 'move' | 'up';
    };

export class DesktopInkEventCollector {
  private readonly elementVersions = new Map<string, string>();
  private readonly fileVersions = new Map<string, string>();
  private readonly queue: DesktopInkEvent[] = [];
  private viewportSignature = '';

  constructor(private readonly capacity = 512) {}

  observeScene(
    elements: readonly Record<string, unknown>[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
    atUnixMs: number,
  ): void {
    const upserts: Record<string, unknown>[] = [];
    const deletedIds: string[] = [];
    for (const element of elements) {
      const id = typeof element.id === 'string' ? element.id : '';
      if (!id) continue;
      const signature = `${String(element.version)}:${String(element.versionNonce)}:${element.isDeleted === true}`;
      if (this.elementVersions.get(id) === signature) continue;
      this.elementVersions.set(id, signature);
      if (element.isDeleted === true) deletedIds.push(id);
      else upserts.push(structuredClone(element));
    }

    const fileUpserts: Record<string, Record<string, unknown>> = {};
    for (const [id, rawFile] of Object.entries(files)) {
      if (!rawFile || typeof rawFile !== 'object') continue;
      const file = rawFile as Record<string, unknown>;
      const signature = `${String(file.id ?? id)}:${String(file.created)}:${String(file.lastRetrieved)}`;
      if (this.fileVersions.get(id) === signature) continue;
      this.fileVersions.set(id, signature);
      fileUpserts[id] = structuredClone(file);
    }

    if (upserts.length > 0 || deletedIds.length > 0 || Object.keys(fileUpserts).length > 0) {
      this.enqueue({ kind: 'scene-delta', atUnixMs, upserts, deletedIds, fileUpserts });
    }

    const scrollX = finiteNumber(appState.scrollX, 0);
    const scrollY = finiteNumber(appState.scrollY, 0);
    const zoomValue = appState.zoom && typeof appState.zoom === 'object'
      ? (appState.zoom as Record<string, unknown>).value
      : appState.zoom;
    const zoom = finiteNumber(zoomValue, 1);
    const viewportSignature = `${scrollX}:${scrollY}:${zoom}`;
    if (viewportSignature !== this.viewportSignature) {
      this.viewportSignature = viewportSignature;
      this.enqueue({ kind: 'viewport', atUnixMs, scrollX, scrollY, zoom });
    }
  }

  recordPointer(
    pointer: Omit<Extract<DesktopInkEvent, { kind: 'pointer' }>, 'kind' | 'atUnixMs'>,
    atUnixMs: number,
  ): void {
    this.enqueue({ kind: 'pointer', atUnixMs, ...pointer });
  }

  drain(maximumCount = 256): DesktopInkEvent[] {
    return this.queue.splice(0, Math.max(0, maximumCount));
  }

  restore(events: readonly DesktopInkEvent[]): void {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      this.queue.unshift(events[index]);
    }
    while (this.queue.length > this.capacity) {
      const disposablePointer = this.queue.findLastIndex(
        (queued) => queued.kind === 'pointer' && queued.phase === 'move',
      );
      this.queue.splice(disposablePointer >= 0 ? disposablePointer : this.queue.length - 1, 1);
    }
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  private enqueue(event: DesktopInkEvent): void {
    if (this.queue.length >= this.capacity) {
      const disposablePointer = this.queue.findIndex(
        (queued) => queued.kind === 'pointer' && queued.phase === 'move',
      );
      this.queue.splice(disposablePointer >= 0 ? disposablePointer : 0, 1);
    }
    this.queue.push(event);
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
