'use client';

import { useMemo } from 'react';
import { cueAt, parseSrt } from '@/utils/srtParser';

interface Props {
  srt: string | null | undefined;
  timeMs: number;
}

export function SubtitleOverlay({ srt, timeMs }: Props): JSX.Element | null {
  const cues = useMemo(() => (srt ? parseSrt(srt) : []), [srt]);
  if (cues.length === 0) return null;
  const cue = cueAt(cues, timeMs);
  if (!cue) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex justify-center"
      style={{ bottom: '8%' }}
    >
      <div
        className="max-w-[80%] rounded-md px-4 py-2 text-center text-[16px] font-medium leading-snug text-white"
        style={{
          background: 'rgba(0,0,0,0.65)',
          textShadow: '0 1px 3px rgba(0,0,0,0.7)',
          backdropFilter: 'blur(2px)',
          whiteSpace: 'pre-line',
        }}
      >
        {cue.text}
      </div>
    </div>
  );
}
