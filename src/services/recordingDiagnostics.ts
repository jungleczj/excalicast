'use client';

import type { ChunkWriteMetrics, RecorderTrackKind } from '@/services/mediaRecorderHealth';

export interface RecordingDiagnosticReport {
  schemaVersion: 1;
  recordingId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  media: Partial<Record<RecorderTrackKind, ChunkWriteMetrics>>;
  network: {
    sameOriginRequests: number;
    sameOriginBytes: number;
    wanRequests: number;
    wanBytes: number;
  };
  longTasks: { count: number; totalMs: number; maxMs: number };
  storage?: { usageStart?: number; usageEnd?: number; usageDelta?: number; quota?: number };
}

interface ResourceSample {
  transferSize: number;
  sameOrigin: boolean;
}

export function buildRecordingDiagnosticReport(input: {
  recordingId: string;
  startedAt: number;
  endedAt: number;
  tracks: Partial<Record<RecorderTrackKind, ChunkWriteMetrics>>;
  resources: ResourceSample[];
  longTasks: RecordingDiagnosticReport['longTasks'];
  storage?: RecordingDiagnosticReport['storage'];
}): RecordingDiagnosticReport {
  const network = input.resources.reduce<RecordingDiagnosticReport['network']>((total, resource) => {
    const bytes = Math.max(0, Math.round(resource.transferSize || 0));
    if (resource.sameOrigin) {
      total.sameOriginRequests += 1;
      total.sameOriginBytes += bytes;
    } else {
      total.wanRequests += 1;
      total.wanBytes += bytes;
    }
    return total;
  }, { sameOriginRequests: 0, sameOriginBytes: 0, wanRequests: 0, wanBytes: 0 });
  return {
    schemaVersion: 1,
    recordingId: input.recordingId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: Math.max(0, input.endedAt - input.startedAt),
    media: input.tracks,
    network,
    longTasks: input.longTasks,
    storage: input.storage,
  };
}

const diagnosticKey = (recordingId: string) => `excalicast.recordingDiagnostics.${recordingId}`;

export function loadRecordingDiagnosticReport(recordingId: string): RecordingDiagnosticReport | null {
  try {
    const raw = localStorage.getItem(diagnosticKey(recordingId));
    return raw ? JSON.parse(raw) as RecordingDiagnosticReport : null;
  } catch {
    return null;
  }
}

export class RecordingDiagnosticSession {
  private readonly perfStartedAt = typeof performance === 'undefined' ? 0 : performance.now();
  private readonly storageStart = this.storageEstimate();
  private readonly longTasks = { count: 0, totalMs: 0, maxMs: 0 };
  private observer: PerformanceObserver | null = null;

  constructor(private readonly recordingId: string, private readonly startedAt: number) {
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTasks.count += 1;
          this.longTasks.totalMs += entry.duration;
          this.longTasks.maxMs = Math.max(this.longTasks.maxMs, entry.duration);
        }
      });
      this.observer.observe({ type: 'longtask', buffered: false });
    } catch {
      this.observer = null;
    }
  }

  async finish(tracks: Partial<Record<RecorderTrackKind, ChunkWriteMetrics>>): Promise<RecordingDiagnosticReport> {
    this.observer?.disconnect();
    // Snapshot Resource Timing before awaiting storage estimates. Releasing the
    // recording gate resumes deferred analytics and payment polling immediately;
    // those post-recording requests must not be attributed to the capture.
    const resources = typeof performance === 'undefined'
      ? []
      : performance.getEntriesByType('resource')
          .filter((entry) => entry.startTime >= this.perfStartedAt)
          .map((entry) => {
            const timing = entry as PerformanceResourceTiming;
            let sameOrigin = true;
            try { sameOrigin = new URL(timing.name, location.href).origin === location.origin; } catch { /* aggregate only */ }
            return {
              transferSize: timing.transferSize || timing.encodedBodySize || 0,
              sameOrigin,
            };
          });
    const [storageStart, storageEnd] = await Promise.all([this.storageStart, this.storageEstimate()]);
    const report = buildRecordingDiagnosticReport({
      recordingId: this.recordingId,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      tracks,
      resources,
      longTasks: {
        count: this.longTasks.count,
        totalMs: Math.round(this.longTasks.totalMs),
        maxMs: Math.round(this.longTasks.maxMs),
      },
      storage: {
        usageStart: storageStart?.usage,
        usageEnd: storageEnd?.usage,
        usageDelta: storageStart?.usage !== undefined && storageEnd?.usage !== undefined
          ? storageEnd.usage - storageStart.usage
          : undefined,
        quota: storageEnd?.quota,
      },
    });
    try { localStorage.setItem(diagnosticKey(this.recordingId), JSON.stringify(report)); } catch { /* best effort */ }
    return report;
  }

  dispose(): void {
    this.observer?.disconnect();
  }

  private async storageEstimate(): Promise<StorageEstimate | undefined> {
    try { return await navigator.storage?.estimate?.(); } catch { return undefined; }
  }
}
