'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** When null, renders a flat empty meter (used during permission pending). */
  stream: MediaStream | null;
  /** Number of segments. Default 12. */
  segments?: number;
}

/**
 * Horizontal bar of segments driven by AnalyserNode.getByteFrequencyData().
 * Color zones: green 0-60%, yellow 60-85%, red 85%+ (peak hint).
 *
 * Lives only as long as the parent stays mounted with the same stream — the
 * AudioContext is closed on unmount / stream change.
 */
export function MicLevelMeter({ stream, segments = 12 }: Props): JSX.Element {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) {
      setLevel(0);
      return;
    }
    let cancelled = false;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let buffer: Uint8Array<ArrayBuffer> | null = null;

    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      buffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch {
      // Some browsers refuse AudioContext until user gesture finishes — fall
      // back to a static empty meter rather than throwing.
      return;
    }

    const tick = (): void => {
      if (cancelled || !analyser || !buffer) return;
      analyser.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i];
      const avg = sum / buffer.length / 255; // 0..1
      // Slight gain so normal speech reads in 0.4..0.8 range.
      setLevel(Math.min(1, avg * 1.6));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      try { source?.disconnect(); } catch { /* */ }
      try { analyser?.disconnect(); } catch { /* */ }
      try { ctx?.close(); } catch { /* */ }
    };
  }, [stream]);

  return (
    <div className="flex items-center gap-[3px]" aria-label="麦克风音量">
      {Array.from({ length: segments }).map((_, i) => {
        const threshold = (i + 1) / segments;
        const active = threshold <= level;
        const color = !active
          ? 'rgb(226 232 240)' // slate-200 idle
          : threshold > 0.85
            ? 'rgb(239 68 68)' // red-500 peak
            : threshold > 0.6
              ? 'rgb(250 204 21)' // yellow-400
              : 'rgb(34 197 94)'; // green-500
        return (
          <span
            key={i}
            className="block h-3 w-[6px] rounded-[2px] transition-colors"
            style={{ background: color }}
          />
        );
      })}
    </div>
  );
}
