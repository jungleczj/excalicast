'use client';

import { createPortal } from 'react-dom';
import { I } from '@/components/icons';

type DocumentPictureInPictureApi = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>;
};

function fmt(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/**
 * Document Picture-in-Picture 是浏览器唯一能在网页以外放置可交互控制条的方式。
 * 不支持该 API 时，调用方保留页面内录制条作为可用 fallback。
 */
export async function requestDesktopRecordingControlsWindow(): Promise<Window | null> {
  if (typeof window === 'undefined') return null;
  const api = (window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi }).documentPictureInPicture;
  if (!api?.requestWindow) return null;
  const host = await api.requestWindow({ width: 460, height: 88 });
  const doc = host.document;
  doc.title = 'Excalicast recording controls';
  doc.documentElement.style.background = 'transparent';
  doc.body.style.cssText = 'margin:0;min-height:100vh;background:transparent;display:grid;place-items:center;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  return host;
}

interface Props {
  host: Window | null;
  state: 'starting' | 'recording' | 'paused' | 'processing';
  elapsedMs: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void | Promise<void>;
}

export function DesktopRecordingControls({ host, state, elapsedMs, onPause, onResume, onStop }: Props): JSX.Element | null {
  if (!host || state === 'processing') return null;
  const recording = state === 'recording';
  const starting = state === 'starting';
  return createPortal(
    <div
      data-testid="desktop-recording-controls"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, minWidth: 420, padding: '10px 12px',
        boxSizing: 'border-box', border: '1px solid rgba(255,255,255,.14)', borderRadius: 999,
        background: 'linear-gradient(180deg,rgba(36,37,38,.98),rgba(5,5,5,.98))', color: '#fffdf8',
        boxShadow: '0 18px 42px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.14)',
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 999, background: recording ? '#f4473d' : 'rgba(255,255,255,.5)', boxShadow: recording ? '0 0 0 4px rgba(244,71,61,.16)' : 'none' }} />
      <span style={{ fontWeight: 750, fontSize: 13 }}>{starting ? 'STARTING' : recording ? 'REC' : 'PAUSED'}</span>
      <span style={{ marginRight: 'auto', fontVariantNumeric: 'tabular-nums', fontSize: 15, fontWeight: 700 }}>{starting ? 'Starting…' : fmt(elapsedMs)}</span>
      <button
        type="button"
        onClick={recording ? onPause : onResume}
        aria-label={recording ? 'Pause recording' : 'Resume recording'}
        disabled={starting}
        style={{ ...controlButtonStyle, opacity: starting ? 0.45 : 1, cursor: starting ? 'default' : 'pointer' }}
      >
        {recording ? <I.Pause size={15} /> : <I.Play size={15} />}
        {starting ? 'Wait' : recording ? 'Pause' : 'Resume'}
      </button>
      <button type="button" onClick={onStop} aria-label="Stop recording" disabled={starting} style={{ ...controlButtonStyle, background: '#f4473d', color: '#fff', opacity: starting ? 0.45 : 1, cursor: starting ? 'default' : 'pointer' }}>
        <I.Stop size={15} /> Stop
      </button>
    </div>,
    host.document.body,
  );
}

const controlButtonStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 11px', border: 'none',
  borderRadius: 999, background: 'rgba(255,255,255,.12)', color: '#fffdf8', cursor: 'pointer', fontSize: 12, fontWeight: 700,
};
