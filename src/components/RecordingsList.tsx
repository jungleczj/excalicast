'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { listRecordings, deleteRecording, updateRecordingTitle } from '@/lib/db-client';
import {
  importCloudRecording,
  listCloudRecordings,
  removeCloudRecording,
  uploadRecording,
  type CloudRecording,
} from '@/services/cloudSync';
import { useSubscription } from '@/hooks/useSubscription';
import { I } from '@/components/icons';
import type { RecordingMetadata } from '@/types/recording';

interface Props {
  refreshKey?: number;
}

interface MergedItem {
  id: string;
  local: RecordingMetadata | null;
  cloud: CloudRecording | null;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function fmtDate(ts: number, locale: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;
  if (diff < 24 * 3600_000 && d.getDate() === now.getDate()) {
    return locale === 'en' ? 'Today' : '今天';
  }
  if (diff < 48 * 3600_000) {
    return locale === 'en' ? 'Yesterday' : '昨天';
  }
  if (locale === 'en') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function displayMeta(it: MergedItem): {
  id: string;
  title?: string;
  startedAt: number;
  durationMs: number;
  hasAudio: boolean;
  hasCamera: boolean;
  thumbnail?: string | null;
  status: 'recording' | 'done' | 'error';
} {
  const m = it.local ?? null;
  const c = it.cloud ?? null;
  if (m) {
    return {
      id: m.id,
      title: m.title,
      startedAt: m.startedAt,
      durationMs: m.durationMs,
      hasAudio: m.hasAudio,
      hasCamera: m.hasCamera,
      thumbnail: m.lastFrameThumbnail,
      status: m.status,
    };
  }
  return {
    id: c!.id,
    title: c!.title ?? undefined,
    startedAt: c!.startedAt,
    durationMs: c!.durationMs,
    hasAudio: c!.hasAudio,
    hasCamera: c!.hasCamera,
    thumbnail: c!.thumbnail,
    status: 'done',
  };
}

function defaultTitle(m: { id: string; title?: string }, locale: string): string {
  if (m.title?.trim()) return m.title.trim();
  return locale === 'en' ? `Recording ${m.id.slice(0, 8)}` : `录制 ${m.id.slice(0, 8)}`;
}

const TINTS = [
  'linear-gradient(135deg, #fef3c7, #fde68a)',
  'linear-gradient(135deg, #dbeafe, #bfdbfe)',
  'linear-gradient(135deg, #ede9fe, #ddd6fe)',
  'linear-gradient(135deg, #dcfce7, #bbf7d0)',
];

type BusyKind = 'upload' | 'download' | null;

export function RecordingsList({ refreshKey = 0 }: Props): JSX.Element {
  const t = useTranslations('library');
  const locale = useLocale();
  const router = useRouter();
  const subscription = useSubscription();
  const canCloud = subscription.permissions.cloudBackup && subscription.loggedIn;

  const [items, setItems] = useState<MergedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [busy, setBusy] = useState<Record<string, BusyKind>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const localList = await listRecordings();
    let cloudList: CloudRecording[] = [];
    if (canCloud) {
      try {
        cloudList = await listCloudRecordings();
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('listCloudRecordings failed', err);
        }
      }
    }
    const map = new Map<string, MergedItem>();
    for (const m of localList) {
      map.set(m.id, { id: m.id, local: m, cloud: null });
    }
    for (const c of cloudList) {
      const existing = map.get(c.id);
      if (existing) existing.cloud = c;
      else map.set(c.id, { id: c.id, local: null, cloud: c });
    }
    const arr = Array.from(map.values()).sort(
      (a, b) => displayMeta(b).startedAt - displayMeta(a).startedAt,
    );
    setItems(arr);
    setLoaded(true);
  }, [canCloud]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm(t('deleteConfirm'))) return;
    const item = items.find((it) => it.id === id);
    await deleteRecording(id);
    if (item?.cloud && canCloud) {
      try { await removeCloudRecording(id); } catch { /* ignore */ }
    }
    await refresh();
  }, [items, refresh, t, canCloud]);

  const handleUpload = useCallback(async (id: string) => {
    setErrorMsg(null);
    setBusy((s) => ({ ...s, [id]: 'upload' }));
    try {
      await uploadRecording(id);
      await refresh();
    } catch (err) {
      setErrorMsg(t('uploadFailed', { message: err instanceof Error ? err.message : 'unknown' }));
    } finally {
      setBusy((s) => ({ ...s, [id]: null }));
    }
  }, [refresh, t]);

  const handleDownload = useCallback(async (id: string, goTo: 'play' | 'export' = 'play') => {
    setErrorMsg(null);
    setBusy((s) => ({ ...s, [id]: 'download' }));
    try {
      await importCloudRecording(id);
      router.push(`/${goTo}/${id}` as never);
    } catch (err) {
      setErrorMsg(t('downloadFailed', { message: err instanceof Error ? err.message : 'unknown' }));
      setBusy((s) => ({ ...s, [id]: null }));
    }
  }, [router, t]);

  const handleRemoveFromCloud = useCallback(async (id: string) => {
    if (!confirm(t('removeFromCloudConfirm'))) return;
    setErrorMsg(null);
    setBusy((s) => ({ ...s, [id]: 'upload' }));
    try {
      await removeCloudRecording(id);
      await refresh();
    } catch (err) {
      setErrorMsg(t('uploadFailed', { message: err instanceof Error ? err.message : 'unknown' }));
    } finally {
      setBusy((s) => ({ ...s, [id]: null }));
    }
  }, [refresh, t]);

  const startEdit = useCallback((it: MergedItem) => {
    const d = displayMeta(it);
    setEditingId(d.id);
    setEditValue(defaultTitle(d, locale));
  }, [locale]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  const commitEdit = useCallback(async (id: string) => {
    const next = editValue;
    setEditingId(null);
    setEditValue('');
    // Only local rename for now (cloud title comes from metadata snapshot uploaded earlier)
    const item = items.find((it) => it.id === id);
    if (item?.local) {
      await updateRecordingTitle(id, next);
    }
    await refresh();
  }, [editValue, items, refresh]);

  if (!loaded) {
    return <div className="py-12 text-center text-sm text-text-tertiary">{t('loading')}</div>;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-border-strong bg-bg-primary p-16 text-center">
        <div
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl text-primary-600"
          style={{ background: 'linear-gradient(135deg, var(--primary-100), var(--secondary-100))' }}
        >
          <I.Logo size={28} />
        </div>
        <h2 className="text-[18px] font-bold text-text-primary">{t('empty')}</h2>
        <Link
          href="/app"
          className="mt-5 inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-[13px] font-semibold text-white"
          style={{ background: 'var(--recording-strong)', boxShadow: '0 4px 12px rgba(220,38,38,0.25)' }}
        >
          <span className="h-2 w-2 rounded-full bg-white" />
          {t('newRecording')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      {canCloud && (
        <div
          className="mb-4 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5 text-[12px] text-primary-800"
        >
          {t('cloudSyncLede')}
        </div>
      )}
      {errorMsg && (
        <div className="mb-3 rounded-md border border-recording-strong bg-red-50 px-3 py-2 text-[12px] text-recording-strong">
          {errorMsg}
        </div>
      )}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {items.map((it, i) => {
          const d = displayMeta(it);
          const tint = TINTS[(d.id.charCodeAt(0) + i) % 4];
          const isEditing = editingId === d.id;
          const hasLocal = !!it.local;
          const hasCloud = !!it.cloud;
          const itemBusy = busy[d.id];

          // Tile click target: cloud-only → download then go to play; local → /play/[id]
          const onTileClick = (e: React.MouseEvent) => {
            if (hasLocal) return; // <Link> handles it
            e.preventDefault();
            if (itemBusy) return;
            void handleDownload(d.id, 'play');
          };

          const tileInner = (
            <>
              <div className="relative overflow-hidden" style={{ aspectRatio: '16/9', background: tint }}>
                {d.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.thumbnail} alt="thumbnail" className="h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center opacity-55">
                    <svg width="60%" height="60%" viewBox="0 0 200 120">
                      <rect x="20" y="30" width="50" height="30" fill="none" stroke="#1f2937" strokeWidth="2" rx="2" />
                      <rect x="130" y="30" width="50" height="30" fill="none" stroke="#1f2937" strokeWidth="2" rx="2" />
                      <line x1="70" y1="45" x2="130" y2="45" stroke="#1f2937" strokeWidth="2" />
                      <polygon points="130,45 124,42 124,48" fill="#1f2937" />
                      <rect x="65" y="80" width="70" height="22" fill="none" stroke="#1f2937" strokeWidth="2" rx="2" />
                    </svg>
                  </div>
                )}
                <span
                  className="absolute bottom-2 right-2 rounded font-mono text-[11px] font-semibold text-white"
                  style={{ background: 'rgba(0,0,0,0.7)', padding: '2px 7px' }}
                >
                  {fmtDuration(d.durationMs)}
                </span>
                {d.status === 'recording' && (
                  <span className="absolute left-2 top-2 rounded bg-recording px-2 py-0.5 text-[10px] font-semibold text-white">
                    {locale === 'en' ? 'unfinished' : '未完成'}
                  </span>
                )}
                {!hasLocal && hasCloud && (
                  <div className="absolute inset-0 grid place-items-center bg-black/30">
                    <div className="rounded-full bg-white/95 px-4 py-2 text-[12px] font-semibold text-text-primary shadow-md">
                      {itemBusy === 'download' ? t('downloading') : `☁️ ${t('downloadFromCloud')}`}
                    </div>
                  </div>
                )}

                <div className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover:bg-black/15" />
                {hasLocal && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                    <div
                      className="grid h-12 w-12 place-items-center rounded-full text-text-primary"
                      style={{ background: 'rgba(255,255,255,0.95)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
                    >
                      <I.Play size={20} />
                    </div>
                  </div>
                )}
              </div>
              <div className="px-3.5 pb-3 pt-3">
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') { e.preventDefault(); void commitEdit(d.id); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                    }}
                    onBlur={() => { void commitEdit(d.id); }}
                    maxLength={80}
                    className="w-full rounded border border-primary-600 bg-bg-primary px-1.5 py-0.5 text-[13.5px] font-semibold text-text-primary outline-none"
                  />
                ) : (
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-text-primary">
                      {defaultTitle(d, locale)}
                    </div>
                    {hasLocal && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEdit(it); }}
                        className="flex-shrink-0 rounded p-0.5 text-text-tertiary opacity-0 transition hover:bg-bg-tertiary hover:text-text-primary group-hover:opacity-100"
                        title={locale === 'en' ? 'Rename' : '重命名'}
                        aria-label={locale === 'en' ? 'Rename' : '重命名'}
                      >
                        <I.Edit size={12} />
                      </button>
                    )}
                  </div>
                )}
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-tertiary">
                  <span>{fmtDate(d.startedAt, locale)}</span>
                  {hasLocal && hasCloud && (
                    <span className="rounded px-1.5 py-px text-[10px] font-semibold text-success-700"
                      style={{ background: '#dcfce7' }}>
                      {t('badgeSynced')}
                    </span>
                  )}
                  {hasLocal && !hasCloud && (
                    <span className="rounded px-1.5 py-px text-[10px] font-semibold"
                      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                      {t('badgeLocal')}
                    </span>
                  )}
                  {!hasLocal && hasCloud && (
                    <span className="rounded px-1.5 py-px text-[10px] font-semibold text-primary-700"
                      style={{ background: 'var(--primary-100)' }}>
                      {t('badgeCloud')}
                    </span>
                  )}
                  <div className="flex-1" />
                  {d.hasAudio && <I.Mic size={13} />}
                  {d.hasCamera && <I.Camera size={13} />}
                </div>
                {/* Cloud action row */}
                {hasLocal && canCloud && !hasCloud && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleUpload(d.id); }}
                    disabled={!!itemBusy}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-primary-300 bg-primary-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-primary-700 transition hover:bg-primary-100 disabled:opacity-50"
                  >
                    {itemBusy === 'upload' ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700" />
                    ) : '☁️'}
                    {itemBusy === 'upload' ? t('uploading') : t('saveToCloud')}
                  </button>
                )}
                {hasLocal && hasCloud && canCloud && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleRemoveFromCloud(d.id); }}
                    disabled={!!itemBusy}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-border-default bg-bg-secondary px-2.5 py-1.5 text-[11px] text-text-tertiary transition hover:bg-recording/5 hover:text-recording-strong disabled:opacity-50"
                  >
                    {itemBusy === 'upload' ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-border-default border-t-recording-strong" />
                    ) : <I.Trash size={11} />}
                    {locale === 'en' ? 'Remove from cloud' : '从云端移除'}
                  </button>
                )}
                {hasLocal && !canCloud && (
                  <Link
                    href="/library"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-border-default px-2.5 py-1.5 text-[11px] font-semibold text-text-tertiary hover:bg-bg-tertiary"
                    title={t('saveToCloudPro')}
                  >
                    <I.Lock size={11} /> {t('saveToCloudPro')}
                  </Link>
                )}
              </div>
            </>
          );

          return (
            <div
              key={d.id}
              className="group relative overflow-hidden rounded-xl border border-border-default bg-bg-primary transition-all duration-150 hover:-translate-y-0.5"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
            >
              {hasLocal ? (
                <Link href={`/play/${d.id}` as never} className="block">
                  {tileInner}
                </Link>
              ) : (
                <div onClick={onTileClick} className="block cursor-pointer">
                  {tileInner}
                </div>
              )}
              <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100">
                {hasLocal && (
                  <Link
                    href={`/export/${d.id}` as never}
                    onClick={(e) => e.stopPropagation()}
                    className="grid h-7 w-7 place-items-center rounded-md text-white transition hover:bg-primary-600"
                    style={{ background: 'rgba(0,0,0,0.7)' }}
                    title={locale === 'en' ? 'Download (open export page)' : '下载（前往导出页）'}
                    aria-label={locale === 'en' ? 'Download' : '下载'}
                  >
                    <I.Download size={13} />
                  </Link>
                )}
                {hasLocal && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleDelete(d.id); }}
                    className="grid h-7 w-7 place-items-center rounded-md text-white transition"
                    style={{ background: 'rgba(0,0,0,0.7)' }}
                    title={locale === 'en' ? 'Delete' : '删除'}
                  >
                    <I.Trash size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
