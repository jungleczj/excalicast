'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { I } from '@/components/icons';
import { useMediaTasks } from '@/components/providers/MediaTaskProvider';
import type { MediaTaskKind, MediaTaskStatus } from '@/services/mediaTaskDomain';

const COMPLETE_VISIBLE_MS = 2_400;
const PANEL_GAP = 10;

const TASK_CREATED_EVENT = 'excalicast:media-task-created';
const TASK_OPEN_EVENT = 'excalicast:media-task-open';

interface TaskCreatedDetail {
  recordingId: string;
  sourceRect?: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
}

export function announceMediaTaskCreated(recordingId: string, source?: Element | null): void {
  const rect = source?.getBoundingClientRect();
  window.dispatchEvent(new CustomEvent<TaskCreatedDetail>(TASK_CREATED_EVENT, {
    detail: {
      recordingId,
      sourceRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined,
    },
  }));
}

export function openMediaTaskCenter(recordingId: string): void {
  window.dispatchEvent(new CustomEvent(TASK_OPEN_EVENT, { detail: { recordingId } }));
}

function statusLabel(status: MediaTaskStatus, en: boolean): string {
  const labels: Record<MediaTaskStatus, [string, string]> = {
    queued: ['Waiting', '等待中'],
    running: ['Running', '处理中'],
    paused: ['Paused', '已暂停'],
    completed: ['Done', '已完成'],
    failed: ['Failed', '失败'],
    cancelled: ['Cancelled', '已取消'],
  };
  return labels[status][en ? 0 : 1];
}

function kindLabel(kind: MediaTaskKind, en: boolean): string {
  const labels: Record<MediaTaskKind, [string, string]> = {
    export: ['Export video', '导出视频'],
    asr: ['Generate captions', '生成字幕'],
    dubbing: ['Generate dubbing', '生成配音'],
    cursor_analysis: ['Track focus', '分析聚焦'],
    audio_peaks: ['Build waveform', '生成波形'],
    auto_edit: ['Apply ChatCut', '应用 ChatCut'],
    noise_reduction: ['Remove background noise', '去除背景杂音'],
    key_point_motion: ['Generate key point motion', '生成内容要点动效'],
  };
  return labels[kind][en ? 0 : 1];
}

