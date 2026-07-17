'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { LogoMark } from '@/components/icons';
import { SharedPlayer } from '@/components/SharedPlayer';
import type { CameraPositionEvent, WhiteboardSnapshot } from '@/types/recording';

interface ShareApiResponse {
  recordingId: string;
  title: string | null;
  durationMs: number;
  hasAudio: boolean;
  hasCamera: boolean;
  subtitleSrt: string | null;
  expiresAt: number;
  urls: {
    metadata: string;
    snapshots: string;
    audio: string | null;
    camera: string | null;
    cameraPositions: string | null;
  };
}

interface SnapshotsBundle {
  snapshots: WhiteboardSnapshot[];
  binaryFiles?: Array<{ fileId: string; data: unknown }>;
}

interface CameraEventsBundle {
  events?: Array<{ timestamp: number; rx: number; ry: number; rs: number }>;
}

async function fetchTextGz(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const blob = await res.blob();
  // Try DecompressionStream; fall back to plain text.
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
      return await new Response(stream).text();
    } catch {
      return blob.text();
    }
  }
  return blob.text();
}


export default function PublicSharePage(): JSX.Element {
  const params = useParams<{ short: string }>();
  const locale = useLocale();
  const short = params?.short ?? '';
  const [stage, setStage] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [meta, setMeta] = useState<ShareApiResponse | null>(null);
  const [snapshots, setSnapshots] = useState<WhiteboardSnapshot[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [cameraUrl, setCameraUrl] = useState<string | null>(null);
  const [cameraEvents, setCameraEvents] = useState<CameraPositionEvent[]>([]);

  const i18nText = locale === 'en'
    ? { loading: 'Loading share…', expired: 'This share link has expired.', notFound: 'Share link not found.', generic: 'Could not load this share.', backHome: 'Go to homepage' }
    : { loading: '加载分享…', expired: '该分享链接已过期。', notFound: '分享链接不存在。', generic: '加载失败。', backHome: '回到首页' };

  const loadShare = useCallback(async () => {
    setStage('loading');
    setErrorMsg('');
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(short)}`);
      if (res.status === 404) { setErrorMsg(i18nText.notFound); setStage('error'); return; }
      if (res.status === 410) { setErrorMsg(i18nText.expired); setStage('error'); return; }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setErrorMsg(j.message ?? i18nText.generic);
        setStage('error');
        return;
      }
      const json = (await res.json()) as ShareApiResponse;
      setMeta(json);

      // 音/画不预下载整段：直接把签名 URL 交给 <audio>/<video> 流式加载。
      // 某轨 URL 失效也只影响该轨，不致整页空白。
      setAudioUrl(json.urls.audio ?? null);
      setCameraUrl(json.urls.camera ?? null);

      // 画布只等 snapshots —— 下完即渲染，不被音视频拖慢。
      const snapsText = await fetchTextGz(json.urls.snapshots);
      const snapsObj = JSON.parse(snapsText) as SnapshotsBundle;
      setSnapshots(snapsObj.snapshots ?? []);
      setStage('ready');

      // 摄像头位置（小文件）后台拉，到了再补，失败忽略。
      if (json.urls.cameraPositions) {
        void fetchTextGz(json.urls.cameraPositions)
          .then((camPosText) => {
            const camPosObj = JSON.parse(camPosText) as CameraEventsBundle;
            const events: CameraPositionEvent[] = (camPosObj.events ?? []).map((e) => ({
              recordingId: json.recordingId,
              timestamp: e.timestamp,
              rx: e.rx,
              ry: e.ry,
              rs: e.rs,
            }));
            setCameraEvents(events);
          })
          .catch(() => setCameraEvents([]));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : i18nText.generic);
      setStage('error');
    }
  }, [short, i18nText.expired, i18nText.notFound, i18nText.generic]);

  useEffect(() => { void loadShare(); }, [loadShare]);

  if (stage === 'error') {
    return (
      <div className="app-craft-screen player-craft-shell flex h-full flex-col" style={{ background: 'var(--paper)' }}>
        <PublicHeader title="Excalicast" />
        <div className="grid flex-1 place-items-center">
          <div
            className="share-craft-state px-8 py-6 text-center"
            style={{
              background: 'var(--paper)',
              border: '1.6px solid var(--ink)',
              borderRadius: 4,
              boxShadow: '3px 3px 0 var(--ink)',
              maxWidth: 420,
            }}
          >
            <p style={{ fontSize: 13, color: 'var(--rec)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>{errorMsg}</p>
            <a
              href="/"
              className="mt-4 inline-block"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)', borderBottom: '1.5px solid var(--ink)', textDecoration: 'none', letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              {i18nText.backHome}
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'loading' || !meta) {
    return (
      <div className="app-craft-screen player-craft-shell flex h-full flex-col" style={{ background: 'var(--paper)' }}>
        <PublicHeader title="Excalicast" />
        <div
          className="grid flex-1 place-items-center"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          {i18nText.loading}
        </div>
      </div>
    );
  }

  const title = meta.title?.trim() || `Recording ${meta.recordingId.slice(0, 8)}`;

  return (
    <div className="app-craft-screen player-craft-shell flex h-full flex-col" style={{ background: 'var(--paper-2)' }}>
      <PublicHeader title={title} />
      <SharedPlayer
        durationMs={meta.durationMs}
        subtitleSrt={meta.subtitleSrt}
        snapshots={snapshots}
        audioSrc={audioUrl}
        cameraSrc={cameraUrl}
        cameraEvents={cameraEvents}
        hasAudio={meta.hasAudio}
        hasCamera={meta.hasCamera}
        i18n={{
          play: locale === 'en' ? 'Play' : '播放',
          pause: locale === 'en' ? 'Pause' : '暂停',
          audio: locale === 'en' ? 'Audio' : '音频',
          camera: locale === 'en' ? 'Camera' : '摄像头',
          whiteboardOnly: locale === 'en' ? 'Whiteboard only' : '仅画板',
        }}
      />
    </div>
  );
}

function PublicHeader({ title }: { title: string }): JSX.Element {
  return (
    <header
      className="share-craft-header flex h-14 flex-shrink-0 items-center justify-between px-6"
      style={{ background: 'var(--paper)', borderBottom: '2px solid var(--ink)' }}
    >
      <a href="/" className="flex items-center gap-2.5" style={{ textDecoration: 'none' }}>
        <LogoMark size={26} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
          Excalicast
        </span>
      </a>
      <div
        className="truncate"
        style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', maxWidth: 480 }}
      >
        {title}
      </div>
      <span className="tag-mono tag-mono-hi">SHARED</span>
    </header>
  );
}
