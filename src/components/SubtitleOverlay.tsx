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
        className="max-w-[80%] rounded-md px-4 text-center text-[16px] font-medium text-white"
        style={{
          background: 'rgba(0,0,0,0.65)',
          textShadow: '0 1px 3px rgba(0,0,0,0.7)',
          backdropFilter: 'blur(2px)',
          // 单行固定高度：超长省略，不换行、不抖动
          height: 36,
          lineHeight: '36px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {cue.text}
      </div>
    </div>
  );
}
