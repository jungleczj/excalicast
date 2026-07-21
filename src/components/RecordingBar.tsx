'use client';

import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';

export interface RecordingBarProps {
  state: 'idle' | 'recording' | 'paused' | 'processing';
  elapsedMs: number;
  hasAudio: boolean;
  hasCamera: boolean;
  cameraEnabled: boolean;
  /** 录制中麦克风是否被软静音（hasAudio=true 时才有意义） */
  audioMuted?: boolean;
  /** 录制中摄像头是否被软关闭（hasCamera=true 时才有意义） */
  cameraMuted?: boolean;
  /** 激光笔（Excalidraw laser tool）是否激活 */
  laserActive?: boolean;
  /** 演示缩放模式是否激活（开启后双击画布放大/还原） */
  zoomActive?: boolean;
  /** 提词器浮层是否打开 */
  teleprompterActive?: boolean;
  /** 当前锁定的画幅比例徽标（如 '16:9' / 'default'）；录制态显示 */
  aspect?: string;
  onToggleCamera: () => void;
  /** 录制中点 mic 图标 —— 翻转软静音 */
  onToggleAudioMute?: () => void;
  /**
   * 点 camera 图标 —— 三态循环（仅录制中）：
   *  off（hasCamera=false）→ on（懒 acquire）；
   *  on（hasCamera=true && !muted）→ muted；
   *  muted → on（重新 acquire）。
   */
  onToggleCameraMute?: () => void;
  /** 切换激光笔工具 */
  onToggleLaser?: () => void;
  /** 切换演示缩放模式 */
  onToggleZoom?: () => void;
  /** 切换提词器浮层 */
  onToggleTeleprompter?: () => void;
  /** 打开模板库，从模板开始 */
  onOpenTemplates?: () => void;
  onStart: () => void;
  onStop: () => void | Promise<void>;
  onDiscard?: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const BAR_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: 'max-content',
  gap: 0,
  padding: '6px 10px',
  // 保留一条完整圆角控制带，而不是把每个操作做成独立“小窗口”。
  background: 'rgba(18, 19, 20, 0.93)',
  color: '#fffdf8',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 999,
  boxShadow: '0 14px 34px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.10)',
  backdropFilter: 'blur(16px) saturate(1.1)',
  WebkitBackdropFilter: 'blur(16px) saturate(1.1)',
  fontFamily: 'var(--font-sans)',
  fontSize: 11,
};

