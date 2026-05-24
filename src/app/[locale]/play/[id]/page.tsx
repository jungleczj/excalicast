'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AppHeader } from '@/components/AppHeader';
import { I } from '@/components/icons';
import { SharedPlayer } from '@/components/SharedPlayer';
import { loadFullRecording, deleteRecording } from '@/lib/db-client';
import type { CameraPositionEvent, RecordingMetadata, WhiteboardSnapshot } from '@/types/recording';
import { Link, useRouter } from '@/i18n/navigation';

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
  const [cameraEvents, setCameraEvents] = useState<CameraPositionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      setCameraEvents(r.cameraEvents);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'load_failed');
    });
    return () => {
      cancelled = true;
      if (createdAudioUrl) URL.revokeObjectURL(createdAudioUrl);
      if (createdCameraUrl) URL.revokeObjectURL(createdCameraUrl);
    };
  }, [id]);

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

  const rightActions = (
    <>
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
    </>
  );

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--paper-2)' }}>
      <AppHeader tier="free" />
      <SharedPlayer
        durationMs={meta?.durationMs ?? 0}
        subtitleSrt={meta?.subtitleSrt}
        snapshots={snapshots}
        audioSrc={audioUrl}
        cameraSrc={cameraUrl}
        cameraEvents={cameraEvents}
        title={title}
        rightActions={rightActions}
        hasAudio={!!meta?.hasAudio}
        hasCamera={!!meta?.hasCamera}
        i18n={{
          play: t('play'),
          pause: t('pause'),
          audio: locale === 'en' ? 'Audio' : '音频',
          camera: locale === 'en' ? 'Camera' : '摄像头',
          whiteboardOnly: locale === 'en' ? 'Whiteboard only' : '仅画板',
        }}
      />
    </div>
  );
}
