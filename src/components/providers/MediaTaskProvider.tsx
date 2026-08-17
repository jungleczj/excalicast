'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { listRecoverableMediaTasks, saveMediaTask } from '@/lib/db-client';
import {
  MediaTaskCoordinator,
  collectNewlyCompletedTaskIds,
  type CoordinatedMediaTask,
  type MediaTaskRunner,
  type StartMediaTaskInput,
  type StartExportTaskInput,
} from '@/services/mediaTaskCoordinator';
import type { ExportConfig } from '@/types/recording';
import type { MediaTaskKind, MediaTaskStatus } from '@/services/mediaTaskDomain';

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
const subscribeCoordinator = (listener: () => void) => coordinator.subscribe(() => listener());

async function waitForRemoteTask(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Task cancelled', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = window.setTimeout(finish, ms);
    const abort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Task cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function resumeRecoveredRemoteTask(task: CoordinatedMediaTask): void {
  if (task.kind === 'asr' && typeof task.checkpoint?.remoteJobId === 'string') {
    const remoteJobId = task.checkpoint.remoteJobId;
    void coordinator.startTask({ recordingId: task.recordingId, kind: 'asr', resourceClass: 'network' }, async (report, signal) => {
      const { pollSubtitleJob } = await import('@/services/subtitleClient');
      const { saveSubtitleSrt } = await import('@/lib/db-client');
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const result = await pollSubtitleJob(remoteJobId);
        if (result.status === 'failed') throw new Error(result.error ?? 'subtitle_failed');
        if (result.status === 'done') {
          const srt = result.srt?.trim() ?? '';
          if (!srt) throw new Error('subtitle_empty');
          report({ phase: 'saving', ratio: 0.96, checkpoint: { remoteJobId } });
          await saveSubtitleSrt(task.recordingId, srt);
          window.dispatchEvent(new CustomEvent('excalicast:subtitle-saved', { detail: { recordingId: task.recordingId, srt } }));
          return { resultRef: `subtitle:${task.recordingId}` };
        }
        report({ phase: result.status, ratio: result.status === 'running' ? 0.65 : 0.28, checkpoint: { remoteJobId } });
        await waitForRemoteTask(2_500, signal);
      }
      throw new Error('subtitle_timeout');
    }).catch(() => undefined);
    return;
  }
  if (
    task.kind === 'dubbing'
    && typeof task.checkpoint?.remoteJobId === 'string'
    && typeof task.checkpoint?.sourceAudioHash === 'string'
  ) {
    const remoteJobId = task.checkpoint.remoteJobId;
    const sourceAudioHash = task.checkpoint.sourceAudioHash;
    void coordinator.startTask({ recordingId: task.recordingId, kind: 'dubbing', resourceClass: 'network' }, async (report, signal) => {
      const { resumeEnglishDubbingTrack } = await import('@/services/dubbingClient');
      const track = await resumeEnglishDubbingTrack({
        recordingId: task.recordingId,
        jobId: remoteJobId,
        sourceAudioHash,
        signal,
        persistTask: false,
        onProgress: (progress) => report({
          phase: progress.stage,
          ratio: progress.progress,
          checkpoint: { remoteJobId, sourceAudioHash },
        }),
      });
      window.dispatchEvent(new CustomEvent('excalicast:dubbing-ready', { detail: { recordingId: task.recordingId, track } }));
      return { resultRef: track.id };
    }).catch(() => undefined);
  }
}

interface MediaTaskContextValue {
  tasks: CoordinatedMediaTask[];
  startExport: (input: StartExportTaskInput & { configSnapshot: ExportConfig }) => Promise<CoordinatedMediaTask>;
  startTask: (input: StartMediaTaskInput, runner: MediaTaskRunner) => Promise<CoordinatedMediaTask>;
  cancelTask: (taskId: string) => void;
  retryTask: (taskId: string) => Promise<CoordinatedMediaTask> | null;
  dismissTask: (taskId: string) => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
}

interface MediaTaskActionsContextValue {
  startExport: MediaTaskContextValue['startExport'];
  startTask: MediaTaskContextValue['startTask'];
  cancelTask: MediaTaskContextValue['cancelTask'];
  retryTask: MediaTaskContextValue['retryTask'];
  dismissTask: MediaTaskContextValue['dismissTask'];
  findTask: (recordingId: string, kind: MediaTaskKind) => CoordinatedMediaTask | undefined;
}

const MediaTaskContext = createContext<MediaTaskContextValue | null>(null);
const MediaTaskActionsContext = createContext<MediaTaskActionsContextValue | null>(null);

