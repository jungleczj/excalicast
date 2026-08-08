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
  onCancel,
  labels,
}: Props): JSX.Element {
  const [preset, setPreset] = useState<AutoEditMode>('walkthrough');
  const disabled = !hasAudio || phase === 'analyzing';
  const progressLocale = /[\u3400-\u9fff]/.test(labels.analyzing) ? 'zh' : 'en';
  const progressView = progress ? formatAutoEditProgress(progress, progressLocale) : null;
  const progressPercent = Math.round(Math.max(0, Math.min(1, progress?.progress ?? 0)) * 100);
  const resultText = result && (result.removedMs > 0
    ? labels.removed(result.cuts, (result.removedMs / 1000).toFixed(1))
    : labels.noCuts);

  return (
    <div className="timeline-craft-autoedit" aria-live="polite">
      <select
        value={preset}
        onChange={(event) => setPreset(event.target.value as AutoEditMode)}
        className="timeline-craft-select"
        aria-label={labels.autoEdit}
        disabled={phase === 'analyzing'}
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
        disabled={disabled}
        className="timeline-craft-action btn-sketch"
        style={{ padding: '3px 9px' }}
        title={!hasAudio ? labels.noAudio : labels.autoEdit}
        onClick={() => onRun(preset)}
      >
        {phase === 'analyzing' ? <span className="timeline-craft-spinner" aria-hidden /> : <I.Sparkles size={11} />}
        {phase === 'analyzing' ? labels.analyzing : labels.autoEdit}
      </button>
      {phase === 'analyzing' && progressView && (
        <span
          data-testid="autoedit-progress"
          className="timeline-craft-autoedit-result"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 150 }}
        >
          <span>{progressView.stageLabel}</span>
          <span>{progressView.percentLabel}</span>
          {progressView.etaLabel && <span>{progressView.etaLabel}</span>}
          <span
            aria-hidden
            style={{
              display: 'inline-block', width: 42, height: 3, overflow: 'hidden',
              borderRadius: 2, background: 'var(--paper-3, #ddd)',
            }}
          >
            <span
              style={{
                display: 'block', width: `${progressPercent}%`, height: '100%',
                background: 'var(--craft-blue, #1769ff)', transition: 'width 140ms ease',
              }}
            />
          </span>
        </span>
      )}
      {phase === 'analyzing' && progressView?.cancellable && onCancel && (
        <button
          data-testid="autoedit-cancel"
          type="button"
          className="timeline-craft-action btn-sketch"
          style={{ padding: '3px 7px' }}
          onClick={onCancel}
        >
          {progressLocale === 'zh' ? '取消' : 'Cancel'}
        </button>
      )}
      {resultText && (
        <span data-testid="autoedit-result" className="timeline-craft-autoedit-result">
          {resultText}
          {result!.removedMs > 0 && (
            <button data-testid="autoedit-undo" type="button" onClick={onUndo}>{labels.undo}</button>
          )}
          {result!.chatCutPreset && <span data-testid="autoedit-scene-aware">{labels.sceneAware(result!.sceneTransitions ?? 0, result!.sceneCuts ?? 0)}</span>}
        </span>
      )}
      {error && <span className="timeline-craft-autoedit-error">{error}</span>}
    </div>
  );
}
