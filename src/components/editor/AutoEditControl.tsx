'use client';

import { useState, type JSX } from 'react';
import { I } from '@/components/icons';
import type { AutoEditMode, AutoEditResult } from '@/services/autoEditAnalyzer';

type Phase = 'idle' | 'analyzing' | 'applied' | 'failed';

interface Props {
  hasAudio: boolean;
  phase: Phase;
  result: AutoEditResult | null;
  error: string | null;
  onRun: (preset: AutoEditMode) => void;
  onUndo: () => void;
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

export function AutoEditControl({ hasAudio, phase, result, error, onRun, onUndo, labels }: Props): JSX.Element {
  const [preset, setPreset] = useState<AutoEditMode>('walkthrough');
  const disabled = !hasAudio || phase === 'analyzing';
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
