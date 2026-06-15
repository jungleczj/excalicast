'use client';

import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';

interface Props {
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
  onStart: () => void;
  onStop: () => void;
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
  gap: 8,
  padding: '8px 10px',
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: '1.8px solid var(--ink)',
  borderRadius: 5,
  boxShadow: '4px 4px 0 var(--hi)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
};

export function RecordingBar(props: Props): JSX.Element {
  const t = useTranslations('recordingBar');
  const {
    state, elapsedMs, hasAudio, hasCamera, cameraEnabled,
    audioMuted, cameraMuted, laserActive, aspect,
    onToggleCamera, onToggleAudioMute, onToggleCameraMute, onToggleLaser,
    onStart, onStop, onDiscard, onPause, onResume,
  } = props;

  if (state === 'idle') {
    return (
      <div className="fade-in" style={BAR_STYLE}>
        <button
          type="button"
          onClick={onToggleCamera}
          className="grid h-7 w-7 place-items-center"
          style={{
            background: cameraEnabled ? 'var(--ok)' : 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 3,
            color: 'var(--paper)',
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
              background: laserActive ? 'var(--ok)' : 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 3,
              color: 'var(--paper)',
              cursor: 'pointer',
            }}
            title={laserActive ? t('laserOn') : t('laserOff')}
          >
            <I.Laser size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={onStart}
          className="flex items-center gap-2"
          style={{
            padding: '7px 14px',
            background: 'var(--rec)',
            color: 'var(--paper)',
            border: 'none',
            borderRadius: 3,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
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
        style={{
          ...BAR_STYLE,
          padding: '12px 22px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {t('processing')}
      </div>
    );
  }

  const isRec = state === 'recording';
  return (
    <div style={BAR_STYLE}>
      {/* REC + timer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: isRec ? 'var(--rec)' : 'rgba(255,255,255,0.1)',
          padding: '4px 12px',
          borderRadius: 3,
        }}
      >
        <span
          className={isRec ? 'recording-indicator' : ''}
          style={{
            width: 8,
            height: 8,
            background: isRec ? 'white' : 'rgba(255,255,255,0.5)',
            borderRadius: 999,
          }}
        />
        <span style={{ fontWeight: 700, letterSpacing: '0.08em', fontSize: 10 }}>
          {isRec ? t('rec') : t('paused')}
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 12.5 }}>
          {fmt(elapsedMs)}
        </span>
      </div>

      <Divider />

      {isRec ? (
        <CtrlBtn onClick={onPause} Icon={I.Pause} label={t('pause')} />
      ) : (
        <CtrlBtn onClick={onResume} Icon={I.Play} label={t('resume')} />
      )}
      <CtrlBtn onClick={onStop} Icon={I.Stop} label={t('stop')} tone="rec" />

      {onDiscard && (
        <button
          type="button"
          onClick={onDiscard}
          title={t('discardTooltip')}
          style={{
            width: 28,
            height: 28,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.18)',
            color: 'var(--paper)',
            borderRadius: 3,
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
            padding: '4px 8px',
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.06em',
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
        title={!hasAudio ? t('micTooltip') : audioMuted ? t('unmuteAudio') : t('muteAudio')}
        onClick={hasAudio ? onToggleAudioMute : undefined}
      />
      <SrcToggle
        IconOn={I.Camera}
        IconOff={I.CameraOff}
        // 录制中 camera 按钮始终可点：未启用时点击触发懒激活；已启用时切 mute
        present={true}
        muted={!hasCamera || !!cameraMuted}
        title={!hasCamera ? t('enableCameraNow') : cameraMuted ? t('unmuteCamera') : t('muteCamera')}
        onClick={onToggleCameraMute}
      />
      {onToggleLaser && (
        <SrcToggle
          IconOn={I.Laser}
          IconOff={I.Laser}
          present={true}
          muted={!laserActive}
          title={laserActive ? t('laserOn') : t('laserOff')}
          onClick={onToggleLaser}
        />
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1.5, height: 22, background: 'rgba(255,255,255,0.15)' }} />;
}

function CtrlBtn({
  onClick,
  Icon,
  label,
  tone,
}: {
  onClick?: () => void;
  Icon: (p: { size?: number; sw?: number }) => JSX.Element;
  label: string;
  tone?: 'rec';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={tone === 'rec' ? 'press sketch-active' : 'press'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 11px',
        background: tone === 'rec' ? 'var(--rec)' : 'rgba(255,255,255,0.08)',
        color: 'var(--paper)',
        border: 'none',
        borderRadius: 3,
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      <Icon size={12} />
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
  title,
  onClick,
}: {
  IconOn: (p: { size?: number; sw?: number }) => JSX.Element;
  IconOff: (p: { size?: number; sw?: number }) => JSX.Element;
  present: boolean;
  muted: boolean;
  title: string;
  onClick?: () => void;
}) {
  const greyBg = 'rgba(255,255,255,0.06)';
  const bg = present && !muted ? 'var(--ok)' : greyBg;
  const Icon = present && muted ? IconOff : IconOn;
  const clickable = present && !!onClick;
  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      title={title}
      style={{
        width: 26,
        height: 26,
        borderRadius: 999,
        background: bg,
        border: '1px solid rgba(255,255,255,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        cursor: clickable ? 'pointer' : 'default',
        padding: 0,
      }}
    >
      <Icon size={12} />
    </button>
  );
}
