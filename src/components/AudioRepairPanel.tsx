'use client';

import { useMemo, type JSX } from 'react';
import { I } from '@/components/icons';
import {
  AUDIO_REPAIR_PRESETS,
  normalizeAudioRepairSettings,
  type AudioRepairDiagnosis,
  type AudioRepairPreset,
  type AudioRepairSettings,
  type AudioRepairSeverity,
} from '@/services/audioRepairDomain';

interface Props {
  en: boolean;
  settings: AudioRepairSettings;
  diagnosis: AudioRepairDiagnosis | null;
  phase: 'idle' | 'processing' | 'ready' | 'failed';
  error?: string | null;
  hasGeneratedTrack: boolean;
  usingOriginal: boolean;
  onSettingsChange: (settings: AudioRepairSettings) => void;
  onApply: () => void;
  onUseOriginal: () => void;
  onUseEnhanced: () => void;
  onClose: () => void;
  onLocateTask: () => void;
}

const PRESETS: AudioRepairPreset[] = ['natural', 'clear', 'studio'];

function severityText(value: AudioRepairSeverity, en: boolean): string {
  const labels: Record<AudioRepairSeverity, [string, string]> = {
    none: ['None', '未发现'], low: ['Light', '轻微'], medium: ['Moderate', '中等'], high: ['Strong', '明显'],
  };
  return labels[value][en ? 0 : 1];
}

export function AudioRepairPanel({
  en, settings, diagnosis, phase, error, hasGeneratedTrack, usingOriginal,
  onSettingsChange, onApply, onUseOriginal, onUseEnhanced, onClose, onLocateTask,
}: Props): JSX.Element {
  const copy = useMemo(() => ({
    title: en ? 'Repair and enhance voice' : '修复并增强原声',
    subtitle: en ? 'Keep the source and create a reversible enhanced track.' : '保留原声，生成可撤销的增强音轨。',
    diagnosis: en ? 'Source diagnosis' : '原声检测',
    detecting: en ? 'Analyzing the source locally…' : '正在本地分析原声…',
    hiss: en ? 'Hiss' : '沙沙声', clicks: en ? 'Clicks' : '爆点', clipping: en ? 'Clipping' : '破音', hum: en ? 'Hum' : '电流声',
    natural: en ? 'Natural enhancement' : '自然增强', clear: en ? 'Clear voice' : '清晰人声', studio: en ? 'Studio repair' : '录音室修复',
    original: en ? 'Original' : '原声', enhanced: en ? 'Enhanced' : '增强后', audition: en ? 'A/B audition' : 'A/B 试听',
    repairStrength: en ? 'Repair strength' : '修复强度', clarity: en ? 'Clarity' : '清晰度', warmth: en ? 'Warmth' : '温暖度', originalMix: en ? 'Original mix' : '原声混合',
    details: en ? 'Repair details' : '修复细节', hissRepair: en ? 'Reduce hiss' : '减弱沙沙声', clickRepair: en ? 'Repair clicks' : '修复爆点', clipRepair: en ? 'Repair clipping' : '修复破音', humRepair: en ? 'Reduce hum' : '减弱电流声', essRepair: en ? 'Soften sibilance' : '减弱刺耳齿音',
    apply: en ? 'Generate enhanced track' : '生成增强音轨', running: en ? 'Open task center' : '打开任务中心', restore: en ? 'Restore original' : '恢复原声',
    local: en ? 'Processed locally · source audio is never overwritten' : '在本机处理 · 永不覆盖原始音轨',
  }), [en]);

  const choosePreset = (preset: AudioRepairPreset) => onSettingsChange(normalizeAudioRepairSettings(AUDIO_REPAIR_PRESETS[preset]));
  const update = (patch: Partial<AudioRepairSettings>) => onSettingsChange(normalizeAudioRepairSettings({ ...settings, ...patch }));
  const updateRepair = (key: keyof AudioRepairSettings['repairs'], checked: boolean) => update({ repairs: { ...settings.repairs, [key]: checked } });

  return (
    <section className="audio-repair-panel" data-testid="audio-repair-panel">
      <header className="audio-repair-panel-header">
        <button type="button" className="audio-repair-icon-button" onClick={onClose} aria-label={en ? 'Back to export settings' : '返回导出设置'}><I.ChevronLeft size={16} /></button>
        <div><h2>{copy.title}</h2><p>{copy.subtitle}</p></div>
      </header>

      <div className="audio-repair-diagnosis">
        <strong>{copy.diagnosis}</strong>
        {diagnosis ? (
          <div className="audio-repair-diagnosis-grid">
            {([['hiss', copy.hiss], ['clicks', copy.clicks], ['clipping', copy.clipping], ['hum', copy.hum]] as const).map(([key, label]) => (
              <span key={key}><small>{label}</small><b data-severity={diagnosis[key]}>{severityText(diagnosis[key], en)}</b></span>
            ))}
          </div>
        ) : <p>{copy.detecting}</p>}
      </div>

      <div className="audio-repair-presets" role="group" aria-label={en ? 'Voice repair preset' : '原声修复预设'}>
        {PRESETS.map((preset) => (
          <button key={preset} type="button" aria-pressed={settings.preset === preset} onClick={() => choosePreset(preset)}>
            {copy[preset]}
          </button>
        ))}
      </div>

      <div className="audio-repair-audition">
        <span>{copy.audition}</span>
        <div role="group">
          <button type="button" aria-pressed={usingOriginal} onClick={onUseOriginal}>{copy.original}</button>
          <button type="button" aria-pressed={!usingOriginal} onClick={hasGeneratedTrack ? onUseEnhanced : onApply}>{copy.enhanced}</button>
        </div>
      </div>

      <div className="audio-repair-sliders">
        {([
          ['repairStrength', copy.repairStrength], ['clarity', copy.clarity], ['warmth', copy.warmth], ['originalMix', copy.originalMix],
        ] as const).map(([key, label]) => (
          <label key={key}><span>{label}<b>{settings[key]}%</b></span><input type="range" min="0" max="100" value={settings[key]} onChange={(event) => update({ [key]: Number(event.target.value) })} /></label>
        ))}
      </div>

      <details className="audio-repair-details">
        <summary>{copy.details}<I.ChevronDown size={14} /></summary>
        {([
          ['hiss', copy.hissRepair], ['clicks', copy.clickRepair], ['clipping', copy.clipRepair], ['hum', copy.humRepair], ['sibilance', copy.essRepair],
        ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={settings.repairs[key]} onChange={(event) => updateRepair(key, event.target.checked)} /><span>{label}</span></label>)}
      </details>

      {error && <p className="audio-repair-error" role="alert">{error}</p>}
      <button type="button" className="audio-repair-primary" onClick={phase === 'processing' ? onLocateTask : onApply}>
        <I.Sparkles size={14} />{phase === 'processing' ? copy.running : copy.apply}
      </button>
      <button type="button" className="audio-repair-restore" onClick={onUseOriginal}><I.Undo size={13} />{copy.restore}</button>
      <p className="audio-repair-privacy">{copy.local}</p>
    </section>
  );
}
