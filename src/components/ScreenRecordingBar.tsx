'use client';

import { useEffect, useState } from 'react';
import { I } from '@/components/icons';

export interface ScreenRecordingBarProps {
  state: 'recording' | 'paused';
  getElapsedMs: () => number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function ScreenRecordingBar({
  state,
  getElapsedMs,
  onPause,
  onResume,
  onStop,
  onDiscard,
}: ScreenRecordingBarProps): JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => setElapsed(getElapsedMs()), 250);
    return () => clearInterval(id);
  }, [state, getElapsedMs]);

  return (
    <div
      className="flex items-center gap-2 rounded-full bg-black/85 px-4 py-2 text-white shadow-2xl"
      style={{ backdropFilter: 'blur(8px)' }}
    >
      <span
        className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${
          state === 'recording' ? 'animate-pulse bg-recording-strong' : 'bg-yellow-400'
        }`}
      />
      <span className="font-mono text-[13px] tabular-nums">{fmt(elapsed)}</span>
      <div className="mx-2 h-4 w-px bg-white/25" />
      {state === 'recording' ? (
        <button
          type="button"
          onClick={onPause}
          className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/15"
          aria-label="暂停"
        >
          <I.Pause size={14} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onResume}
          className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/15"
          aria-label="继续"
        >
          <I.Play size={14} />
        </button>
      )}
      <button
        type="button"
        onClick={onStop}
        className="grid h-7 w-7 place-items-center rounded-full bg-recording-strong hover:brightness-110"
        aria-label="停止"
      >
        <I.Stop size={12} />
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="ml-1 grid h-7 w-7 place-items-center rounded-full hover:bg-white/15"
        aria-label="丢弃"
        title="丢弃这次录制"
      >
        <I.Trash size={12} />
      </button>
    </div>
  );
}