export function MediaTaskProvider({ children }: { children: ReactNode }): JSX.Element {
  const [tasks, setTasks] = useState<CoordinatedMediaTask[]>(() => coordinator.snapshot());
  const [soundEnabled, setSoundEnabledState] = useState(true);
  const previousTasksRef = useRef<CoordinatedMediaTask[]>(coordinator.snapshot());
  const audioContextRef = useRef<AudioContext | null>(null);
  const cueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playCompletionCue = useCallback(() => {
    const context = audioContextRef.current;
    if (!context || context.state === 'closed') return;
    void context.resume().then(() => {
      const startedAt = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(0.09, startedAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.34);
      gain.connect(context.destination);
      [659.25, 880].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(startedAt + index * 0.08);
        oscillator.stop(startedAt + 0.34);
      });
    }).catch(() => undefined);
  }, []);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled);
    try { localStorage.setItem('excalicast.mediaTaskSound', enabled ? '1' : '0'); } catch { /* unavailable */ }
  }, []);

  useEffect(() => coordinator.subscribe(setTasks), []);

  useEffect(() => {
    try { setSoundEnabledState(localStorage.getItem('excalicast.mediaTaskSound') !== '0'); } catch { /* unavailable */ }
    const primeAudio = () => {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        const Context = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Context) audioContextRef.current = new Context();
      }
      void audioContextRef.current?.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', primeAudio, { once: true, capture: true });
    window.addEventListener('keydown', primeAudio, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', primeAudio, { capture: true });
      window.removeEventListener('keydown', primeAudio, { capture: true });
      if (cueTimerRef.current) clearTimeout(cueTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const completed = collectNewlyCompletedTaskIds(previousTasksRef.current, tasks);
    previousTasksRef.current = tasks;
    if (!soundEnabled || completed.length === 0) return;
    if (cueTimerRef.current) clearTimeout(cueTimerRef.current);
    cueTimerRef.current = setTimeout(() => {
      cueTimerRef.current = null;
      playCompletionCue();
    }, 180);
  }, [playCompletionCue, soundEnabled, tasks]);

  useEffect(() => {
    let cancelled = false;
    void listRecoverableMediaTasks().then((stored) => {
      if (cancelled) return;
      coordinator.hydrate(stored);
      coordinator.snapshot().filter((task) => task.status === 'paused').forEach(resumeRecoveredRemoteTask);
    }).catch((error) => {
      console.error('[media-task] recovery failed', error);
    });
    return () => { cancelled = true; };
  }, []);

  const startExport = useCallback((input: StartExportTaskInput & { configSnapshot: ExportConfig }) => coordinator.startExport(input), []);
  const startTask = useCallback((input: StartMediaTaskInput, runner: MediaTaskRunner) => coordinator.startTask(input, runner), []);
  const cancelTask = useCallback((taskId: string) => coordinator.cancel(taskId), []);
  const retryTask = useCallback((taskId: string) => coordinator.retry(taskId), []);
  const dismissTask = useCallback((taskId: string) => coordinator.dismiss(taskId), []);
  const findTask = useCallback((recordingId: string, kind: MediaTaskKind) => coordinator.snapshot().find((task) => (
    task.recordingId === recordingId && task.kind === kind
  )), []);
  const actions = useMemo<MediaTaskActionsContextValue>(() => ({
    startExport, startTask, cancelTask, retryTask, dismissTask, findTask,
  }), [cancelTask, dismissTask, findTask, retryTask, startExport, startTask]);

  const value = useMemo<MediaTaskContextValue>(() => ({
    tasks,
    startExport,
    startTask,
    cancelTask,
    retryTask,
    dismissTask,
    soundEnabled,
    setSoundEnabled,
  }), [cancelTask, dismissTask, retryTask, setSoundEnabled, soundEnabled, startExport, startTask, tasks]);

  return (
    <MediaTaskActionsContext.Provider value={actions}>
      <MediaTaskContext.Provider value={value}>{children}</MediaTaskContext.Provider>
    </MediaTaskActionsContext.Provider>
  );
}

export function useMediaTasks(): MediaTaskContextValue {
  const value = useContext(MediaTaskContext);
  if (!value) throw new Error('useMediaTasks must be used inside MediaTaskProvider');
  return value;
}

export function useMediaTaskActions(): MediaTaskActionsContextValue {
  const value = useContext(MediaTaskActionsContext);
  if (!value) throw new Error('useMediaTaskActions must be used inside MediaTaskProvider');
  return value;
}

export function useMediaTaskStatus(recordingId: string, kind: MediaTaskKind): MediaTaskStatus | undefined {
  return useSyncExternalStore(
    subscribeCoordinator,
    () => coordinator.snapshot().find((task) => task.recordingId === recordingId && task.kind === kind)?.status,
    () => undefined,
  );
}
