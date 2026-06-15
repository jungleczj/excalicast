'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { listRecordings, deleteRecording, updateRecordingTitle, updateRecordingTags, migrateRecordingsOwner } from '@/lib/db-client';
import { getOrCreateGuestId } from '@/lib/ownerKey';
import { useAuth } from '@/hooks/useAuth';
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
import { trackEvent } from '@/lib/analytics/track';
import type { RecordingMetadata } from '@/types/recording';
import { ThumbScene } from '@/components/ThumbScene';

interface Props {
  refreshKey?: number;
  /** 来自页面的搜索词（按标题过滤）。 */
  query?: string;
}

type FilterKind = 'all' | 'unfinished' | 'backed' | 'local';
type SortKind = 'newest' | 'oldest' | 'longest';
type ViewKind = 'grid' | 'list';

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

/** 设计风格的标签 pill（首个用 hi 高亮）。 */
function Pill({ children, hi = false }: { children: React.ReactNode; hi?: boolean }): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{
        padding: '2px 8px',
        border: '1px solid var(--ink)',
        background: hi ? 'var(--hi)' : 'var(--paper)',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        borderRadius: 999,
        color: 'var(--ink)',
      }}
    >
      {children}
    </span>
  );
}

type BusyKind = 'upload' | 'download' | null;