export function RecordingBar(props: RecordingBarProps): JSX.Element {
  const t = useTranslations('recordingBar');
  const {
    state, elapsedMs, hasAudio, hasCamera, cameraEnabled,
    audioMuted, cameraMuted, laserActive, zoomActive, teleprompterActive, aspect,
    onToggleCamera, onToggleAudioMute, onToggleCameraMute, onToggleLaser, onToggleZoom, onToggleTeleprompter,
    onOpenTemplates, onStart, onStop, onDiscard, onPause, onResume,
  } = props;

  if (state === 'idle') {
    return (
      <div data-testid="recording-bar" className="fade-in" style={BAR_STYLE}>
        <button
          type="button"
          onClick={onToggleCamera}
          className="grid h-7 w-7 place-items-center"
          style={{
            background: cameraEnabled ? 'rgba(84,173,105,0.9)' : 'transparent',
            border: 'none',
            borderRadius: 999,
            color: '#fffdf8',
            boxShadow: 'none',
            cursor: 'pointer',
          }}
          title={cameraEnabled ? t('cameraOnTooltip') : t('cameraOffTooltip')}
        >
          {cameraEnabled ? <I.Camera size={13} /> : <I.CameraOff size={13} />}
        </button>
        {onToggleLaser && (
          <button
            type="button"
            onClick={onToggleLaser}
            className="grid h-7 w-7 place-items-center"
            style={{
              background: laserActive ? 'rgba(84,173,105,0.9)' : 'transparent',
              border: 'none',
              borderRadius: 999,
              color: '#fffdf8',
              boxShadow: 'none',
              cursor: 'pointer',
            }}
            title={laserActive ? t('laserOn') : t('laserOff')}
          >
            <I.Laser size={13} />
          </button>
        )}
        {onToggleZoom && (
          <button
            type="button"
            onClick={onToggleZoom}
            className="grid h-7 w-7 place-items-center"
            style={{
              background: zoomActive ? 'rgba(84,173,105,0.9)' : 'transparent',
              border: 'none',
              borderRadius: 999,
              color: '#fffdf8',
              boxShadow: 'none',
              cursor: 'pointer',
            }}
            title={zoomActive ? t('zoomOn') : t('zoomOff')}
          >
            <I.Search size={13} />
          </button>
        )}
        {onToggleTeleprompter && (
          <button
            type="button"
            onClick={onToggleTeleprompter}
            className="grid h-7 w-7 place-items-center"
            style={{
              background: teleprompterActive ? 'rgba(84,173,105,0.9)' : 'transparent',
              border: 'none',
              borderRadius: 999,
              color: '#fffdf8',
              boxShadow: 'none',
              cursor: 'pointer',
            }}
            title={teleprompterActive ? t('teleprompterOn') : t('teleprompterOff')}
          >
            <I.Text size={13} />
          </button>
        )}
        {onOpenTemplates && (
          <button
            type="button"
            onClick={onOpenTemplates}
            className="grid place-items-center"
            style={{
              width: 30,
              height: 30,
              padding: 0,
              background: 'transparent',
              color: '#fffdf8',
              border: 'none',
              borderRadius: 999,
              boxShadow: 'none',
              cursor: 'pointer',
            }}
            title={t('fromTemplate')}
            aria-label={t('fromTemplate')}
          >
            <I.Library size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={onStart}
          className="flex items-center gap-2"
          style={{
            padding: '7px 16px',
            background: 'var(--rec)',
            color: '#fffdf8',
            border: 'none',
            borderRadius: 999,
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            cursor: 'pointer',
          }}
        >
          <span className="recording-indicator h-1.5 w-1.5 rounded-full" style={{ background: 'white' }} />
          {t('start')}
        </button>
      </div>
    );
  }

  if (state === 'processing') {
    return (
      <div
        data-testid="recording-bar"
        style={{
          ...BAR_STYLE,
          padding: '9px 16px',
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '-0.01em',
        }}
      >
        {t('processing')}
      </div>
    );
  }

  const isRec = state === 'recording';
  return (
    <div data-testid="recording-bar" style={BAR_STYLE}>
      {/* REC + timer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px 0 2px',
        }}
      >
        <span
          className={isRec ? 'recording-indicator' : ''}
          style={{
            width: 8,
            height: 8,
            background: isRec ? 'var(--rec)' : 'rgba(255,255,255,0.5)',
            borderRadius: 999,
          }}
        />
        <span style={{ fontWeight: 700, letterSpacing: '0.02em', fontSize: 12 }}>
          {isRec ? t('rec') : t('paused')}
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 13 }}>
          {fmt(elapsedMs)}
        </span>
      </div>

      <Divider />

      {isRec ? (
        <CtrlBtn onClick={onPause} Icon={I.Pause} label={t('pause')} ariaLabel="Pause recording" />
      ) : (
        <CtrlBtn onClick={onResume} Icon={I.Play} label={t('resume')} ariaLabel="Resume recording" />
      )}
      <CtrlBtn onClick={onStop} Icon={I.Stop} label={t('stop')} ariaLabel="Stop recording" tone="rec" />

      {onDiscard && (
        <button
          type="button"
          onClick={onDiscard}
          title={t('discardTooltip')}
          style={{
            width: 38,
            height: 40,
            background: 'transparent',
            border: 'none',
            color: '#fffdf8',
            borderRadius: 10,
            boxShadow: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <I.Trash size={13} />
        </button>
      )}

      <Divider />

      {aspect && (
        <div
          style={{
            padding: '0 8px',
            background: 'transparent',
            borderRadius: 8,
            border: 'none',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}
        >
          {aspect}
        </div>
      )}

      <SrcToggle
        IconOn={I.Mic}
        IconOff={I.MicOff}
        present={hasAudio}
        muted={!!audioMuted}
        label={t('mic')}
        title={!hasAudio ? t('micTooltip') : audioMuted ? t('unmuteAudio') : t('muteAudio')}
        onClick={hasAudio ? onToggleAudioMute : undefined}
      />
      <SrcToggle
        IconOn={I.Camera}
        IconOff={I.CameraOff}
        // 录制中 camera 按钮始终可点：未启用时点击触发懒激活；已启用时切 mute
        present={true}
        muted={!hasCamera || !!cameraMuted}
        label={t('camera')}
        title={!hasCamera ? t('enableCameraNow') : cameraMuted ? t('unmuteCamera') : t('muteCamera')}
        onClick={onToggleCameraMute}
      />
      {onToggleLaser && (
        <SrcToggle
          IconOn={I.Laser}
          IconOff={I.Laser}
          present={true}
          muted={!laserActive}
          label={t('laser')}
          title={laserActive ? t('laserOn') : t('laserOff')}
          onClick={onToggleLaser}
        />
      )}
      {onToggleZoom && (
        <SrcToggle
          IconOn={I.Search}
          IconOff={I.Search}
          present={true}
          muted={!zoomActive}
          label={t('zoom')}
          title={zoomActive ? t('zoomOn') : t('zoomOff')}
          onClick={onToggleZoom}
        />
      )}
      {onToggleTeleprompter && (
        <SrcToggle
          IconOn={I.Text}
          IconOff={I.Text}
          present={true}
          muted={!teleprompterActive}
          label={t('teleprompter')}
          title={teleprompterActive ? t('teleprompterOn') : t('teleprompterOff')}
          onClick={onToggleTeleprompter}
        />
      )}
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" style={{ width: 1, height: 28, margin: '0 4px', flex: '0 0 1px', background: 'rgba(255,255,255,0.14)' }} />;
}

function CtrlBtn({
  onClick,
  Icon,
  label,
  ariaLabel,
  tone,
}: {
  onClick?: () => void;
  Icon: (p: { size?: number; sw?: number }) => JSX.Element;
  label: string;
  ariaLabel?: string;
  tone?: 'rec';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={tone === 'rec' ? 'press sketch-active' : 'press'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        minWidth: 48,
        minHeight: 42,
        padding: '2px 7px',
        background: 'transparent',
        color: '#fffdf8',
        border: 'none',
        borderRadius: 10,
        boxShadow: 'none',
        fontFamily: 'var(--font-sans)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        cursor: 'pointer',
      }}
    >
      <span
        style={tone === 'rec'
          ? { width: 20, height: 20, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'var(--rec)', color: '#fff' }
          : { width: 20, height: 20, display: 'grid', placeItems: 'center' }}
      >
        <Icon size={tone === 'rec' ? 12 : 17} />
      </span>
      {label}
    </button>
  );
}

/**
 * 录制中可点击的来源开关。三种态 + 两套图标：
 *  - present=false（设备未启用）：灰底，IconOn，不可点。
 *  - present=true, muted=false（正在录入）：绿底，IconOn。
 *  - present=true, muted=true（软静音）：灰底，IconOff（带斜杠）。
 */
function SrcToggle({
  IconOn,
  IconOff,
  present,
  muted,
  label,
  title,
  onClick,
}: {
  IconOn: (p: { size?: number; sw?: number }) => JSX.Element;
  IconOff: (p: { size?: number; sw?: number }) => JSX.Element;
  present: boolean;
  muted: boolean;
  label: string;
  title: string;
  onClick?: () => void;
}) {
  const Icon = present && muted ? IconOff : IconOn;
  const clickable = present && !!onClick;
  const active = present && !muted;
  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      title={title}
      style={{
        minWidth: 46,
        minHeight: 42,
        borderRadius: 10,
        background: 'transparent',
        border: 'none',
        boxShadow: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        color: active ? '#9DE7AD' : 'rgba(255,253,248,0.72)',
        cursor: clickable ? 'pointer' : 'default',
        padding: 0,
      }}
    >
      <Icon size={16} />
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 9, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}
