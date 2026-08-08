'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { listRecoverableMediaTasks, saveMediaTask } from '@/lib/db-client';
import {
  MediaTaskCoordinator,
  type CoordinatedMediaTask,
  type StartExportTaskInput,
} from '@/services/mediaTaskCoordinator';
import type { ExportConfig } from '@/types/recording';

const coordinator = new MediaTaskCoordinator({
  persist: saveMediaTask,
  runExport: async (input, report, signal) => {
    const { exportRecording } = await import('@/services/exportPipeline');
    const config = input.configSnapshot as unknown as ExportConfig;
    let phase = 'preparing';
    let ratio = 0;
    return exportRecording({
      ...config,
      recordingId: input.recordingId,
      signal,
      onPhase: (nextPhase) => {
        phase = nextPhase;
        report({ phase, ratio });
      },
      onProgress: (nextRatio) => {
        ratio = nextRatio;
        report({ phase, ratio });
      },
      onProgressDetails: (details) => {
        phase = details.phase;
        ratio = details.ratio;
        const fps = Math.max(1, Number(config.fps ?? 15));
        report({
          phase,
          ratio,
          details,
          checkpoint: {
            processedFrames: details.processedFrames,
            segmentIndex: Math.floor(details.processedFrames / (fps * 10)),
          },
        });
      },
      onDiagnostics: (diagnostics) => {
        report({ phase: diagnostics.phase, ratio: diagnostics.ratio, details: diagnostics, diagnostics });
      },
      onLog: (message) => {
        if (process.env.NODE_ENV !== 'production') console.debug('[media-task]', message);
      },
    });
  },
});

interface MediaTaskContextValue {
  tasks: CoordinatedMediaTask[];
  startExport: (input: StartExportTaskInput & { configSnapshot: ExportConfig }) => Promise<CoordinatedMediaTask>;
  cancelTask: (taskId: string) => void;
}

const MediaTaskContext = createContext<MediaTaskContextValue | null>(null);

export function MediaTaskProvider({ children }: { children: ReactNode }): JSX.Element {
  const [tasks, setTasks] = useState<CoordinatedMediaTask[]>(() => coordinator.snapshot());

  useEffect(() => coordinator.subscribe(setTasks), []);

  useEffect(() => {
    let cancelled = false;
    void listRecoverableMediaTasks().then((stored) => {
      if (!cancelled) coordinator.hydrate(stored);
    }).catch((error) => {
      console.error('[media-task] recovery failed', error);
    });
    return () => { cancelled = true; };
  }, []);

  const value = useMemo<MediaTaskContextValue>(() => ({
    tasks,
    startExport: (input) => coordinator.startExport(input),
    cancelTask: (taskId) => coordinator.cancel(taskId),
  }), [tasks]);

  return <MediaTaskContext.Provider value={value}>{children}</MediaTaskContext.Provider>;
}

export function useMediaTasks(): MediaTaskContextValue {
  const value = useContext(MediaTaskContext);
  if (!value) throw new Error('useMediaTasks must be used inside MediaTaskProvider');
  return value;
}