export function RecordingsList({ refreshKey = 0, query = '' }: Props): JSX.Element {
  const t = useTranslations('library');
  const locale = useLocale();
  const [filter, setFilter] = useState<FilterKind>('all');
  const [sort, setSort] = useState<SortKind>('newest');
  const [view, setView] = useState<ViewKind>('grid');
  const router = useRouter();
  const subscription = useSubscription();
  const { user, loading: authLoading } = useAuth();
  const canCloud = subscription.permissions.cloudBackup && subscription.loggedIn;

  const [items, setItems] = useState<MergedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [tagsDraft, setTagsDraft] = useState<string>('');
  const [busy, setBusy] = useState<Record<string, BusyKind>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkProgress, setBulkProgress] = useState<BulkUploadProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const tagsInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    // 等 auth settle 再列表/认领：避免在登录态解析前用 guestId 误认领 legacy 录制。
    if (authLoading) return;
    // 本地录制按 ownerKey 隔离：登录=user.id，匿名=guestId。
    const ownerKey = user?.id ?? getOrCreateGuestId();
    // 登录后把匿名期间录制并入账户（幂等：迁移后 guest 行清零）。
    if (user?.id) {
      try { await migrateRecordingsOwner(getOrCreateGuestId(), user.id); } catch { /* ignore */ }
    }
    const localList = await listRecordings(ownerKey);
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
  }, [canCloud, user?.id, authLoading]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (editingTagsId && tagsInputRef.current) {
      tagsInputRef.current.focus();
      tagsInputRef.current.select();
    }
  }, [editingTagsId]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm(t('deleteConfirm'))) return;
    const item = items.find((it) => it.id === id);
    await deleteRecording(id, user?.id ?? getOrCreateGuestId());
    if (item?.cloud && canCloud) {
      try { await removeCloudRecording(id); } catch { /* ignore */ }
    }
    setSelectedIds((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s); next.delete(id); return next;
    });
    await refresh();
  }, [items, refresh, t, canCloud, user?.id]);

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

  const startEditTags = useCallback((it: MergedItem) => {
    setEditingTagsId(it.id);
    setTagsDraft((it.local?.tags ?? []).join(', '));
  }, []);

  const commitTags = useCallback(async (id: string) => {
    const next = tagsDraft.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
    setEditingTagsId(null);
    setTagsDraft('');
    const item = items.find((it) => it.id === id);
    if (item?.local) {
      try { await updateRecordingTags(id, next); } catch { /* ignore */ }
    }
    await refresh();
  }, [tagsDraft, items, refresh]);

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

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = items.filter((it) => {
      const d = displayMeta(it);
      if (filter === 'unfinished' && d.status !== 'recording') return false;
      if (filter === 'backed' && !it.cloud) return false;
      if (filter === 'local' && !!it.cloud) return false;
      if (q && !defaultTitle(d, locale).toLowerCase().includes(q)) return false;
      return true;
    });
    return arr.sort((a, b) => {
      const da = displayMeta(a);
      const db = displayMeta(b);
      if (sort === 'oldest') return da.startedAt - db.startedAt;
      if (sort === 'longest') return db.durationMs - da.durationMs;
      return db.startedAt - da.startedAt;
    });
  }, [items, filter, sort, query, locale]);

  const changeFilter = useCallback((f: FilterKind) => {
    setFilter(f);
    trackEvent('library_filter', { filter: f });
  }, []);

  if (!loaded) {
    return (
      <div
        className="py-12 text-center"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
      >
        {t('loading')}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className="p-16 text-center"
        style={{
          background: 'var(--paper)',
          border: '2px dashed var(--ink)',
          borderRadius: 4,
        }}
      >
        <div
          className="mx-auto mb-5 grid h-16 w-16 place-items-center"
          style={{
            background: 'var(--hi)',
            border: '1.6px solid var(--ink)',
            borderRadius: 4,
            boxShadow: '3px 3px 0 var(--ink)',
            color: 'var(--ink)',
          }}
        >
          <I.Logo size={28} />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)' }}>{t('empty')}</h2>
        <Link href="/app" className="btn-sketch btn-sketch-primary mt-6 inline-flex">
          <span className="recording-indicator h-1.5 w-1.5 rounded-full" style={{ background: 'white' }} />
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
        <div
          className="mb-4 px-4 py-3"
          style={{
            background: 'var(--hi-soft)',
            border: '1.4px solid var(--ink)',
            borderRadius: 4,
            fontSize: 12.5,
            color: 'var(--ink)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {t('cloudSyncLede')}
        </div>
      )}

      {canCloud && (
        <div
          className="mb-4 flex flex-wrap items-center gap-3 px-4 py-2.5"
          style={{
            background: 'var(--paper-2)',
            border: '1.5px solid var(--ink)',
            borderRadius: 4,
            boxShadow: '3px 3px 0 var(--ink)',
          }}
        >
          <button
            type="button"
            onClick={allSelected ? deselectAll : selectAll}
            className="flex items-center gap-1.5"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--ink)',
              padding: '5px 10px',
              border: '1.4px solid var(--ink)',
              background: 'var(--paper)',
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            {allSelected ? <I.CheckSquare size={14} /> : <I.Square size={14} />}
            {allSelected ? t('deselectAll') : t('selectAll')}
            {someSelected && (
              <span
                className="ml-1 px-1.5"
                style={{ background: 'var(--hi)', color: 'var(--ink)', fontSize: 10, borderRadius: 2 }}
              >
                {selectedIds.size}
              </span>
            )}
          </button>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
            {t('selectionLine', {
              count: selectedIds.size,
              pending: selectedPendingIds.length,
            })}
          </div>
          <div className="flex-1" />
          {bulkProgress ? (
            <div
              className="flex items-center gap-2"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-2)' }}
            >
              <span
                className="inline-block h-3 w-3 animate-spin rounded-full"
                style={{ border: '2px solid var(--rule-soft)', borderTopColor: 'var(--ink)' }}
              />
              {t('savingAll', { done: bulkProgress.done, total: bulkProgress.total })}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleSaveAll()}
              disabled={
                (selectedPendingIds.length === 0 && eligibleForBulkBackup.length === 0)
              }
              className="btn-sketch btn-sketch-primary"
              style={{ padding: '7px 12px', fontSize: 10.5 }}
            >
              <I.CloudUpload size={13} />
              {t('saveAllToCloud')}
              {selectedPendingIds.length > 0 && (
                <span style={{ marginLeft: 4, background: 'var(--hi)', color: 'var(--ink)', padding: '0 6px', borderRadius: 2, fontSize: 10 }}>
                  {selectedPendingIds.length}
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {(statusMsg || errorMsg) && (
        <div className="mb-4 space-y-2">
          {statusMsg && (
            <div
              className="px-3 py-2"
              style={{
                background: 'var(--paper-2)',
                border: '1.4px solid var(--ink)',
                borderRadius: 3,
                fontSize: 12,
                color: 'var(--ink)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {statusMsg}
            </div>
          )}
          {errorMsg && (
            <div
              className="px-3 py-2"
              style={{
                background: 'var(--rec-soft)',
                border: '1.4px solid var(--rec)',
                borderRadius: 3,
                fontSize: 12,
                color: 'var(--rec)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {errorMsg}
            </div>
          )}
        </div>
      )}

      {/* 控制栏：筛选 chip + 排序 + 视图切换 */}
      <div
        className="mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
        style={{ background: 'var(--paper-2)', border: '1.5px solid var(--ink)', borderRadius: 4, boxShadow: '3px 3px 0 var(--ink)' }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label-mono" style={{ marginRight: 4 }}>{t('filterLabel')} ·</span>
          {(['all', 'unfinished', 'backed', 'local'] as const).map((k) => {
            const active = filter === k;
            const label = k === 'all' ? t('filterAll') : k === 'unfinished' ? t('filterUnfinished') : k === 'backed' ? t('filterBackedUp') : t('filterLocal');
            return (
              <button
                key={k}
                type="button"
                onClick={() => changeFilter(k)}
                style={{
                  padding: '5px 12px', border: '1.4px solid var(--ink)', borderRadius: 999,
                  background: active ? 'var(--hi)' : 'var(--paper)',
                  fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: 'var(--ink)', cursor: 'pointer', boxShadow: active ? '2px 2px 0 var(--ink)' : 'none',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <span className="label-mono">{t('sortLabel')}</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKind)}
            style={{ padding: '5px 10px', border: '1.4px solid var(--ink)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--paper)', color: 'var(--ink)', cursor: 'pointer' }}
          >
            <option value="newest">{t('sortNewest')}</option>
            <option value="oldest">{t('sortOldest')}</option>
            <option value="longest">{t('sortLongest')}</option>
          </select>
          <div style={{ width: 1.5, height: 22, background: 'var(--ink)', opacity: 0.4 }} />
          <div className="flex" style={{ border: '1.4px solid var(--ink)', borderRadius: 2, overflow: 'hidden' }}>
            {([['grid', I.Grid, t('viewGrid')], ['list', I.List, t('viewList')]] as const).map(([v, Ic, lbl]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v as ViewKind)}
                title={lbl}
                aria-label={lbl}
                style={{ padding: '6px 10px', background: view === v ? 'var(--ink)' : 'var(--paper)', color: view === v ? 'var(--paper)' : 'var(--ink)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <Ic size={13} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div className="p-12 text-center" style={{ border: '2px dashed var(--ink)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {t('noMatch')}
        </div>
      ) : view === 'list' ? (
        <div className="grid gap-2.5">
          {visibleItems.map((it) => {
            const d = displayMeta(it);
            const hasLocal = !!it.local;
            const hasCloud = !!it.cloud;
            const itemBusy = busy[d.id];
            const row = (
              <div className="flex items-center gap-4 px-3 py-2.5" style={{ background: 'var(--paper)', border: '1.5px solid var(--ink)', borderRadius: 4, boxShadow: '2px 2px 0 var(--ink)' }}>
                <div className="relative flex-shrink-0 overflow-hidden" style={{ width: 88, height: 50, background: 'var(--paper-2)', border: '1.2px solid var(--ink)', borderRadius: 2 }}>
                  {d.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 dots-fine-bg" style={{ opacity: 0.4 }} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{defaultTitle(d, locale)}</div>
                  <div className="mt-0.5 flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>
                    <span>{fmtDate(d.startedAt, locale)}</span>
                    <span>·</span>
                    <span>{fmtDuration(d.durationMs)}</span>
                    {hasLocal && hasCloud && <span>· {t('badgeSynced')}</span>}
                    {!hasLocal && hasCloud && <span>· {t('badgeCloud')}</span>}
                    {d.hasAudio && <I.Mic size={11} />}
                    {d.hasCamera && <I.Camera size={11} />}
                  </div>
                </div>
                {hasLocal && (
                  <Link href={`/export/${d.id}` as never} onClick={(e) => e.stopPropagation()} className="grid h-7 w-7 flex-shrink-0 place-items-center" style={{ background: 'var(--paper)', border: '1.3px solid var(--ink)', color: 'var(--ink)', borderRadius: 3 }} title={t('export')} aria-label={t('export')}>
                    <I.Download size={13} />
                  </Link>
                )}
                {hasLocal && (
                  <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleDelete(d.id); }} className="grid h-7 w-7 flex-shrink-0 place-items-center" style={{ background: 'var(--paper)', border: '1.3px solid var(--rec)', color: 'var(--rec)', borderRadius: 3 }} title={t('delete')} aria-label={t('delete')}>
                    <I.Trash size={13} />
                  </button>
                )}
              </div>
            );
            return hasLocal ? (
              <Link key={d.id} href={`/play/${d.id}` as never} className="block">{row}</Link>
            ) : (
              <div key={d.id} className="block cursor-pointer" onClick={() => { if (!itemBusy) void handleDownload(d.id, 'play'); }}>{row}</div>
            );
          })}
        </div>
      ) : (
      <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {visibleItems.map((it) => {
          const d = displayMeta(it);
          const isEditing = editingId === d.id;
          const hasLocal = !!it.local;
          const hasCloud = !!it.cloud;
          const itemBusy = busy[d.id];
          const selected = selectedIds.has(d.id);
          const tags = it.local?.tags ?? [];
          const editingTags = editingTagsId === d.id;

          // 云端状态决定第三颗 hover 图标的样式 + 行为
          const cloudIcon = (() => {
            if (!canCloud) {
              return {
                icon: <I.CloudOff size={13} />,
                tooltip: t('tooltipUpgradePro'),
                onClick: undefined as undefined | (() => void),
                style: { background: 'var(--paper-3)', color: 'var(--ink-3)' } as React.CSSProperties,
              };
            }
            if (itemBusy === 'upload') {
              return {
                icon: <span className="inline-block h-[13px] w-[13px] animate-spin rounded-full" style={{ border: '2px solid var(--rule-soft)', borderTopColor: 'var(--ink)' }} />,
                tooltip: t('uploading'),
                onClick: undefined as undefined | (() => void),
                style: { background: 'var(--paper)', color: 'var(--ink)' } as React.CSSProperties,
              };
            }
            if (hasLocal && hasCloud) {
              return {
                icon: <I.CloudCheck size={13} />,
                tooltip: t('tooltipSavedClickRemove'),
                onClick: () => void handleRemoveFromCloud(d.id),
                style: { background: 'var(--pro)', color: 'var(--ink)' } as React.CSSProperties,
              };
            }
            if (hasLocal && !hasCloud) {
              return {
                icon: <I.CloudUpload size={13} />,
                tooltip: t('saveToCloud'),
                onClick: () => void handleUpload(d.id),
                style: { background: 'var(--paper)', color: 'var(--ink)' } as React.CSSProperties,
              };
            }
            // cloud-only：不显示云图标（用户不会想"从云上传到云"）
            return null;
          })();

          const tileInner = (
            <>
              <div
                className="relative overflow-hidden"
                style={{ aspectRatio: '16/9', margin: 12, background: 'var(--paper-3)', border: '1.4px solid var(--ink)', borderRadius: 3 }}
              >
                <div className="absolute inset-0 dots-fine" style={{ opacity: 0.5 }} />
                {/* 封面 hover 轻放大（被 overflow-hidden 裁切，对标设计 group-hover:scale） */}
                <div className="absolute inset-0 transition-transform duration-300 ease-out group-hover:scale-105">
                  <ThumbScene seed={d.id} />
                </div>
                <span
                  className="absolute right-2 top-2 group-hover:opacity-0"
                  style={{
                    background: 'var(--ink)',
                    color: 'var(--paper)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 2,
                    letterSpacing: '0.04em',
                    transition: 'opacity .15s',
                  }}
                >
                  {fmtDuration(d.durationMs)}
                </span>
                {d.status === 'recording' && (
                  <span
                    className="absolute left-2 top-2"
                    style={{
                      background: 'var(--hi)',
                      border: '1.2px solid var(--ink)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      padding: '2px 8px',
                      borderRadius: 999,
                      color: 'var(--ink)',
                    }}
                  >
                    {locale === 'en' ? 'unfinished' : '未完成'}
                  </span>
                )}
                {!hasLocal && hasCloud && (
                  <div className="absolute inset-0 grid place-items-center" style={{ background: 'rgba(26,26,26,0.35)' }}>
                    <div
                      className="flex items-center gap-1.5"
                      style={{
                        background: 'var(--paper)',
                        border: '1.4px solid var(--ink)',
                        borderRadius: 3,
                        boxShadow: '2px 2px 0 var(--ink)',
                        padding: '6px 14px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: 'var(--ink)',
                      }}
                    >
                      <I.CloudUpload size={13} />
                      {itemBusy === 'download' ? t('downloading') : t('downloadFromCloud')}
                    </div>
                  </div>
                )}

                <div className="pointer-events-none absolute inset-0 transition group-hover:bg-black/10" />
                {hasLocal && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                    <div
                      className="grid h-12 w-12 place-items-center rounded-full"
                      style={{
                        background: 'var(--paper)',
                        border: '1.6px solid var(--ink)',
                        boxShadow: '3px 3px 0 var(--ink)',
                        color: 'var(--ink)',
                      }}
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
                    className="w-full px-2 py-1 outline-none"
                    style={{
                      border: '1.4px solid var(--ink)',
                      background: 'var(--paper)',
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: 'var(--font-sans)',
                      color: 'var(--ink)',
                      borderRadius: 2,
                    }}
                  />
                ) : (
                  <div className="flex items-start gap-1">
                    <div
                      className="min-w-0 flex-1"
                      style={{
                        fontSize: 14, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em', lineHeight: 1.3,
                        display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}
                    >
                      {defaultTitle(d, locale)}
                    </div>
                    {hasLocal && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEdit(it); }}
                        className="flex-shrink-0 p-1 opacity-0 transition group-hover:opacity-100"
                        style={{
                          background: 'var(--paper)',
                          border: '1.2px solid var(--ink)',
                          borderRadius: 2,
                          color: 'var(--ink)',
                        }}
                        title={locale === 'en' ? 'Rename' : '重命名'}
                        aria-label={locale === 'en' ? 'Rename' : '重命名'}
                      >
                        <I.Edit size={11} />
                      </button>
                    )}
                  </div>
                )}
                {/* 元信息行：录制于 {相对时间} */}
                <div
                  className="mt-1.5"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.03em' }}
                >
                  {t('recordedAt', { date: fmtDate(d.startedAt, locale) })}
                </div>

                {/* 类别标签 pills（首个高亮）+ 状态 + 编辑入口 */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {editingTags ? (
                    <input
                      ref={tagsInputRef}
                      type="text"
                      value={tagsDraft}
                      onChange={(e) => setTagsDraft(e.target.value)}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') { e.preventDefault(); void commitTags(d.id); }
                        else if (e.key === 'Escape') { e.preventDefault(); setEditingTagsId(null); }
                      }}
                      onBlur={() => { void commitTags(d.id); }}
                      placeholder={t('tagsPlaceholder')}
                      maxLength={60}
                      className="w-full px-2 py-1 outline-none"
                      style={{ border: '1.3px solid var(--ink)', background: 'var(--paper)', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink)', borderRadius: 2 }}
                    />
                  ) : (
                    <>
                      {tags.map((tag, ti) => <Pill key={tag} hi={ti === 0}>{tag}</Pill>)}
                      {hasLocal && hasCloud && <Pill><I.Cloud size={9} sw={2.5} /> {t('badgeSynced')}</Pill>}
                      {hasLocal && !hasCloud && <Pill>{t('badgeLocal')}</Pill>}
                      {!hasLocal && hasCloud && <Pill><I.Cloud size={9} sw={2.5} /> {t('badgeCloud')}</Pill>}
                      {hasLocal && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEditTags(it); }}
                          className="inline-flex items-center gap-1 opacity-0 transition group-hover:opacity-100"
                          style={{ padding: '2px 8px', border: '1px dashed var(--ink)', borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-2)', cursor: 'pointer', background: 'var(--paper)' }}
                          title={t('addTag')}
                        >
                          <I.Tag size={9} /> {t('addTag')}
                        </button>
                      )}
                    </>
                  )}
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
              className="group relative overflow-hidden transition hover:-translate-y-[2px]"
              style={{
                background: 'var(--paper)',
                border: '1.6px solid var(--ink)',
                borderRadius: 4,
                boxShadow: selected ? '5px 5px 0 var(--hi)' : '3px 3px 0 var(--ink)',
                transform: selected ? 'translate(-1px, -1px)' : undefined,
              }}
            >
              {canCloud && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelect(d.id); }}
                  className="absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center transition"
                  style={{
                    background: selected ? 'var(--ink)' : 'var(--paper)',
                    color: selected ? 'var(--paper)' : 'var(--ink)',
                    border: '1.3px solid var(--ink)',
                    borderRadius: 3,
                    opacity: selected ? 1 : undefined,
                    boxShadow: selected ? '2px 2px 0 var(--ink)' : 'none',
                  }}
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
                    className="grid h-7 w-7 place-items-center"
                    style={{
                      background: 'var(--paper)',
                      border: '1.3px solid var(--ink)',
                      color: 'var(--ink)',
                      borderRadius: 3,
                    }}
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
                    className="grid h-7 w-7 place-items-center transition disabled:cursor-default"
                    style={{ ...cloudIcon.style, border: '1.3px solid var(--ink)', borderRadius: 3 }}
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
                    className="grid h-7 w-7 place-items-center"
                    style={{
                      background: 'var(--paper)',
                      border: '1.3px solid var(--rec)',
                      color: 'var(--rec)',
                      borderRadius: 3,
                    }}
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
      )}
    </div>
  );
}
