'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { listRecordings, deleteRecording, updateRecordingTitle } from '@/lib/db-client';
import {
  importCloudRecording,
  listCloudRecordings,
  removeCloudRecording,
  updateCloudRecordingTitle,
  uploadMany,
  uploadRecording,
  type BulkUploadProgress,
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

interface DisplayMeta {
  id: string;
  title?: string;
  startedAt: number;
  durationMs: number;
  hasAudio: boolean;
  hasCamera: boolean;
  thumbnail?: string | null;
  status: 'recording' | 'done' | 'error';
}

function displayMeta(it: MergedItem): DisplayMeta {
  const m = it.local;
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
  const c = it.cloud!;
  return {
    id: c.id,
    title: c.title ?? undefined,
    startedAt: c.startedAt,
    durationMs: c.durationMs,
    hasAudio: c.hasAudio,
    hasCamera: c.hasCamera,
    thumbnail: c.thumbnail,
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkProgress, setBulkProgress] = useState<BulkUploadProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
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
    setSelectedIds((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s); next.delete(id); return next;
    });
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
    const item = items.find((it) => it.id === id);
    if (item?.local) {
      await updateRecordingTitle(id, next);
    }
    // 标题同步到云端：只在有云端 row + Pro 已激活时才推
    if (item?.cloud && canCloud) {
      try {
        await updateCloudRecordingTitle(id, next.trim().length > 0 ? next : null);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'cloud_title_sync_failed');
      }
    }
    await refresh();
  }, [editValue, items, refresh, canCloud]);

  // 批量选择 / 备份
  const eligibleForBulkBackup = useMemo(
    () => items.filter((it) => !!it.local && !it.cloud).map((it) => it.id),
    [items],
  );
  const selectedPendingIds = useMemo(
    () => Array.from(selectedIds).filter((id) => eligibleForBulkBackup.includes(id)),
    [selectedIds, eligibleForBulkBackup],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((it) => it.id)));
  }, [items]);
  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  const handleSaveAll = useCallback(async () => {
    const ids = selectedPendingIds.length > 0 ? selectedPendingIds : eligibleForBulkBackup;
    if (ids.length === 0) return;
    setErrorMsg(null);
    setStatusMsg(null);
    const result = await uploadMany(ids, (p) => setBulkProgress({ ...p }));
    setBulkProgress(null);
    setStatusMsg(t('saveAllDone', { ok: result.ok.length, failed: result.failed.length }));
    if (result.failed.length > 0) {
      setErrorMsg(result.failed.map((f) => `${f.id.slice(0, 6)}…: ${f.error}`).join(' · '));
    }
    setSelectedIds(new Set());
    await refresh();
  }, [eligibleForBulkBackup, refresh, selectedPendingIds, t]);

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

  const allSelected = selectedIds.size === items.length && items.length > 0;
  const someSelected = selectedIds.size > 0 && !allSelected;

  return (
    <div>
      {canCloud && (
        <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5 text-[12px] text-primary-800">
          {t('cloudSyncLede')}
        </div>
      )}

      {canCloud && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border-default bg-bg-primary px-3 py-2">
          <button
            type="button"
            onClick={allSelected ? deselectAll : selectAll}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold text-text-primary hover:bg-bg-tertiary"
          >
            {allSelected ? <I.CheckSquare size={14} /> : <I.Square size={14} />}
            {allSelected ? t('deselectAll') : t('selectAll')}
            {someSelected && <span className="ml-1 rounded bg-primary-100 px-1.5 py-0.5 text-[10px] text-primary-700">{selectedIds.size}</span>}
          </button>
          <div className="text-[12px] text-text-secondary">
            {t('selectionLine', {
              count: selectedIds.size,
              pending: selectedPendingIds.length,
            })}
          </div>
          <div className="flex-1" />
          {bulkProgress ? (
            <div className="flex items-center gap-2 text-[12px] text-primary-700">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700" />
              {t('savingAll', { done: bulkProgress.done, total: bulkProgress.total })}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleSaveAll()}
              disabled={
                (selectedPendingIds.length === 0 && eligibleForBulkBackup.length === 0)
              }
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition disabled:opacity-40"
              style={{ background: 'var(--primary-600)' }}
            >
              <I.CloudUpload size={13} />
              {t('saveAllToCloud')}
              {selectedPendingIds.length > 0 && (
                <span className="ml-0.5 rounded bg-white/20 px-1.5 py-px text-[10px]">{selectedPendingIds.length}</span>
              )}
            </button>
          )}
        </div>
      )}

      {(statusMsg || errorMsg) && (
        <div className="mb-3 space-y-1">
          {statusMsg && (
            <div className="rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-[12px] text-text-primary">
              {statusMsg}
            </div>
          )}
          {errorMsg && (
            <div className="rounded-md border border-recording-strong bg-red-50 px-3 py-2 text-[12px] text-recording-strong">
              {errorMsg}
            </div>
          )}
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
          const selected = selectedIds.has(d.id);

          // 云端状态决定第三颗 hover 图标的样式 + 行为
          const cloudIcon = (() => {
            if (!canCloud) {
              return {
                icon: <I.CloudOff size={13} />,
                tooltip: t('tooltipUpgradePro'),
                onClick: undefined as undefined | (() => void),
                style: { background: 'rgba(0,0,0,0.4)', color: 'rgba(255,255,255,0.6)' } as React.CSSProperties,
              };
            }
            if (itemBusy === 'upload') {
              return {
                icon: <span className="inline-block h-[13px] w-[13px] animate-spin rounded-full border-2 border-white/40 border-t-white" />,
                tooltip: t('uploading'),
                onClick: undefined as undefined | (() => void),
                style: { background: 'rgba(0,0,0,0.7)' } as React.CSSProperties,
              };
            }
            if (hasLocal && hasCloud) {
              return {
                icon: <I.CloudCheck size={13} />,
                tooltip: t('tooltipSavedClickRemove'),
                onClick: () => void handleRemoveFromCloud(d.id),
                style: { background: 'rgba(22,163,74,0.92)' } as React.CSSProperties,
              };
            }
            if (hasLocal && !hasCloud) {
              return {
                icon: <I.CloudUpload size={13} />,
                tooltip: t('saveToCloud'),
                onClick: () => void handleUpload(d.id),
                style: { background: 'rgba(0,0,0,0.7)' } as React.CSSProperties,
              };
            }
            // cloud-only：不显示云图标（用户不会想"从云上传到云"）
            return null;
          })();

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
                    <div className="flex items-center gap-1.5 rounded-full bg-white/95 px-3.5 py-1.5 text-[12px] font-semibold text-text-primary shadow-md">
                      <I.CloudUpload size={13} />
                      {itemBusy === 'download' ? t('downloading') : t('downloadFromCloud')}
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
                    <span
                      className="flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold text-success-700"
                      style={{ background: '#dcfce7' }}
                    >
                      <I.Cloud size={10} sw={2.5} />
                      {t('badgeSynced')}
                    </span>
                  )}
                  {hasLocal && !hasCloud && (
                    <span
                      className="rounded px-1.5 py-px text-[10px] font-semibold"
                      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                    >
                      {t('badgeLocal')}
                    </span>
                  )}
                  {!hasLocal && hasCloud && (
                    <span
                      className="flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold text-primary-700"
                      style={{ background: 'var(--primary-100)' }}
                    >
                      <I.Cloud size={10} sw={2.5} />
                      {t('badgeCloud')}
                    </span>
                  )}
                  <div className="flex-1" />
                  {d.hasAudio && <I.Mic size={13} />}
                  {d.hasCamera && <I.Camera size={13} />}
                </div>
              </div>
            </>
          );

          const onTileClick = (e: React.MouseEvent) => {
            if (hasLocal) return;
            e.preventDefault();
            if (itemBusy) return;
            void handleDownload(d.id, 'play');
          };

          return (
            <div
              key={d.id}
              className={`group relative overflow-hidden rounded-xl border bg-bg-primary transition-all duration-150 hover:-translate-y-0.5 ${
                selected ? 'border-primary-500 ring-2 ring-primary-300' : 'border-border-default'
              }`}
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
            >
              {/* 选择复选框：canCloud 时显示，hover 或已选时可见 */}
              {canCloud && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelect(d.id); }}
                  className={`absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md transition ${
                    selected
                      ? 'bg-primary-600 text-white opacity-100'
                      : 'bg-white/85 text-text-primary opacity-0 group-hover:opacity-100'
                  }`}
                  style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}
                  aria-label={selected ? t('deselectAll') : t('selectAll')}
                >
                  {selected ? <I.CheckSquare size={13} /> : <I.Square size={13} />}
                </button>
              )}

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
                {cloudIcon && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (cloudIcon.onClick) cloudIcon.onClick();
                    }}
                    disabled={!cloudIcon.onClick}
                    className="grid h-7 w-7 place-items-center rounded-md text-white transition disabled:cursor-default"
                    style={cloudIcon.style}
                    title={cloudIcon.tooltip}
                    aria-label={cloudIcon.tooltip}
                  >
                    {cloudIcon.icon}
                  </button>
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
