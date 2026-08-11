'use client';

import { useState, type JSX } from 'react';
import { I } from '@/components/icons';
import type { AutoEditMode, AutoEditProgress, AutoEditResult } from '@/services/autoEditAnalyzer';

type Phase = 'idle' | 'analyzing' | 'applied' | 'failed';

interface Props {
  hasAudio: boolean;
  phase: Phase;
  result: AutoEditResult | null;
  error: string | null;
  progress?: AutoEditProgress | null;
  onRun: (preset: AutoEditMode) => void;
  onUndo: () => void;
  onCancel?: () => void;
  onLocateTask?: () => void;
  onGuide?: (message: string) => void;
  labels: {
    autoEdit: string;
    chatCut: string;
    lecture: string;
    walkthrough: string;
    shorts: string;
    timing: string;
    gentle: string;
    standard: string;
    tight: string;
    analyzing: string;
    noAudio: string;
    removed: (cuts: number, seconds: string) => string;
    noCuts: string;
    sceneAware: (transitions: number, alignedCuts: number) => string;
    undo: string;
  };
}

const STAGE_LABELS: Record<'en' | 'zh', Record<AutoEditProgress['stage'], string>> = {
  en: {
    reading: 'Reading media', audio: 'Audio analysis', scene_coarse: 'Scene scan',
    scene_refine: 'Scene refinement', complete: 'Complete',
  },
  zh: {
    reading: '读取媒体', audio: '分析音频', scene_coarse: '场景粗扫',
    scene_refine: '场景细化', complete: '完成',
  },
};

export function formatAutoEditProgress(progress: AutoEditProgress, locale: 'en' | 'zh' = 'en'): {
  stageLabel: string;
  percentLabel: string;
  etaLabel: string | null;
  cancellable: boolean;
} {
  const seconds = progress.etaMs == null ? null : Math.max(0, Math.ceil(progress.etaMs / 1_000));
  return {
    stageLabel: STAGE_LABELS[locale][progress.stage],
    percentLabel: `${Math.round(Math.max(0, Math.min(1, progress.progress)) * 100)}%`,
    etaLabel: seconds == null || progress.stage === 'complete'
      ? null
      : locale === 'zh' ? `剩余 ${seconds} 秒` : `${seconds}s left`,
    cancellable: progress.stage !== 'complete',
  };
}

export function AutoEditControl({
  hasAudio,
  phase,
  result,
  error,
  progress,
  onRun,
  onUndo,
  onLocateTask,
  onGuide,
  labels,
}: Props): JSX.Element {
  const [preset, setPreset] = useState<AutoEditMode>('walkthrough');
  void progress;
  const hasUndo = Boolean(result && result.removedMs > 0);

  const run = () => {
    if (!hasAudio) {
      onGuide?.(labels.noAudio);
      return;
    }
    if (phase === 'analyzing') {
      onLocateTask?.();
      return;
    }
    onRun(preset);
  };

  return (
    <div className="timeline-craft-autoedit" aria-live="polite">
      <select
        value={preset}
        onChange={(event) => setPreset(event.target.value as AutoEditMode)}
        className="timeline-craft-select"
        aria-label={labels.autoEdit}
      >
        <optgroup label={labels.chatCut}>
          <option value="lecture">{labels.lecture}</option>
          <option value="walkthrough">{labels.walkthrough}</option>
          <option value="shorts">{labels.shorts}</option>
        </optgroup>
        <optgroup label={labels.timing}>
          <option value="gentle">{labels.gentle}</option>
          <option value="standard">{labels.standard}</option>
          <option value="tight">{labels.tight}</option>
        </optgroup>
      </select>
      <button
        data-testid="autoedit-standard"
        type="button"
        className="timeline-craft-action btn-sketch"
        style={{ padding: '3px 9px' }}
        title={!hasAudio ? labels.noAudio : labels.autoEdit}
        onClick={run}
      >
        <I.Sparkles size={11} />
        <span className="timeline-craft-action-label">{labels.autoEdit}</span>
      </button>
      <button
        data-testid="autoedit-undo"
        type="button"
        className="timeline-craft-action btn-sketch"
        style={{ padding: '3px 8px' }}
        title={hasUndo ? labels.undo : labels.noCuts}
        onClick={() => hasUndo ? onUndo() : onGuide?.(labels.noCuts)}
      >
        <span aria-hidden>↶</span><span className="timeline-craft-action-label">{labels.undo}</span>
      </button>
      {error && <span className="sr-only" role="status">{error}</span>}
    </div>
  );
}
