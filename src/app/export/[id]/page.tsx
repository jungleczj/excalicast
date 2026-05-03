'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { ExportRatioPicker } from '@/components/ExportRatioPicker';
import { ExportPreview } from '@/components/ExportPreview';
import { ExportPanel, type ExportProgressState } from '@/components/ExportPanel';
import { I } from '@/components/icons';
import { getRecording, deleteRecording } from '@/lib/db-client';
import type { ExportConfig, RecordingMetadata } from '@/types/recording';

const DEFAULT_CONFIG: ExportConfig = {
  aspectRatio: '16:9',
  croppingMode: 'follow_viewport',
  fps: 15,
  withWatermark: true,
};

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ExportRecordingPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';

  const [meta, setMeta] = useState<RecordingMetadata | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<ExportConfig>(DEFAULT_CONFIG);
  const [exportProgress, setExportProgress] = useState<ExportProgressState | null>(null);

  useEffect(() => {
    if (!id) return;
    getRecording(id).then((m) => {
      if (!m) setLoadError(`录制不存在：${id}`);
      else setMeta(m);
    }).catch((err) => setLoadError(err instanceof Error ? err.message : 'load_failed'));
  }, [id]);

  const handlePaidChange = useCallback((isPaidNow: boolean) => {
    if (isPaidNow) setConfig((c) => ({ ...c, withWatermark: false }));
  }, []);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    if (!confirm('删除这条录制？此操作不可恢复。')) return;
    await deleteRecording(id);
    router.push('/library');
  }, [id, router]);

  if (loadError) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader tier="free" />
        <div className="grid flex-1 place-items-center">
          <div className="rounded-md border border-border-default bg-bg-primary px-8 py-6 text-center shadow-sm">
            <p className="text-sm text-recording-strong">{loadError}</p>
            <Link href="/library" className="mt-3 inline-block text-xs text-primary-600 underline">返回录制库</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader tier="free" />
        <div className="grid flex-1 place-items-center text-sm text-text-tertiary">加载录制元数据…</div>
      </div>
    );
  }

  const snapshotsApprox = Math.round(meta.durationMs / 50);

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <AppHeader tier="free" />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: preview + meta */}
        <div className="flex-1 overflow-auto px-7 py-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-1 flex items-baseline gap-3">
              <Link href="/library" className="text-text-tertiary hover:text-text-primary" aria-label="返回">
                <I.ChevronLeft size={18} />
              </Link>
              <h1 className="text-[22px] font-bold leading-tight">录制完成</h1>
              <span className="text-[12px] text-text-tertiary">本机保存 · {fmtTime(meta.startedAt)}</span>
            </div>
            <div className="mb-5 ml-7 text-[13px] text-text-secondary">
              <span className="font-medium text-text-primary">录制 {id.slice(0, 8)}</span>
              <span className="px-2 text-text-tertiary">·</span>
              {fmtDuration(meta.durationMs)}
              {meta.hasAudio && <><span className="px-2 text-text-tertiary">·</span>🎤 含音频</>}
              {meta.hasCamera && <><span className="px-2 text-text-tertiary">·</span>🎥 含摄像头</>}
            </div>

            <ExportPreview recordingId={id} metadata={meta} config={config} progress={exportProgress} />

            <div className="mt-4 grid grid-cols-4 gap-3">
              <Stat label="时长" value={fmtDuration(meta.durationMs)} mono />
              <Stat label="比例" value={config.aspectRatio} mono sub={`${ASPECT_DIM[config.aspectRatio]}`} />
              <Stat label="快照" value={String(snapshotsApprox)} sub="约" />
              <Stat label="音频" value={meta.hasAudio ? 'Opus 32k' : '—'} sub={meta.hasAudio ? '本地' : '未录'} />
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] text-text-tertiary transition hover:bg-recording/10 hover:text-recording-strong"
              >
                <I.Trash size={13} /> 删除录制
              </button>
            </div>
          </div>
        </div>

        {/* Right: action rail */}
        <aside className="w-[420px] flex-shrink-0 overflow-y-auto border-l border-border-default bg-bg-primary p-6">
          <div className="space-y-5">
            <ExportRatioPicker config={config} onChange={setConfig} />
            <div className="border-t border-border-default" />
            <ExportPanel
              recordingId={id}
              config={config}
              onConfigChange={setConfig}
              onPaidStateChange={handlePaidChange}
              onProgress={setExportProgress}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

const ASPECT_DIM: Record<string, string> = {
  '16:9': '1280×720',
  '9:16': '720×1280',
  '1:1':  '960×960',
  '4:5':  '864×1080',
};

function Stat({ label, value, sub, mono }: { label: string; value: string; sub?: string; mono?: boolean }): JSX.Element {
  return (
    <div className="rounded-md border border-border-default bg-bg-primary p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className={`mt-1 text-[18px] font-bold text-text-primary ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-text-secondary">{sub}</div>}
    </div>
  );
}
