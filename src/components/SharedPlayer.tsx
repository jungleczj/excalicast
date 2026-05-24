'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { SubtitleOverlay } from '@/components/SubtitleOverlay';
import { I } from '@/components/icons';
import { cameraPositionAt } from '@/services/exportPipeline';
import type { CameraPositionEvent, WhiteboardSnapshot } from '@/types/recording';

const Excalidraw = dynamic(
  async () => (await import('@excalidraw/excalidraw')).Excalidraw,
  { ssr: false, loading: () => <div className="grid h-full place-items-center text-text-tertiary">…</div> },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawAPI = any;

function snapshotAt(snaps: WhiteboardSnapshot[], t: number): WhiteboardSnapshot | null {
  if (snaps.length === 0) return null;
  let lo = 0, hi = snaps.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snaps[mid].timestamp <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans === -1 ? snaps[0] : snaps[ans];
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export interface SharedPlayerProps {
  durationMs: number;
  subtitleSrt?: string | null;
  snapshots: WhiteboardSnapshot[];
  audioSrc: string | null;
  cameraSrc: string | null;
  cameraEvents: CameraPositionEvent[];
  /** 顶部右侧自定义额外按钮（如 download / delete / dismiss） */
  rightActions?: React.ReactNode;
  /** 标签栏标题 */
  title?: string;
  /** 标签栏左侧返回 */
  backHref?: string;
  /** 是否有音频 / 摄像头的右下角小指示 */
  hasAudio?: boolean;
  hasCamera?: boolean;
  i18n?: {
    play?: string;
    pause?: string;
    audio?: string;
    camera?: string;
    whiteboardOnly?: string;
  };
}

/**
 * 录制库 / 分享链接共用的统一播放器。所有时间相关逻辑：
 *  - 主时钟用 performance.now()（不信任 MediaRecorder 分片 webm 的 currentTime）
 *  - 摄像头气泡按 cameraEvents 跟随时间动态定位
 *  - audio/camera 漂移 > 0.3s 时回写 currentTime
 */
export function SharedPlayer({
  durationMs,
  subtitleSrt,
  snapshots,
  audioSrc,
  cameraSrc,
  cameraEvents,
  rightActions,
  title,
  backHref,
  hasAudio,
  hasCamera,
  i18n,
}: SharedPlayerProps): JSX.Element {
  const labels = {
    play: i18n?.play ?? 'Play',
    pause: i18n?.pause ?? 'Pause',
    audio: i18n?.audio ?? 'Audio',
    camera: i18n?.camera ?? 'Camera',
    whiteboardOnly: i18n?.whiteboardOnly ?? 'Whiteboard only',
  };

  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastAppliedTsRef = useRef<number>(-1);
  const clockRef = useRef<{ perfStart: number; baseTime: number } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);

  const applySnapshot = useCallback((t: number) => {
    if (!apiRef.current) return;
    const snap = snapshotAt(snapshots, t);
    if (!snap) return;
    if (snap.timestamp === lastAppliedTsRef.current) return;
    lastAppliedTsRef.current = snap.timestamp;
    try {
      const appState = { ...(snap.appState as Record<string, unknown>) };
      delete appState.collaborators;
      delete appState.activeTool;
      delete appState.viewModeEnabled;
      delete appState.zenModeEnabled;
      apiRef.current.updateScene({
        elements: snap.elements,
        appState,
      });
    } catch (e) {
      console.error('updateScene_failed', e);
    }
  }, [snapshots]);

  useEffect(() => {
    if (apiRef.current && snapshots.length > 0) {
      lastAppliedTsRef.current = -1;
      applySnapshot(0);
    }
  }, [snapshots, applySnapshot]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      clockRef.current = null;
      return;
    }
    clockRef.current = { perfStart: performance.now(), baseTime: timeMs };
    const audio = audioRef.current;
    const camera = cameraRef.current;
    const tick = () => {
      const ref = clockRef.current;
      if (!ref) return;
      const t = ref.baseTime + (performance.now() - ref.perfStart);
      if (durationMs > 0 && t >= durationMs) {
        setTimeMs(durationMs);
        applySnapshot(durationMs);
        setPlaying(false);
        if (audio) { try { audio.pause(); } catch { /* ignore */ } }
        if (camera) { try { camera.pause(); } catch { /* ignore */ } }
        return;
      }
      setTimeMs(t);
      applySnapshot(t);
      const tSec = t / 1000;
      if (audio && isFinite(audio.currentTime) && Math.abs(audio.currentTime - tSec) > 0.3) {
        try { audio.currentTime = tSec; } catch { /* ignore */ }
      }
      if (camera && isFinite(camera.currentTime) && Math.abs(camera.currentTime - tSec) > 0.3) {
        try { camera.currentTime = tSec; } catch { /* ignore */ }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, applySnapshot, durationMs]);

  const togglePlay = useCallback(() => {
    setPlaying((prev) => {
      const next = !prev;
      const audio = audioRef.current;
      const camera = cameraRef.current;
      if (next) {
        const restart = durationMs > 0 && timeMs >= durationMs - 50;
        const startT = restart ? 0 : timeMs;
        if (restart) {
          setTimeMs(0);
          lastAppliedTsRef.current = -1;
        }
        if (audio) {
          try { audio.currentTime = startT / 1000; } catch { /* ignore */ }
          void audio.play().catch(() => { /* user-gesture lost */ });
        }
        if (camera) {
          try { camera.currentTime = startT / 1000; } catch { /* ignore */ }
          void camera.play().catch(() => { /* ignore */ });
        }
      } else {
        if (audio) audio.pause();
        if (camera) camera.pause();
      }
      return next;
    });
  }, [durationMs, timeMs]);

  const handleSeek = useCallback((t: number) => {
    setTimeMs(t);
    lastAppliedTsRef.current = -1;
    applySnapshot(t);
    const audio = audioRef.current;
    const camera = cameraRef.current;
    if (audio) { try { audio.currentTime = t / 1000; } catch { /* ignore */ } }
    if (camera) { try { camera.currentTime = t / 1000; } catch { /* ignore */ } }
    if (playing) {
      clockRef.current = { perfStart: performance.now(), baseTime: t };
    }
  }, [applySnapshot, playing]);

  const onApi = useCallback((api: ExcalidrawAPI) => {
    apiRef.current = api;
    if (snapshots.length > 0) {
      lastAppliedTsRef.current = -1;
      applySnapshot(0);
    }
  }, [snapshots, applySnapshot]);

  const ready = snapshots.length > 0 || durationMs > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {(title || backHref || rightActions) && (
        <div
          className="flex items-center gap-3 px-6 py-3"
          style={{ background: 'var(--paper)', borderBottom: '1.5px solid var(--ink)' }}
        >
          {backHref && (
            <a
              href={backHref}
              aria-label="back"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                border: '1.4px solid var(--ink)',
                background: 'var(--paper)',
                borderRadius: 3,
                color: 'var(--ink)',
              }}
            >
              <I.ChevronLeft size={14} />
            </a>
          )}
          {title && (
            <div
              className="truncate"
              style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              {title}
            </div>
          )}
          <div className="flex-1" />
          {rightActions}
        </div>
      )}

      <div className="relative flex-1 bg-canvas-bg">
        <Excalidraw
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          excalidrawAPI={onApi as any}
          viewModeEnabled
          zenModeEnabled
        />
        <SubtitleOverlay srt={subtitleSrt} timeMs={timeMs} />
        {cameraSrc && (
          <SharedCameraBubble
            src={cameraSrc}
            cameraEvents={cameraEvents}
            timeMs={timeMs}
            playing={playing}
            videoRef={cameraRef}
          />
        )}
        {audioSrc && (
          <audio
            ref={audioRef}
            src={audioSrc}
            preload="auto"
            hidden
          />
        )}
        {!ready && (
          <div
            className="absolute inset-0 grid place-items-center"
            style={{
              background: 'rgba(26,26,26,0.05)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--ink-3)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            loading…
          </div>
        )}
      </div>

      <div
        className="px-6 py-4"
        style={{ background: 'var(--paper)', borderTop: '1.5px solid var(--ink)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            disabled={!ready || durationMs === 0}
            className="grid place-items-center transition"
            style={{
              width: 40,
              height: 40,
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: '1.6px solid var(--ink)',
              boxShadow: '3px 3px 0 var(--hi)',
              borderRadius: 999,
              cursor: !ready || durationMs === 0 ? 'not-allowed' : 'pointer',
              opacity: !ready || durationMs === 0 ? 0.4 : 1,
            }}
            aria-label={playing ? labels.pause : labels.play}
          >
            {playing ? <I.Pause size={15} /> : <I.Play size={15} />}
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)', fontWeight: 600 }}>
            {fmt(timeMs)}
          </span>
          <input
            type="range"
            min={0}
            max={durationMs}
            step={Math.max(1, Math.round((durationMs || 1) / 400))}
            value={Math.min(timeMs, durationMs)}
            onChange={(e) => handleSeek(Number(e.target.value))}
            disabled={!ready || durationMs === 0}
            className="h-1.5 flex-1"
            style={{ accentColor: 'var(--ink)' }}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-3)' }}>
            {fmt(durationMs)}
          </span>
          <div
            className="ml-2 flex items-center gap-3"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}
          >
            {hasAudio && <span className="flex items-center gap-1"><I.Mic size={12} /> {labels.audio}</span>}
            {hasCamera && <span className="flex items-center gap-1"><I.Camera size={12} /> {labels.camera}</span>}
            {!hasAudio && !hasCamera && <span>{labels.whiteboardOnly}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SharedCameraBubble({
  src,
  cameraEvents,
  timeMs,
  playing,
  videoRef,
}: {
  src: string;
  cameraEvents: CameraPositionEvent[];
  timeMs: number;
  playing: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
}): JSX.Element {
  const style = useMemo<React.CSSProperties>(() => {
    const pos = cameraPositionAt(cameraEvents, timeMs);
    if (pos) {
      return {
        left: `${pos.rx * 100}%`,
        top: `${pos.ry * 100}%`,
        width: `${pos.rs * 100}%`,
        aspectRatio: '1 / 1',
      };
    }
    return { right: 24, bottom: 24, width: 160, height: 160 };
  }, [cameraEvents, timeMs]);

  return (
    <div
      className="pointer-events-none absolute z-40 overflow-hidden transition-[left,top,width] duration-100"
      style={{
        ...style,
        borderRadius: '50%',
        background: '#1f2937',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25), 0 0 0 3px rgba(255,255,255,0.9)',
      }}
    >
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (v && !playing) {
            try { v.currentTime = Math.min(0.05, (isFinite(v.duration) ? v.duration : 0.05)); } catch { /* ignore */ }
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)',
        }}
      />
    </div>
  );
}
