'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { I } from '@/components/icons';
import { getScreenRecording, loadScreenRecordingWebm } from '@/lib/db-client';
import type { ScreenRecordingMetadata } from '@/types/recording';
import { Link } from '@/i18n/navigation';

export default function ProcessRecordingPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [meta, setMeta] = useState<ScreenRecordingMetadata | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let created: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const m = await getScreenRecording(id);
        if (!m) {
          if (!cancelled) setLoadError(`找不到录制：${id}`);
          return;
        }
        if (cancelled) return;
        setMeta(m);
        const blob = await loadScreenRecordingWebm(id);
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setVideoUrl(created);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'load_failed');
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [id]);

  if (loadError) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader tier="free" />
        <div className="grid flex-1 place-items-center">
          <div className="rounded-md border border-border-default bg-bg-primary px-8 py-6 text-center">
            <p className="text-sm text-recording-strong">{loadError}</p>
            <Link href="/library" className="mt-3 inline-block text-xs text-primary-600 underline">
              返回录制库
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (!meta || !videoUrl) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader tier="free" />
        <div className="grid flex-1 place-items-center text-sm text-text-tertiary">加载录制…</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <AppHeader tier="free" />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto px-7 py-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-2 flex items-baseline gap-3">
              <Link
                href="/library"
                className="text-text-tertiary hover:text-text-primary"
                aria-label="返回"
              >
                <I.ChevronLeft size={18} />
              </Link>
              <h1 className="text-[22px] font-bold leading-tight">录制完成</h1>
              <span className="text-[12px] text-text-tertiary">
                {Math.round(meta.durationMs / 1000)} 秒 · {meta.output.width}×{meta.output.height}
              </span>
            </div>
            <video
              src={videoUrl}
              controls
              className="aspect-video w-full rounded-md bg-black shadow-md"
            />
          </div>
        </div>
        <aside className="w-[360px] flex-shrink-0 overflow-y-auto border-l border-border-default bg-bg-primary p-6">
          <h2 className="mb-4 text-[14px] font-semibold text-text-primary">下载</h2>
          <button
            type="button"
            id="p1-download-mp4"
            // Wired in Task 12
            className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-[13px] font-semibold text-white shadow-md"
            style={{ background: 'var(--primary-600)' }}
            disabled
          >
            <I.Download size={16} /> 下载 MP4（占位 · Task 12 接入）
          </button>
        </aside>
      </div>
    </div>
  );
}
