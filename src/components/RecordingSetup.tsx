'use client';

import { useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { I } from '@/components/icons';
import { DEFAULT_VIDEO_BACKGROUND, getVideoBackgroundPreset, VIDEO_BACKGROUND_PRESETS, type VideoBackgroundPreset } from '@/config/videoBackgrounds';
import {
  ASPECT_PRESETS,
  type AspectRatio,
  type AspectGroup,
  type CameraShape,
  type CameraCorner,
  type RecordingSetupConfig,
  type RecordingSourceConfig,
  type RecordingSourceKind,
  type VideoBackgroundConfig,
  type VideoBackgroundTone,
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
const SOURCE_OPTIONS: RecordingSourceConfig[] = [
  { kind: 'whiteboard' },
  { kind: 'current_tab', displaySurface: 'browser', captureSystemAudio: true },
  { kind: 'window', displaySurface: 'window' },
  { kind: 'desktop', displaySurface: 'monitor' },
  { kind: 'selected_area' },
];
const BACKGROUND_TONES: VideoBackgroundTone[] = ['all', 'fresh', 'soft', 'dark', 'natural'];

function tabForFraming(framing: RecordingSetupConfig['framing']): Tab {
  if (framing === 'default') return 'default';
  if (framing === 'custom') return 'custom';
  return ASPECT_PRESETS[framing].group;
}

export function RecordingSetup({ open, initial, micLabel, countdownSeconds = 3, onCancel, onStart }: Props): JSX.Element | null {
  const t = useTranslations('recordingSetup');
  const locale = useLocale();
  const en = locale === 'en';
  const [tab, setTab] = useState<Tab>(() => tabForFraming(initial.framing));
  const [framing, setFraming] = useState<RecordingSetupConfig['framing']>(initial.framing);
  const [includeShell, setIncludeShell] = useState(initial.includeWorkspaceShell);
  const [source, setSource] = useState<RecordingSourceConfig>(initial.source ?? { kind: 'whiteboard' });
  const [videoBackground, setVideoBackground] = useState<VideoBackgroundConfig>(initial.videoBackground ?? DEFAULT_VIDEO_BACKGROUND);
  const [backgroundTone, setBackgroundTone] = useState<VideoBackgroundTone>('all');
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

  const selectSource = (next: RecordingSourceConfig) => {
    setSource(next);
    if (next.kind !== 'whiteboard') {
      setTab('default');
      setFraming('default');
    }
  };

  const handleStart = () => {
    const config: RecordingSetupConfig = {
      framing,
      croppingMode: framing === 'default' ? 'fit_all_content' : 'follow_viewport',
      includeWorkspaceShell: includeShell,
      camera: { enabled: camEnabled, sizePx: size, shape, position: pos, backgroundRemoval: bgRemove },
      source,
      videoBackground,
    };
    onStart(config);
  };

  return (
    <div
      className="setup-craft-overlay fade-in fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'var(--overlay)' }}
      onClick={onCancel}
    >
      <div
        className="setup-craft-card max-h-[92vh] max-w-[94vw] overflow-auto"
        style={{
          width: 1180,
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
          className="setup-craft-header flex items-center justify-between"
          style={{ padding: '20px 28px', borderBottom: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}
        >
          <div>
            <div className="label-mono" style={{ fontSize: 10 }}>// {t('step')}</div>
            <div className="setup-craft-title" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 6 }}>{t('title')}</div>
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

        <div className="recording-setup-body">
          <aside className="recording-setup-preview-pane">
            <div className="recording-setup-preview-copy">
              <span className="label-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{t('background.preview')}</span>
              <h3 style={{ margin: '7px 0 0', fontSize: 18, letterSpacing: '-.035em' }}>{t('title')}</h3>
              <p style={{ margin: '5px 0 0', color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.5 }}>{t('background.subtitle')}</p>
            </div>
            <RecordingBackgroundPreview
              background={videoBackground}
              framing={framing}
              sourceKind={source.kind}
              cameraEnabled={camEnabled}
              cameraSize={size}
              cameraShape={shape}
              cameraPosition={pos}
              label={t('background.preview')}
            />
            <div className="recording-setup-preview-facts">
              <PreviewFact label={t('source.title')} value={t(`source.${source.kind}.title`)} />
              <PreviewFact label={t('aspect.title')} value={framing === 'default' ? t('aspect.defaultTitle') : framing} />
              <PreviewFact label={t('camera.title')} value={camEnabled ? t('camera.enableTitle') : t('camera.skipTitle')} />
            </div>
          </aside>
          <div className="recording-setup-config" style={{ padding: 28 }}>
          {/* Recording source */}
          <SetupSection title={t('source.title')} subtitle={t('source.subtitle')}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
              {SOURCE_OPTIONS.map((option) => (
                <SourceCard
                  key={option.kind}
                  option={option}
                  selected={source.kind === option.kind}
                  title={t(`source.${option.kind}.title`)}
                  desc={t(`source.${option.kind}.desc`)}
                  onSelect={selectSource}
                />
              ))}
            </div>
            {source.kind !== 'whiteboard' && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>
                {t('source.browserChooserHint')}
              </div>
            )}
          </SetupSection>

          <SectionDivider />

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

          {/* Video background */}
          <SetupSection title={t('background.title')} subtitle={t('background.subtitle')}>
            <div className="flex flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
              {BACKGROUND_TONES.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  onClick={() => setBackgroundTone(tone)}
                  style={{
                    padding: '6px 11px',
                    borderRadius: 999,
                    border: '1.2px solid rgba(31,34,37,.16)',
                    background: backgroundTone === tone ? 'var(--ink)' : 'var(--paper-2)',
                    color: backgroundTone === tone ? 'var(--paper)' : 'var(--ink-2)',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t(`background.tones.${tone}`)}
                </button>
              ))}
            </div>
            <BackgroundSwatches
              en={en}
              tone={backgroundTone}
              value={videoBackground}
              noneLabel={t('background.none')}
              customColorLabel={t('background.customColor')}
              onChange={setVideoBackground}
            />
          </SetupSection>

          <SectionDivider />

          {/* Camera */}
          <SetupSection title={t('camera.title')} subtitle={t('camera.subtitle')}>
            <div role="radiogroup" aria-label={t('camera.decisionLabel')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: camEnabled ? 14 : 0 }}>
              <CameraDecision
                active={camEnabled}
                Icon={I.Camera}
                title={t('camera.enableTitle')}
                description={t('camera.enableDescription')}
                onClick={() => setCamEnabled(true)}
              />
              <CameraDecision
                active={!camEnabled}
                Icon={I.CameraOff}
                title={t('camera.skipTitle')}
                description={t('camera.skipDescription')}
                onClick={() => setCamEnabled(false)}
              />
            </div>
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
        </div>

        {/* Footer */}
        <div
          className="setup-craft-footer flex items-center justify-between"
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

function PreviewFact({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div aria-label={label} title={label} style={{ padding: '10px 0', borderTop: '1px solid rgba(31,34,37,.10)' }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function CameraDecision({
  active,
  Icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  Icon: (props: { size?: number }) => JSX.Element;
  title: string;
  description: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className="press"
      style={{
        display: 'flex', alignItems: 'center', gap: 11, minHeight: 68, padding: '12px 14px', textAlign: 'left',
        borderRadius: 14, cursor: 'pointer', color: active ? '#fffdf8' : 'var(--ink)',
        border: active ? '1px solid var(--ink)' : '1px solid rgba(31,34,37,.14)',
        background: active ? 'var(--ink)' : 'var(--paper-2)',
        boxShadow: active ? '0 10px 24px rgba(31,34,37,.15)' : '0 7px 16px rgba(48,38,26,.045)',
      }}
    >
      <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 999, background: active ? 'rgba(255,255,255,.13)' : '#fffdf8', border: active ? '1px solid rgba(255,255,255,.18)' : '1px solid rgba(31,34,37,.10)' }}>
        <Icon size={16} />
      </span>
      <span>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 750 }}>{title}</span>
        <span style={{ display: 'block', marginTop: 3, fontSize: 10.5, lineHeight: 1.35, color: active ? 'rgba(255,253,248,.7)' : 'var(--ink-3)' }}>{description}</span>
      </span>
    </button>
  );
}

function RecordingBackgroundPreview({
  background,
  framing,
  sourceKind,
  cameraEnabled,
  cameraSize,
  cameraShape,
  cameraPosition,
  label,
}: {
  background: VideoBackgroundConfig;
  framing: RecordingSetupConfig['framing'];
  sourceKind: RecordingSourceKind;
  cameraEnabled: boolean;
  cameraSize: number;
  cameraShape: CameraShape;
  cameraPosition: CameraCorner;
  label: string;
}): JSX.Element {
  const preset = background.kind === 'preset' ? getVideoBackgroundPreset(background.presetId) : null;
  const [width, height] = framing !== 'default' && framing !== 'custom'
    ? [ASPECT_PRESETS[framing].width, ASPECT_PRESETS[framing].height]
    : [16, 9];
  const backgroundImage = preset ? `url(${preset.preview})` : undefined;
  const backgroundColor = background.kind === 'color' ? background.color ?? '#fffdf8' : '#eef1ee';
  // 把真实 80–480px 摄像头尺寸映射到左侧小预览。位置 / 形状直接复用录制配置，
  // 让用户不必猜测最终成片中的气泡会落在哪里。
  const cameraPreviewSize = Math.round(24 + ((Math.max(80, Math.min(480, cameraSize)) - 80) / 400) * 52);
  const cameraInset = '13%';
  const cameraStyle: CSSProperties = {
    position: 'absolute',
    width: cameraPreviewSize,
    height: cameraPreviewSize,
    borderRadius: cameraShape === 'circle' ? '50%' : Math.max(8, Math.round(cameraPreviewSize * 0.24)),
    background: 'linear-gradient(135deg, #d7ded8, #938e86)',
    border: '3px solid rgba(255,253,248,.95)',
    boxShadow: '0 5px 12px rgba(31,34,37,.18)',
    transition: 'width 160ms ease, height 160ms ease, border-radius 160ms ease, inset 160ms ease',
  };
  if (cameraPosition.startsWith('top')) cameraStyle.top = cameraInset;
  else cameraStyle.bottom = cameraInset;
  if (cameraPosition.endsWith('left')) cameraStyle.left = cameraInset;
  else cameraStyle.right = cameraInset;

  return (
    <div data-testid="recording-background-preview" data-camera-enabled={cameraEnabled} style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <span className="label-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{label}</span>
        <span className="label-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{framing === 'default' ? '16:9' : framing}</span>
      </div>
      <div data-testid="recording-background-preview-frame" data-source-kind={sourceKind} data-camera-shape={cameraShape} data-camera-position={cameraPosition} data-camera-size={cameraSize} style={{ position: 'relative', width: '100%', aspectRatio: `${width} / ${height}`, overflow: 'hidden', borderRadius: 18, background: backgroundImage ? `${backgroundImage} center / cover no-repeat` : backgroundColor, boxShadow: 'inset 0 0 0 1px rgba(31,34,37,.09), 0 12px 26px rgba(48,38,26,.08)' }}>
        <div className="recording-background-preview-surface" data-testid="recording-background-preview-surface" style={{ position: 'absolute', inset: '14% 10%', borderRadius: 12, background: 'rgba(255,253,248,.94)', border: '1px solid rgba(255,255,255,.62)', boxShadow: '0 10px 18px rgba(23,28,33,.10), 0 2px 6px rgba(23,28,33,.05)', overflow: 'hidden' }}>
          <div style={{ height: 24, padding: '0 9px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid rgba(31,34,37,.07)' }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--rec)' }} />
            <span style={{ width: '25%', height: 4, borderRadius: 999, background: 'rgba(31,34,37,.14)' }} />
          </div>
          {sourceKind === 'whiteboard' ? <PreviewWhiteboardSurface /> : <PreviewDisplaySurface />}
        </div>
        {cameraEnabled && (
          <span
            data-testid="recording-background-preview-camera"
            data-shape={cameraShape}
            data-position={cameraPosition}
            data-size={cameraSize}
            style={cameraStyle}
          />
        )}
      </div>
    </div>
  );
}

function PreviewWhiteboardSurface(): JSX.Element {
  return (
    <div
      data-testid="recording-background-preview-whiteboard"
      style={{ position: 'relative', height: 'calc(100% - 24px)', backgroundImage: 'radial-gradient(rgba(31,34,37,.10) .7px, transparent .7px)', backgroundSize: '10px 10px' }}
    >
      <span style={{ position: 'absolute', left: '12%', top: '23%', width: '25%', height: '27%', border: '1.4px solid rgba(31,34,37,.72)', borderRadius: 4, background: 'rgba(221,210,242,.58)' }} />
      <span style={{ position: 'absolute', left: '44%', top: '32%', width: '22%', borderTop: '1.4px solid rgba(31,34,37,.72)' }} />
      <span style={{ position: 'absolute', left: '64%', top: '27%', width: 0, height: 0, borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderLeft: '6px solid rgba(31,34,37,.72)' }} />
      <span style={{ position: 'absolute', right: '12%', top: '18%', width: '18%', height: '36%', border: '1.4px solid rgba(31,34,37,.72)', borderRadius: '50%', background: 'rgba(255,236,153,.62)' }} />
      <span style={{ position: 'absolute', left: '25%', bottom: '17%', width: '48%', height: 4, borderRadius: 999, background: 'rgba(31,34,37,.16)' }} />
    </div>
  );
}

function PreviewDisplaySurface(): JSX.Element {
  return (
    <div style={{ padding: '12% 11%' }}>
      <span style={{ display: 'block', width: '54%', height: 7, borderRadius: 999, background: 'rgba(31,34,37,.17)', marginBottom: 8 }} />
      <span style={{ display: 'block', width: '76%', height: 5, borderRadius: 999, background: 'rgba(31,34,37,.10)', marginBottom: 6 }} />
      <span style={{ display: 'block', width: '67%', height: 5, borderRadius: 999, background: 'rgba(31,34,37,.10)' }} />
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

function sourceIcon(kind: RecordingSourceKind): (p: { size?: number }) => JSX.Element {
  if (kind === 'whiteboard') return I.Grid;
  if (kind === 'selected_area') return I.Crop;
  return I.Monitor;
}

function SourceCard({
  option,
  selected,
  title,
  desc,
  onSelect,
}: {
  option: RecordingSourceConfig;
  selected: boolean;
  title: string;
  desc: string;
  onSelect: (next: RecordingSourceConfig) => void;
}): JSX.Element {
  const Icon = sourceIcon(option.kind);
  return (
    <button
      type="button"
      onClick={() => onSelect(option)}
      className="press"
      aria-pressed={selected}
      style={{
        minHeight: 112,
        padding: 12,
        borderRadius: 18,
        border: selected ? '1.4px solid var(--ink)' : '1px solid rgba(31,34,37,.14)',
        background: selected ? 'var(--ink)' : 'var(--paper-2)',
        color: selected ? 'var(--paper)' : 'var(--ink)',
        boxShadow: selected ? '0 10px 26px rgba(24,25,26,.16)' : '0 8px 20px rgba(48,38,26,.05)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div
        className="grid place-items-center"
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          background: selected ? 'rgba(255,255,255,.12)' : '#fffdf8',
          border: selected ? '1px solid rgba(255,255,255,.20)' : '1px solid rgba(31,34,37,.10)',
          marginBottom: 10,
        }}
      >
        <Icon size={16} />
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 750, lineHeight: 1.2 }}>{title}</div>
      <div style={{ marginTop: 5, fontSize: 10.5, lineHeight: 1.35, color: selected ? 'rgba(255,253,248,.68)' : 'var(--ink-3)' }}>
        {desc}
      </div>
    </button>
  );
}

function BackgroundSwatches({
  en,
  tone,
  value,
  noneLabel,
  customColorLabel,
  onChange,
}: {
  en: boolean;
  tone: VideoBackgroundTone;
  value: VideoBackgroundConfig;
  noneLabel: string;
  customColorLabel: string;
  onChange: (next: VideoBackgroundConfig) => void;
}): JSX.Element {
  const filtered = VIDEO_BACKGROUND_PRESETS.filter((preset) => tone === 'all' || preset.tone === tone);
  const swatches: Array<VideoBackgroundPreset | null> = [null, ...filtered];
  const customColor = value.kind === 'color' ? (value.color ?? '#fffdf8') : '#fffdf8';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
      <div>
        <button
          type="button"
          aria-label={customColorLabel}
          aria-pressed={value.kind === 'color'}
          onClick={() => onChange({ kind: 'color', color: customColor })}
          className="press"
          style={{
            padding: 0,
            borderRadius: 0,
            border: 'none',
            background: 'transparent',
            boxShadow: 'none',
            cursor: 'pointer',
            color: 'var(--ink)',
            textAlign: 'left',
            width: '100%',
          }}
        >
          <div
            style={{
              aspectRatio: '16 / 9',
              width: '100%',
              borderRadius: 13,
              border: value.kind === 'color' ? '2px solid var(--ink)' : '1px solid rgba(31,34,37,.10)',
              boxShadow: value.kind === 'color' ? '0 0 0 3px rgba(255,253,248,.9), 0 10px 24px rgba(48,38,26,.12)' : '0 8px 18px rgba(48,38,26,.05)',
              background: customColor,
              marginBottom: 7,
            }}
          />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ fontSize: 11.5, fontWeight: 750 }}>{customColorLabel}</span>
          <input
            type="color"
            aria-label={customColorLabel}
            value={customColor}
            onChange={(e) => onChange({ kind: 'color', color: e.target.value })}
            style={{ width: 28, height: 20, border: '1px solid rgba(31,34,37,.16)', borderRadius: 999, background: 'transparent', padding: 0, cursor: 'pointer' }}
          />
        </div>
      </div>
      {swatches.map((preset) => {
        const selected = preset ? value.kind === 'preset' && value.presetId === preset.id : value.kind === 'none';
        return (
          <button
            key={preset?.id ?? 'none'}
            data-testid={`recording-background-swatch-${preset?.id ?? 'none'}`}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(preset ? { kind: 'preset', presetId: preset.id, tone: preset.tone } : DEFAULT_VIDEO_BACKGROUND)}
            className="press"
            style={{
              padding: 0,
              borderRadius: 0,
              border: 'none',
              background: 'transparent',
              boxShadow: 'none',
              cursor: 'pointer',
              color: 'var(--ink)',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                aspectRatio: '16 / 9',
                width: '100%',
                borderRadius: 13,
                border: selected ? '2px solid var(--ink)' : '1px solid rgba(31,34,37,.10)',
                boxShadow: selected ? '0 0 0 3px rgba(255,253,248,.9), 0 10px 24px rgba(48,38,26,.12)' : '0 8px 18px rgba(48,38,26,.05)',
                background: preset
                  ? `url(${preset.preview}) center / cover no-repeat`
                  : 'linear-gradient(135deg, #fffdf8, #f4efe8)',
                marginBottom: 7,
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 750 }}>
                {preset ? (en ? preset.labelEn : preset.labelZh) : noneLabel}
              </span>
              {selected && <I.Check size={13} />}
            </div>
          </button>
        );
      })}
    </div>
  );
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
