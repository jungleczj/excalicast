'use client';

import { I } from '@/components/icons';

interface Props {
  state: 'idle' | 'recording' | 'paused' | 'processing';
  elapsedMs: number;
  hasAudio: boolean;
  hasCamera: boolean;
  cameraEnabled: boolean;
  onToggleCamera: () => void;
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

/**
 * 浮动控制条 — 设计稿 ControlBar：
 *  - 深色玻璃 rgba(17,24,39,0.92) backdrop-blur
 *  - 圆形胶囊
 *  - REC 红点 pulse + 计时器（mono 字体）+ Pause/Stop + 麦克风/摄像头状态点
 */
export function RecordingBar(props: Props): JSX.Element {
  const { state, elapsedMs, hasAudio, hasCamera, cameraEnabled, onToggleCamera, onStart, onStop, onDiscard, onPause, onResume } = props;

  if (state === 'idle') {
    return (
      <div
        className="fade-in flex items-center gap-2 rounded-full px-3 py-2"
        style={{
          background: 'rgba(17, 24, 39, 0.92)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
          color: 'white',
        }}
      >
        <button
          type="button"
          onClick={onToggleCamera}
          className={`grid h-8 w-8 place-items-center rounded-full transition ${
            cameraEnabled
              ? 'bg-success-500 text-white'
              : 'bg-white/10 text-white/70 hover:bg-white/15'
          }`}
          title={cameraEnabled ? '摄像头已开启 · 点击关闭' : '摄像头已关闭 · 点击开启'}
        >
          {cameraEnabled ? <I.Camera size={14} /> : <I.CameraOff size={14} />}
        </button>
        <button
          type="button"
          onClick={onStart}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
          style={{ background: 'var(--recording-strong)', boxShadow: '0 4px 12px rgba(220,38,38,0.4)' }}
        >
          <span className="h-2 w-2 rounded-full bg-white" />
          开始录制
        </button>
      </div>
    );
  }

  if (state === 'processing') {
    return (
      <div
        className="rounded-full px-5 py-2.5 text-sm text-white/90"
        style={{ background: 'rgba(17, 24, 39, 0.92)', backdropFilter: 'blur(12px)' }}
      >
        正在保存录制…
      </div>
    );
  }

  const isRec = state === 'recording';
  return (
    <div
      className="flex items-center gap-3 rounded-full px-3.5 py-2 text-white"
      style={{
        background: 'rgba(17, 24, 39, 0.92)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
      }}
    >
      <div className="flex items-center gap-2 pl-1">
        <span
          className={isRec ? 'recording-indicator h-2.5 w-2.5 rounded-full' : 'h-2.5 w-2.5 rounded-full'}
          style={{ background: isRec ? 'var(--recording)' : 'rgba(255,255,255,0.4)' }}
        />
        <span className="text-[12px] font-semibold tracking-[0.05em]">
          {isRec ? 'REC' : 'PAUSED'}
        </span>
      </div>

      <div className="font-mono text-[14px] font-medium tabular-nums">{fmt(elapsedMs)}</div>

      <span className="h-5 w-px bg-white/20" />

      {isRec ? (
        <button
          type="button"
          onClick={onPause}
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 text-[12px] font-medium hover:bg-white/15"
        >
          <I.Pause size={13} /> 暂停
        </button>
      ) : (
        <button
          type="button"
          onClick={onResume}
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 text-[12px] font-medium hover:bg-white/15"
        >
          <I.Play size={13} /> 继续
        </button>
      )}

      <button
        type="button"
        onClick={onStop}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-white"
        style={{ background: 'var(--recording-strong)' }}
      >
        <I.Stop size={13} /> 停止
      </button>

      {onDiscard && (
        <button
          type="button"
          onClick={onDiscard}
          title="丢弃"
          className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/15"
        >
          <I.Trash size={13} />
        </button>
      )}

      <span className="h-5 w-px bg-white/20" />

      <div className="flex gap-1.5 pr-1">
        <SourceDot active={hasAudio} icon={<I.Mic size={11} />} title="麦克风" />
        <SourceDot active={hasCamera} icon={<I.Camera size={11} />} title="摄像头" />
      </div>
    </div>
  );
}

function SourceDot({ active, icon, title }: { active: boolean; icon: React.ReactNode; title: string }) {
  return (
    <div
      title={title}
      className="grid h-6 w-6 place-items-center rounded-full text-white"
      style={{ background: active ? 'var(--success-500)' : 'rgba(255,255,255,0.1)' }}
    >
      {icon}
    </div>
  );
}
