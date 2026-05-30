'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cueAt, parseSrt } from '@/utils/srtParser';
import { chunkByWidth, subtitlePageIndex } from '@/utils/frameOverlays';

interface Props {
  srt: string | null | undefined;
  timeMs: number;
}

const OVERLAY_FONT =
  '600 16px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", sans-serif';

let _measureCtx: CanvasRenderingContext2D | null = null;
function measureWidth(s: string): number {
  if (typeof document === 'undefined') return s.length * 8;
  if (!_measureCtx) {
    _measureCtx = document.createElement('canvas').getContext('2d');
    if (_measureCtx) _measureCtx.font = OVERLAY_FONT;
  }
  return _measureCtx ? _measureCtx.measureText(s).width : s.length * 8;
}

export function SubtitleOverlay({ srt, timeMs }: Props): JSX.Element | null {
  const cues = useMemo(() => (srt ? parseSrt(srt) : []), [srt]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [maxW, setMaxW] = useState(0);

  // 测量容器可用宽度（气泡 max-w-80% − 左右内边距），随尺寸变化重算
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => {
      const w = el.clientWidth * 0.8 - 32;
      setMaxW(w > 40 ? w : 0);
    };
    sync();
    const obs = new ResizeObserver(sync);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const cue = cues.length ? cueAt(cues, timeMs) : null;
  // 分页只随 cue / 宽度变化而重算（不在每帧重切）
  const pages = useMemo(() => {
    if (!cue) return [] as string[];
    if (maxW <= 0) return [cue.text];
    return chunkByWidth(measureWidth, cue.text, maxW);
  }, [cue, maxW]);

  const line = pages.length > 0 && cue
    ? pages[subtitlePageIndex(pages.length, cue.startMs, cue.endMs, timeMs)]
    : '';

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none absolute inset-x-0 z-10 flex justify-center"
      style={{ bottom: '8%' }}
    >
      {line && (
        <div
          className="max-w-[80%] rounded-md px-4 text-center text-[16px] font-medium text-white"
          style={{
            background: 'rgba(0,0,0,0.65)',
            textShadow: '0 1px 3px rgba(0,0,0,0.7)',
            backdropFilter: 'blur(2px)',
            // 单行固定高度，长句已切页 → nowrap 不会溢出
            height: 36,
            lineHeight: '36px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {line}
        </div>
      )}
    </div>
  );
}