function formatEta(etaMs?: number | null): string | null {
  if (etaMs == null || etaMs <= 0) return null;
  const seconds = Math.ceil(etaMs / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)}m`;
}

export function MediaTaskCenter({ recordingId, en }: { recordingId: string; en: boolean }): JSX.Element {
  const { tasks, cancelTask, retryTask, dismissTask, soundEnabled, setSoundEnabled } = useMediaTasks();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const visibleTasks = useMemo(() => tasks.filter((task) => (
    task.recordingId === recordingId
    && task.status !== 'cancelled'
    && (task.status !== 'completed' || now - task.updatedAt < COMPLETE_VISIBLE_MS)
  )), [now, recordingId, tasks]);
  const attentionCount = visibleTasks.filter((task) => ['queued', 'running', 'paused', 'failed'].includes(task.status)).length;

  const updatePanelGeometry = useCallback(() => {
    const trigger = buttonRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const side = document.querySelector<HTMLElement>('.editor-craft-side');
    const sideRect = side?.getBoundingClientRect();
    const viewportPadding = 12;
    const availableWidth = sideRect && sideRect.width >= 260
      ? sideRect.width - viewportPadding * 2
      : window.innerWidth - viewportPadding * 2;
    const width = Math.max(260, Math.min(380, availableWidth));
    const rightBoundary = sideRect ? sideRect.right - viewportPadding : window.innerWidth - viewportPadding;
    const leftBoundary = sideRect ? sideRect.left + viewportPadding : viewportPadding;
    const left = Math.max(leftBoundary, Math.min(triggerRect.right - width, rightBoundary - width));
    const top = triggerRect.bottom + PANEL_GAP;
    setPanelStyle({
      left,
      top,
      width,
      maxHeight: Math.max(180, window.innerHeight - top - 18),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelGeometry();
    const observer = new ResizeObserver(updatePanelGeometry);
    if (buttonRef.current) observer.observe(buttonRef.current);
    const side = document.querySelector<HTMLElement>('.editor-craft-side');
    if (side) observer.observe(side);
    window.addEventListener('resize', updatePanelGeometry);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePanelGeometry);
    };
  }, [open, updatePanelGeometry]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (buttonRef.current?.contains(target) || panelRef.current?.contains(target))) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  useEffect(() => {
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent<{ recordingId: string }>).detail;
      if (detail.recordingId === recordingId) setOpen(true);
    };
    window.addEventListener(TASK_OPEN_EVENT, reveal);
    return () => window.removeEventListener(TASK_OPEN_EVENT, reveal);
  }, [recordingId]);

  useEffect(() => {
    const animate = (event: Event) => {
      const detail = (event as CustomEvent<TaskCreatedDetail>).detail;
      if (detail.recordingId !== recordingId || !detail.sourceRect || !buttonRef.current) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        buttonRef.current.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 220 });
        return;
      }
      const target = buttonRef.current.getBoundingClientRect();
      const token = document.createElement('span');
      token.className = 'media-task-flight';
      token.setAttribute('aria-hidden', 'true');
      token.style.left = `${detail.sourceRect.left + detail.sourceRect.width / 2}px`;
      token.style.top = `${detail.sourceRect.top + detail.sourceRect.height / 2}px`;
      document.body.appendChild(token);
      const dx = target.left + target.width / 2 - (detail.sourceRect.left + detail.sourceRect.width / 2);
      const dy = target.top + target.height / 2 - (detail.sourceRect.top + detail.sourceRect.height / 2);
      const animation = token.animate([
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.92 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.45)`, opacity: 0.2 },
      ], { duration: 260, easing: 'cubic-bezier(.2,.75,.2,1)' });
      animation.finished.finally(() => token.remove()).catch(() => token.remove());
    };
    window.addEventListener(TASK_CREATED_EVENT, animate);
    return () => window.removeEventListener(TASK_CREATED_EVENT, animate);
  }, [recordingId]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="media-task-center-button"
        className="media-task-center-button"
        aria-label={en ? 'Background tasks' : '后台任务'}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <I.List size={17} />
        {attentionCount > 0 && <span data-testid="media-task-count" className="media-task-count">{Math.min(99, attentionCount)}</span>}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          data-testid="media-task-center-panel"
          className="media-task-center-panel"
          role="dialog"
          aria-label={en ? 'Background tasks' : '后台任务'}
          style={panelStyle}
        >
          <div className="media-task-center-header">
            <div>
              <strong>{en ? 'Tasks' : '任务'}</strong>
              <span>{attentionCount > 0 ? (en ? `${attentionCount} need attention` : `${attentionCount} 项待处理`) : (en ? 'All caught up' : '当前无待办')}</span>
            </div>
            <button
              type="button"
              className="media-task-sound-toggle"
              aria-label={soundEnabled ? (en ? 'Mute task sounds' : '关闭任务声音') : (en ? 'Enable task sounds' : '开启任务声音')}
              aria-pressed={soundEnabled}
              onClick={() => setSoundEnabled(!soundEnabled)}
            >
              <I.Bell size={15} />
              {!soundEnabled && <span aria-hidden className="media-task-sound-slash" />}
            </button>
          </div>
          <div className="media-task-center-list" role="list">
            {visibleTasks.length === 0 ? (
              <div className="media-task-empty">{en ? 'New background work will appear here.' : '新的后台任务会显示在这里。'}</div>
            ) : visibleTasks.map((task) => {
              const eta = formatEta(task.etaMs);
              const percentage = Math.round(Math.max(0, Math.min(1, task.progress)) * 100);
              return (
                <article key={task.id} className={`media-task-item is-${task.status}`} role="listitem" data-task-id={task.id}>
                  <div className="media-task-item-topline">
                    <span className="media-task-kind-icon" aria-hidden>{task.status === 'completed' ? <I.Check size={13} /> : <I.Sparkles size={13} />}</span>
                    <div className="media-task-item-copy">
                      <strong>{kindLabel(task.kind, en)}</strong>
                      <span>{task.phase || statusLabel(task.status, en)}{eta ? ` · ETA ${eta}` : ''}</span>
                    </div>
                    <span className="media-task-percentage">{task.status === 'completed' ? '100%' : `${percentage}%`}</span>
                  </div>
                  <div className="media-task-progress" aria-hidden>
                    <span style={{ width: `${task.status === 'completed' ? 100 : percentage}%` }} />
                  </div>
                  {task.error && <p className="media-task-error" role="alert">{task.error}</p>}
                  <div className="media-task-actions">
                    {(task.status === 'running' || task.status === 'queued') && (
                      <button type="button" onClick={() => cancelTask(task.id)}>{en ? 'Cancel' : '取消'}</button>
                    )}
                    {(task.status === 'failed' || task.status === 'paused') && (
                      <button type="button" onClick={() => void retryTask(task.id)}>{en ? 'Retry' : '重试'}</button>
                    )}
                    {(task.status === 'failed' || task.status === 'paused' || task.status === 'completed') && (
                      <button type="button" onClick={() => dismissTask(task.id)}>{en ? 'Dismiss' : '移除'}</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
