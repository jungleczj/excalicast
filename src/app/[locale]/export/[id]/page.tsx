'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { AppHeader } from '@/components/AppHeader';
import { ExportRatioPicker } from '@/components/ExportRatioPicker';
import { ExportPreview } from '@/components/ExportPreview';
import { ExportPanel, type ExportProgressState } from '@/components/ExportPanel';
import { WorkspaceShellToggle } from '@/components/WorkspaceShellToggle';
import { I } from '@/components/icons';
import { getRecording, deleteRecording } from '@/lib/db-client';
import type { ExportConfig, RecordingMetadata } from '@/types/recording';
import { Link, useRouter } from '@/i18n/navigation';

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
  const locale = useLocale();

  const [meta, setMeta] = useState<RecordingMetadata | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<ExportConfig>(DEFAULT_CONFIG);
  const [exportProgress, setExportProgress] = useState<ExportProgressState | null>(null);

  useEffect(() => {
    if (!id) return;
    getRecording(id).then((m) => {
      if (!m) setLoadError(locale === 'en' ? `Recording not found: ${id}` : `录制不存在：${id}`);
      else setMeta(m);
    }).catch((err) => setLoadError(err instanceof Error ? err.message : 'load_failed'));
  }, [id, locale]);

  const handlePaidChange = useCallback((isPaidNow: boolean) => {
    if (isPaidNow) setConfig((c) => ({ ...c, withWatermark: false }));
  }, []);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    const msg = locale === 'en' ? 'Delete this recording? Cannot be undone.' : '删除这条录制？此操作不可恢复。';
    if (!confirm(msg)) return;
    await deleteRecording(id);
    router.push('/library');
  }, [id, router, locale]);

  const labels = locale === 'en'
    ? { back: 'Back', recordingDone: 'Editor', localSavedAt: 'Saved locally', recordingPrefix: 'Project', withAudio: '🎤 with audio', withCamera: '🎥 with camera', delete: 'Delete recording', duration: 'Duration', ratio: 'Ratio', snapshots: 'Snapshots', audio: 'Audio', approx: '~', notRecorded: '—', notRecordedSub: 'not recorded', localStorage: 'local', backLibrary: 'Back to library', loading: 'Loading recording metadata…' }
    : { back: '返回', recordingDone: '编辑器', localSavedAt: '本机保存', recordingPrefix: '项目', withAudio: '🎤 含音频', withCamera: '🎥 含摄像头', delete: '删除录制', duration: '时长', ratio: '比例', snapshots: '快照', audio: '音频', approx: '约', notRecorded: '—', notRecordedSub: '未录', localStorage: '本地', backLibrary: '返回录制库', loading: '加载录制元数据…' };

  if (loadError) {
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
            <p style={{ fontSize: 13, color: 'var(--rec)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>{loadError}</p>
            <Link
              href="/library"
              className="mt-4 inline-block"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)', borderBottom: '1.5px solid var(--ink)', textDecoration: 'none', letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              {labels.backLibrary}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="flex h-full flex-col" style={{ background: 'var(--paper)' }}>
        <AppHeader tier="free" />
        <div
          className="grid flex-1 place-items-center"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          {labels.loading}
        </div>
      </div>
    );
  }

  const snapshotsApprox = Math.round(meta.durationMs / 50);

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--paper-2)' }}>
      <AppHeader tier="free" />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: preview + meta */}
        <div className="flex-1 overflow-auto px-8 py-8" style={{ borderRight: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
          <div className="mx-auto" style={{ maxWidth: 760 }}>
            <div className="mb-2 flex items-baseline gap-3">
              <Link
                href="/library"
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
                aria-label={labels.back}
              >
                <I.ChevronLeft size={14} />
              </Link>
              <div className="label-mono" style={{ fontSize: 10 }}>// {labels.recordingPrefix.toUpperCase()}</div>
            </div>

            <h1
              className="mt-1 mb-1"
              style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.025em', color: 'var(--ink)', lineHeight: 1.1 }}
            >
              {labels.recordingDone}
            </h1>
            <div
              className="mb-6"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}
            >
              {labels.recordingPrefix} {id.slice(0, 8)} · {labels.localSavedAt} {fmtTime(meta.startedAt)}
              {meta.hasAudio && <> · {labels.withAudio}</>}
              {meta.hasCamera && <> · {labels.withCamera}</>}
            </div>

            <div
              style={{
                background: 'var(--paper)',
                border: '1.8px solid var(--ink)',
                borderRadius: 4,
                boxShadow: '4px 4px 0 var(--ink)',
                padding: 14,
              }}
            >
              <ExportPreview recordingId={id} metadata={meta} config={config} progress={exportProgress} />
            </div>

            <div className="mt-5 grid grid-cols-4 gap-3">
              <Stat label={labels.duration} value={fmtDuration(meta.durationMs)} mono />
              <Stat label={labels.ratio} value={config.aspectRatio} mono sub={`${ASPECT_DIM[config.aspectRatio]}`} />
              <Stat label={labels.snapshots} value={String(snapshotsApprox)} sub={labels.approx} />
              <Stat label={labels.audio} value={meta.hasAudio ? 'Opus 32k' : labels.notRecorded} sub={meta.hasAudio ? labels.localStorage : labels.notRecordedSub} />
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={handleDelete}
                className="btn-sketch"
                style={{ padding: '7px 12px', fontSize: 10, color: 'var(--rec)', borderColor: 'var(--rec)' }}
              >
                <I.Trash size={12} /> {labels.delete}
              </button>
            </div>
          </div>
        </div>

        {/* Right: sidebar */}
        <aside
          className="flex-shrink-0 overflow-y-auto p-6"
          style={{ width: 420, background: 'var(--paper)' }}
        >
          <div className="space-y-6">
            <WorkspaceShellToggle recordingId={id} config={config} onChange={setConfig} />
            <ExportRatioPicker config={config} onChange={setConfig} />
            <div style={{ height: 1.5, background: 'var(--ink)', opacity: 0.4 }} />
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
    <div
      style={{
        background: 'var(--paper)',
        border: '1.4px solid var(--ink)',
        borderRadius: 3,
        padding: 12,
      }}
    >
      <div className="label-mono" style={{ fontSize: 9 }}>{label}</div>
      <div
        className="mt-1"
        style={{
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-display)',
          fontVariantNumeric: mono ? 'tabular-nums' : undefined,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="mt-0.5"
          style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
