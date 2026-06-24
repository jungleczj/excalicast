'use client';

import { useState, type JSX, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';
import {
  ASPECT_PRESETS,
  type AspectRatio,
  type AspectGroup,
  type CameraShape,
  type CameraCorner,
  type RecordingSetupConfig,
} from '@/types/recording';

interface Props {
  open: boolean;
  initial: RecordingSetupConfig;
  /** 麦克风显示名（默认设备）；缺省时显示 i18n 默认文案。 */
  micLabel?: string;
  /** 倒计时秒数，仅用于按钮文案；实际倒计时在父组件执行。 */
  countdownSeconds?: number;
  onCancel: () => void;
  onStart: (config: RecordingSetupConfig) => void;
}

type Tab = AspectGroup | 'custom' | 'default';

const RATIOS = Object.entries(ASPECT_PRESETS) as [AspectRatio, (typeof ASPECT_PRESETS)[AspectRatio]][];
const POSITIONS: CameraCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function tabForFraming(framing: RecordingSetupConfig['framing']): Tab {
  if (framing === 'default') return 'default';
  if (framing === 'custom') return 'custom';
  return ASPECT_PRESETS[framing].group;
}

export function RecordingSetup({ open, initial, micLabel, countdownSeconds = 3, onCancel, onStart }: Props): JSX.Element | null {
  const t = useTranslations('recordingSetup');
  const [tab, setTab] = useState<Tab>(() => tabForFraming(initial.framing));
  const [framing, setFraming] = useState<RecordingSetupConfig['framing']>(initial.framing);
  const [includeShell, setIncludeShell] = useState(initial.includeWorkspaceShell);
  const [camEnabled, setCamEnabled] = useState(initial.camera.enabled);
  const [size, setSize] = useState(initial.camera.sizePx);
  const [shape, setShape] = useState<CameraShape>(initial.camera.shape);
  const [pos, setPos] = useState<CameraCorner>(initial.camera.position);
  const [bgRemove, setBgRemove] = useState(initial.camera.backgroundRemoval);

  if (!open) return null;

  const tabs: { id: Tab; label: string; Ic: (p: { size?: number }) => JSX.Element }[] = [
    { id: 'default', label: t('aspect.tabDefault'), Ic: I.Grid },
    { id: 'landscape', label: t('aspect.tabLandscape'), Ic: I.Ratio16x9 },
    { id: 'portrait', label: t('aspect.tabPortrait'), Ic: I.Ratio9x16 },
    { id: 'square', label: t('aspect.tabSquare'), Ic: I.Ratio1x1 },
    { id: 'custom', label: t('aspect.tabCustom'), Ic: I.Crop },
  ];

  const dimsLabel =
    framing === 'default' || framing === 'custom' ? '—'
    : `${ASPECT_PRESETS[framing].width}×${ASPECT_PRESETS[framing].height} px`;

  const selectTab = (id: Tab) => {
    setTab(id);
    if (id === 'default') setFraming('default');
    else if (id === 'custom') setFraming('custom');
    else {
      // 切到分组：若当前 framing 不属于该组，默认选该组第一项
      const groupRatios = RATIOS.filter(([, p]) => p.group === id);
      if (framing === 'default' || framing === 'custom' || ASPECT_PRESETS[framing].group !== id) {
        setFraming(groupRatios[0][0]);
      }
    }
  };

  const handleStart = () => {
    const config: RecordingSetupConfig = {
      framing,
      croppingMode: framing === 'default' ? 'fit_all_content' : 'follow_viewport',
      includeWorkspaceShell: includeShell,
      camera: { enabled: camEnabled, sizePx: size, shape, position: pos, backgroundRemoval: bgRemove },
    };
    onStart(config);
  };

  return (
    <div
      className="fade-in fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'var(--overlay)' }}
      onClick={onCancel}
    >
      <div
        className="max-h-[92vh] max-w-[94vw] overflow-auto"
        style={{
          width: 760,
          background: 'var(--paper)',
          border: '2px solid var(--ink)',
          borderRadius: 5,
          boxShadow: 'var(--hard-lg)',
          color: 'var(--ink)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '20px 28px', borderBottom: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}
        >
          <div>
            <div className="label-mono" style={{ fontSize: 10 }}>// {t('step')}</div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 6 }}>{t('title')}</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('close')}
            className="grid place-items-center"
            style={{ width: 32, height: 32, border: '1.4px solid var(--ink)', background: 'var(--paper)', borderRadius: 3, cursor: 'pointer', color: 'var(--ink)' }}
          >
            <I.Close size={14} />
          </button>
        </div>

        <div style={{ padding: 28 }}>
          {/* Aspect ratio */}
          <SetupSection title={t('aspect.title')} subtitle={t('aspect.subtitle')} right={<div className="label-mono">{dimsLabel}</div>}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1.5px solid var(--ink)' }}>
              {tabs.map((tb) => {
                const active = tab === tb.id;
                return (
                  <button
                    key={tb.id}
                    type="button"
                    onClick={() => selectTab(tb.id)}
                    className="flex items-center"
                    style={{
                      gap: 6,
                      padding: '9px 14px',
                      background: active ? 'var(--hi)' : 'transparent',
                      border: '1.4px solid var(--ink)',
                      borderBottom: active ? 'none' : '1.5px solid var(--ink)',
                      borderTopLeftRadius: 3,
                      borderTopRightRadius: 3,
                      marginBottom: -1.5,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--ink)',
                      cursor: 'pointer',
                    }}
                  >
                    <tb.Ic size={13} /> {tb.label}
                  </button>
                );
              })}
            </div>

            {tab === 'default' ? (
              <button
                type="button"
                onClick={() => setFraming('default')}
                className="press flex w-full items-center text-left"
                style={{
                  gap: 14,
                  padding: 16,
                  border: '1.5px solid var(--ink)',
                  background: framing === 'default' ? 'var(--hi)' : 'var(--paper)',
                  boxShadow: framing === 'default' ? '2px 2px 0 var(--ink)' : 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  color: 'var(--ink)',
                }}
              >
                <I.Grid size={26} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t('aspect.defaultTitle')}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 2 }}>{t('aspect.defaultHint')}</div>
                </div>
              </button>
            ) : tab === 'custom' ? (
              <button
                type="button"
                onClick={() => setFraming('custom')}
                className="press flex w-full items-center text-left"
                style={{
                  gap: 14, padding: 16, border: '1.5px solid var(--ink)',
                  background: framing === 'custom' ? 'var(--hi)' : 'var(--paper)',
                  boxShadow: framing === 'custom' ? '2px 2px 0 var(--ink)' : 'none',
                  borderRadius: 3, cursor: 'pointer', color: 'var(--ink)',
                }}
              >
                <I.Crop size={26} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t('aspect.tabCustom')}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 2 }}>{t('aspect.customHint')}</div>
                </div>
              </button>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {RATIOS.filter(([, p]) => p.group === tab).map(([id, p]) => {
                  const sel = framing === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFraming(id)}
                      className="press flex items-center text-left"
                      style={{
                        gap: 12,
                        padding: 12,
                        border: '1.5px solid var(--ink)',
                        background: sel ? 'var(--hi)' : 'var(--paper)',
                        boxShadow: sel ? '2px 2px 0 var(--ink)' : 'none',
                        borderRadius: 3,
                        cursor: 'pointer',
                        color: 'var(--ink)',
                      }}
                    >
                      <AspectThumb ratio={id} selected={sel} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex items-baseline" style={{ gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{id}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>{p.width}×{p.height}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t(`hint.${id}`)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Include workspace UI — 对所有比例都出现 */}
            <div style={{ marginTop: 16 }}>
              <SetupRow label={t('includeShell.label')}>
                <Toggle on={includeShell} onChange={setIncludeShell} />
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 12 }}>{t('includeShell.hint')}</div>
              </SetupRow>
            </div>
          </SetupSection>

          <SectionDivider />

          {/* Camera */}
          <SetupSection title={t('camera.title')} subtitle={t('camera.subtitle')} right={<Toggle on={camEnabled} onChange={setCamEnabled} />}>
            {camEnabled && (
              <div style={{ display: 'grid', gap: 12 }}>
                <SetupRow label={t('camera.size', { px: size })}>
                  <input
                    type="range"
                    min={80}
                    max={480}
                    value={size}
                    onChange={(e) => setSize(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--ink)' }}
                  />
                </SetupRow>
                <SetupRow label={t('camera.shape')}>
                  <Segmented
                    value={shape}
                    onChange={(v) => setShape(v as CameraShape)}
                    options={[
                      { v: 'circle', label: t('camera.shapeCircle') },
                      { v: 'rounded', label: t('camera.shapeRounded') },
                    ]}
                  />
                </SetupRow>
                <SetupRow label={t('camera.position')}>
                  <PositionPicker value={pos} onChange={setPos} />
                </SetupRow>
                <SetupRow label={t('camera.bgRemoval')}>
                  <Toggle on={bgRemove} onChange={setBgRemove} />
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 12 }}>{t('camera.bgRemovalNote')}</div>
                </SetupRow>
              </div>
            )}
          </SetupSection>

          <SectionDivider />

          {/* Mic */}
          <SetupSection title={t('mic.title')} subtitle={t('mic.subtitle')}>
            <div className="flex items-center" style={{ gap: 12 }}>
              <div
                className="flex flex-1 items-center justify-between"
                style={{ border: '1.4px solid var(--ink)', padding: '10px 14px', borderRadius: 3, fontSize: 13 }}
              >
                <span>{micLabel ?? t('mic.default')}</span>
                <I.ChevronDown size={14} />
              </div>
              <div
                className="flex items-center"
                style={{ gap: 8, padding: '8px 12px', border: '1.4px solid var(--ink)', borderRadius: 3, background: 'var(--paper-2)' }}
              >
                <I.Mic size={14} />
                <div className="flex items-end" style={{ gap: 2, height: 14 }}>
                  {[4, 7, 11, 8, 12, 5, 9, 4].map((h, i) => (
                    <div key={i} style={{ width: 3, height: h, background: i < 5 ? 'var(--ink)' : 'var(--rule-soft)', borderRadius: 1 }} />
                  ))}
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-2)' }}>−18 dB</span>
              </div>
            </div>
          </SetupSection>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between"
          style={{ background: 'var(--paper-2)', borderTop: '1.5px solid var(--ink)', padding: '16px 28px' }}
        >
          <div
            className="flex items-center"
            style={{ gap: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-2)', letterSpacing: '0.06em', textTransform: 'uppercase' }}
          >
            <I.Lock size={11} />
            {t('footer.local')}
          </div>
          <div className="flex" style={{ gap: 10 }}>
            <button type="button" className="btn-sketch" onClick={onCancel}>{t('footer.cancel')}</button>
            <button type="button" className="btn-sketch btn-sketch-primary btn-stamp flex items-center" style={{ gap: 8 }} onClick={handleStart}>
              <span className="rec-dot" style={{ width: 7, height: 7 }} />
              {t('footer.start', { sec: countdownSeconds })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── sub-components (1:1 with design setup.jsx) ──────────────────────

function SetupSection({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div className="flex items-start justify-between" style={{ marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function SectionDivider(): JSX.Element {
  return <div style={{ height: 1.5, background: 'var(--ink)', margin: '22px 0', opacity: 0.7 }} />;
}

function SetupRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center" style={{ gap: 16 }}>
      <div style={{ width: 100, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-2)', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
        {label}
      </div>
      <div className="flex flex-1 items-center">{children}</div>
    </div>
  );
}

function AspectThumb({ ratio, selected }: { ratio: AspectRatio; selected: boolean }): JSX.Element {
  const [w, h] = ratio.split(':').map(Number);
  const max = 40;
  const tw = w >= h ? max : (w / h) * max;
  const th = h >= w ? max : (h / w) * max;
  return (
    <div className="flex flex-shrink-0 items-center justify-center" style={{ width: max, height: max }}>
      <div style={{ width: tw, height: th, border: '1.6px solid var(--ink)', background: selected ? 'var(--hi)' : 'var(--paper-2)', borderRadius: 2 }} />
    </div>
  );
}

function PositionPicker({ value, onChange }: { value: CameraCorner; onChange: (p: CameraCorner) => void }): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 3, width: 56, height: 38, border: '1.4px solid var(--ink)', background: 'var(--paper-2)', padding: 3, borderRadius: 3 }}>
      {POSITIONS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-label={p}
          style={{ background: value === p ? 'var(--ink)' : 'var(--paper)', border: 'none', borderRadius: 1, cursor: 'pointer', padding: 0 }}
        />
      ))}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      style={{ width: 38, height: 22, borderRadius: 999, border: '1.4px solid var(--ink)', background: on ? 'var(--ink)' : 'var(--paper-2)', position: 'relative', cursor: 'pointer', padding: 0, flexShrink: 0, transition: 'background 150ms ease' }}
    >
      <div style={{ position: 'absolute', top: 1, left: on ? 17 : 1, width: 16, height: 16, borderRadius: 999, background: on ? 'var(--hi)' : 'var(--paper)', border: '1.2px solid var(--ink)', transition: 'left 150ms cubic-bezier(0.2,0.7,0.3,1), background 150ms ease' }} />
    </button>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; label: string }[] }): JSX.Element {
  return (
    <div className="inline-flex" style={{ border: '1.4px solid var(--ink)', borderRadius: 3, padding: 2, gap: 2, background: 'var(--paper-2)' }}>
      {options.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className="press"
            style={{ padding: '5px 12px', background: active ? 'var(--ink)' : 'transparent', color: active ? 'var(--paper)' : 'var(--ink-2)', border: 'none', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

