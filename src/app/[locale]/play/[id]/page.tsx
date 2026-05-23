'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { AppHeader } from '@/components/AppHeader';
import { I } from '@/components/icons';
import { SubtitleOverlay } from '@/components/SubtitleOverlay';
import { loadFullRecording, deleteRecording } from '@/lib/db-client';
import type { RecordingMetadata, WhiteboardSnapshot } from '@/types/recording';
import { Link, useRouter } from '@/i18n/navigation';

const Excalidraw = dynamic(
  async () => (await import('@excalidraw/excalidraw')).Excalidraw,
  { ssr: false, loading: () => <div className="grid h-full place-items-center text-text-tertiary">…</div> },
);

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawAPI = any;

export default function PlayPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const locale = useLocale();
  const t = useTranslations('play');

  const [meta, setMeta] = useState<RecordingMetadata | null>(null);
  const [snapshots, setSnapshots] = useState<WhiteboardSnapshot[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [cameraUrl, setCameraUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [ready, setReady] = useState(false);

  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastAppliedTsRef = useRef<number>(-1);
  // 没有音频时用 performance.now() 推进时间
  const noAudioStartRef = useRef<{ perfStart: number; baseTime: number } | null>(null);

  // 加载录制
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let createdAudioUrl: string | null = null;
    let createdCameraUrl: string | null = null;
    loadFullRecording(id).then((r) => {
      if (cancelled) return;
      setMeta(r.metadata);
      setSnapshots(r.snapshots);
      if (r.audioBlob) {
        createdAudioUrl = URL.createObjectURL(r.audioBlob);
        setAudioUrl(createdAudioUrl);
      }
      if (r.cameraBlob) {
        createdCameraUrl = URL.createObjectURL(r.cameraBlob);
        setCameraUrl(createdCameraUrl);
      }
      setReady(true);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'load_failed');
    });
    return () => {
      cancelled = true;
      if (createdAudioUrl) URL.revokeObjectURL(createdAudioUrl);
      if (createdCameraUrl) URL.revokeObjectURL(createdCameraUrl);
    };
  }, [id]);

  // 把指定时刻对应的快照应用到 Excalidraw
  const applySnapshot = useCallback((t: number) => {
    if (!apiRef.current) return;
    const snap = snapshotAt(snapshots, t);
    if (!snap) return;
    if (snap.timestamp === lastAppliedTsRef.current) return;
    lastAppliedTsRef.current = snap.timestamp;
    try {
      // 剥离会与 viewMode 打架的字段
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
      // updateScene 失败时仅打日志，不打断播放
      console.error('updateScene_failed', e);
    }
  }, [snapshots]);

  // 首次有 API 且 snapshots 就绪时，渲染第 0 帧
  useEffect(() => {
    if (apiRef.current && snapshots.length > 0) {
      lastAppliedTsRef.current = -1;
      applySnapshot(0);
    }
  }, [snapshots, applySnapshot]);

  // 播放循环：用 audio.currentTime（如有）或 performance.now() 作为时间源
  // 注意 deps 里不能放 timeMs，否则每帧 setTimeMs 都会重启 rAF
  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      noAudioStartRef.current = null;
      return;
    }
    const audio = audioRef.current;
    const camera = cameraRef.current;
    if (!audio) {
      // 进入播放时一次性记录起点（用最新的 timeMs 作为 baseTime）
      noAudioStartRef.current = { perfStart: performance.now(), baseTime: timeMs };
    }
    const tick = () => {
      let t: number;
      if (audio) {
        t = audio.currentTime * 1000;
      } else {
        const ref = noAudioStartRef.current;
        t = ref ? ref.baseTime + (performance.now() - ref.perfStart) : 0;
      }
      const dur = meta?.durationMs ?? 0;
      if (dur > 0 && t >= dur) {
        setTimeMs(dur);
        applySnapshot(dur);
        setPlaying(false);
        return;
      }
      setTimeMs(t);
      applySnapshot(t);
      if (camera && audio && Math.abs(camera.currentTime - audio.currentTime) > 0.3) {
        try { camera.currentTime = audio.currentTime; } catch { /* ignore */ }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, applySnapshot, meta]);

  const togglePlay = useCallback(() => {
    setPlaying((prev) => {
      const next = !prev;
      const audio = audioRef.current;
      const camera = cameraRef.current;
      const dur = meta?.durationMs ?? 0;
      if (next) {
        // 已播完则从头来
        if (dur > 0 && timeMs >= dur) {
          if (audio) audio.currentTime = 0;
          if (camera) { try { camera.currentTime = 0; } catch { /* ignore */ } }
          setTimeMs(0);
          lastAppliedTsRef.current = -1;
        }
        if (audio) void audio.play().catch(() => { /* user-gesture lost */ });
        if (camera) void camera.play().catch(() => { /* ignore */ });
      } else {
        if (audio) audio.pause();
        if (camera) camera.pause();
      }
      return next;
    });
  }, [meta, timeMs]);

  const handleSeek = useCallback((t: number) => {
    setTimeMs(t);
    lastAppliedTsRef.current = -1;
    applySnapshot(t);
    const audio = audioRef.current;
    const camera = cameraRef.current;
    if (audio) audio.currentTime = t / 1000;
    if (camera) { try { camera.currentTime = t / 1000; } catch { /* ignore */ } }
    if (noAudioStartRef.current && playing) {
      noAudioStartRef.current = { perfStart: performance.now(), baseTime: t };
    }
  }, [applySnapshot, playing]);

  const onApi = useCallback((api: ExcalidrawAPI) => {
    apiRef.current = api;
    if (snapshots.length > 0) {
      lastAppliedTsRef.current = -1;
      applySnapshot(0);
    }
  }, [snapshots, applySnapshot]);

  const handleDelete = useCallback(async () => {
    const msg = locale === 'en' ? 'Delete this recording? Cannot be undone.' : '删除这条录制？此操作不可恢复。';
    if (!confirm(msg)) return;
    await deleteRecording(id);
    router.push('/library');
  }, [id, router, locale]);

  if (error) {
    return (
      <div className="flex h-full flex-col" style={{ background: 'var(--paper)' }}>
        <AppHeader tier="free" />
        <div className="grid flex-1 place-items-center">
          <div
            className="px-8 py-6 text-center"
            style={{
              background: 'var(--paper)',
              border: '1.6px solid var(--ink)',
              borderRadius: 4,
              boxShadow: '3px 3px 0 var(--ink)',
            }}
          >
            <p style={{ fontSize: 13, color: 'var(--rec)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>{error}</p>
            <Link
              href="/library"
              className="mt-4 inline-block"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)', borderBottom: '1.5px solid var(--ink)', textDecoration: 'none', letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              {t('back')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const titleFallback = locale === 'en' ? `Recording ${id.slice(0, 8)}` : `录制 ${id.slice(0, 8)}`;
  const title = meta?.title?.trim() || titleFallback;
  const downloadLabel = locale === 'en' ? 'Download video' : '下载视频';
  const deleteLabel = locale === 'en' ? 'Delete' : '删除';
  const backLabel = locale === 'en' ? 'Back' : '返回';

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--paper-2)' }}>
      <AppHeader tier="free" />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div
          className="flex items-center gap-3 px-6 py-3"
          style={{ background: 'var(--paper)', borderBottom: '1.5px solid var(--ink)' }}
        >
          <Link
            href="/library"
            aria-label={backLabel}
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
          </Link>
          <div
            className="truncate"
            style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}
          >
            {title}
          </div>
          <div className="flex-1" />
          <Link
            href={`/export/${id}` as never}
            className="btn-sketch btn-sketch-primary"
            style={{ padding: '7px 12px', fontSize: 10.5 }}
          >
            <I.Download size={12} /> {downloadLabel}
          </Link>
          <button
            onClick={handleDelete}
            className="btn-sketch"
            style={{ padding: '7px 12px', fontSize: 10.5, color: 'var(--rec)', borderColor: 'var(--rec)' }}
          >
            <I.Trash size={12} /> {deleteLabel}
          </button>
        </div>

        {/* 画布 */}
        <div className="relative flex-1 bg-canvas-bg">
          <Excalidraw
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            excalidrawAPI={onApi as any}
            viewModeEnabled
            zenModeEnabled
          />
          <SubtitleOverlay srt={meta?.subtitleSrt} timeMs={timeMs} />
          {cameraUrl && (
            <div
              className="pointer-events-none absolute z-40 overflow-hidden"
              style={{
                right: 24,
                bottom: 24,
                width: 160,
                height: 160,
                borderRadius: '50%',
                background: '#1f2937',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25), 0 0 0 3px rgba(255,255,255,0.9)',
              }}
            >
              <video
                ref={cameraRef}
                src={cameraUrl}
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={() => {
                  // 强制画面解码出第一帧，避免播放前显示黑色占位
                  const v = cameraRef.current;
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
          )}
          {audioUrl && (
            // 音频元素隐藏：用 timeMs/playing 控制
            <audio
              ref={audioRef}
              src={audioUrl}
              onEnded={() => setPlaying(false)}
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
              {t('loading')}
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
              disabled={!ready || (meta?.durationMs ?? 0) === 0}
              className="grid place-items-center transition"
              style={{
                width: 40,
                height: 40,
                background: 'var(--ink)',
                color: 'var(--paper)',
                border: '1.6px solid var(--ink)',
                boxShadow: '3px 3px 0 var(--hi)',
                borderRadius: 999,
                cursor: !ready || (meta?.durationMs ?? 0) === 0 ? 'not-allowed' : 'pointer',
                opacity: !ready || (meta?.durationMs ?? 0) === 0 ? 0.4 : 1,
              }}
              aria-label={playing ? t('pause') : t('play')}
            >
              {playing ? <I.Pause size={15} /> : <I.Play size={15} />}
            </button>
            <span
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)', fontWeight: 600 }}
            >
              {fmt(timeMs)}
            </span>
            <input
              type="range"
              min={0}
              max={meta?.durationMs ?? 0}
              step={Math.max(1, Math.round((meta?.durationMs ?? 1) / 400))}
              value={Math.min(timeMs, meta?.durationMs ?? 0)}
              onChange={(e) => handleSeek(Number(e.target.value))}
              disabled={!ready || (meta?.durationMs ?? 0) === 0}
              className="h-1.5 flex-1"
              style={{ accentColor: 'var(--ink)' }}
            />
            <span
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-3)' }}
            >
              {fmt(meta?.durationMs ?? 0)}
            </span>
            <div
              className="ml-2 flex items-center gap-3"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}
            >
              {meta?.hasAudio && <span className="flex items-center gap-1"><I.Mic size={12} /> {locale === 'en' ? 'Audio' : '音频'}</span>}
              {meta?.hasCamera && <span className="flex items-center gap-1"><I.Camera size={12} /> {locale === 'en' ? 'Camera' : '摄像头'}</span>}
              {!meta?.hasAudio && !meta?.hasCamera && <span>{locale === 'en' ? 'Whiteboard only' : '仅画板'}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
