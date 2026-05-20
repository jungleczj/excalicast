'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  deleteRecording,
  deleteScreenRecording,
  listRecordings,
  listScreenRecordings,
  updateRecordingTitle,
} from '@/lib/db-client';
import { I } from '@/components/icons';
import type { RecordingMetadata, ScreenRecordingMetadata } from '@/types/recording';

interface Props {
  refreshKey?: number;
}

interface MergedItem {
  id: string;
  kind: 'scene_replay' | 'screen_capture';
  startedAt: number;
  durationMs: number;
  title?: string;
  hasAudio: boolean;
  hasCamera: boolean;
  thumbnail?: string | null;
  status: 'recording' | 'done' | 'error';
}

function fromSceneReplay(m: RecordingMetadata): MergedItem {
  return {
    id: m.id,
    kind: 'scene_replay',
    startedAt: m.startedAt,
    durationMs: m.durationMs,
    title: m.title,
    hasAudio: m.hasAudio,
    hasCamera: m.hasCamera,
    thumbnail: m.lastFrameThumbnail,
    status: m.status,
  };
}

function fromScreenCapture(m: ScreenRecordingMetadata): MergedItem {
  return {
    id: m.id,
    kind: 'screen_capture',
    startedAt: m.startedAt,
    durationMs: m.durationMs,
    title: m.title,
    hasAudio: m.hasMic || m.hasSystemAudio,
    hasCamera: m.hasCamera,
    thumbnail: m.thumbnail ?? null,
    status: m.status,
  };
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

export function RecordingsList({ refreshKey = 0 }: Props): JSX.Element {
  const t = useTranslations('library');
  const locale = useLocale();
  const [items, setItems] = useState<MergedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const [localOld, localNew] = await Promise.all([
      listRecordings(),
      listScreenRecordings(),
    ]);
    const merged: MergedItem[] = [
      ...localOld.map(fromSceneReplay),
      ...localNew.map(fromScreenCapture),
    ].sort((a, b) => b.startedAt - a.startedAt);
    setItems(merged);
    setLoaded(true);
  }, []);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleDelete = useCallback(async (it: MergedItem) => {
    if (!confirm(t('deleteConfirm'))) return;
    if (it.kind === 'screen_capture') {
      await deleteScreenRecording(it.id);
    } else {
      await deleteRecording(it.id);
    }
    await refresh();
  }, [refresh, t]);

  const startEdit = useCallback((it: MergedItem) => {
    setEditingId(it.id);
    setEditValue(defaultTitle(it, locale));
  }, [locale]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  const commitEdit = useCallback(async (it: MergedItem) => {
    const next = editValue;
    setEditingId(null);
    setEditValue('');
    if (it.kind === 'scene_replay') {
      await updateRecordingTitle(it.id, next);
    } else {
      // Screen-capture rename: inline Dexie update (no dedicated helper yet).
      const { getClientDb } = await import('@/lib/db-client');
      await getClientDb().screenRecordings.update(it.id, {
        title: next.trim().length > 0 ? next.trim() : undefined,
      });
    }
    await refresh();
  }, [editValue, refresh]);

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
    <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
      {items.map((it, i) => {
        const tint = TINTS[(it.id.charCodeAt(0) + i) % 4];
        const isEditing = editingId === it.id;
        const playRoute = it.kind === 'screen_capture' ? '/process' : '/play';
        const downloadRoute = it.kind === 'screen_capture' ? '/process' : '/export';
        return (
          <div
            key={it.id}
            className="group relative overflow-hidden rounded-xl border border-border-default bg-bg-primary transition-all duration-150 hover:-translate-y-0.5"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
          >
            <Link href={`${playRoute}/${it.id}` as never} className="block">
              <div className="relative overflow-hidden" style={{ aspectRatio: '16/9', background: tint }}>
                {it.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.thumbnail} alt="thumbnail" className="h-full w-full object-cover" />
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
                  {fmtDuration(it.durationMs)}
                </span>
                {it.status === 'recording' && (
                  <span className="absolute left-2 top-2 rounded bg-recording px-2 py-0.5 text-[10px] font-semibold text-white">
                    {locale === 'en' ? 'unfinished' : '未完成'}
                  </span>
                )}
                <div className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover:bg-black/15" />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                  <div
                    className="grid h-12 w-12 place-items-center rounded-full text-text-primary"
                    style={{ background: 'rgba(255,255,255,0.95)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
                  >
                    <I.Play size={20} />
                  </div>
                </div>
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
                      if (e.key === 'Enter') { e.preventDefault(); void commitEdit(it); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                    }}
                    onBlur={() => { void commitEdit(it); }}
                    maxLength={80}
                    className="w-full rounded border border-primary-600 bg-bg-primary px-1.5 py-0.5 text-[13.5px] font-semibold text-text-primary outline-none"
                  />
                ) : (
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-text-primary">
                      {defaultTitle(it, locale)}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEdit(it); }}
                      className="flex-shrink-0 rounded p-0.5 text-text-tertiary opacity-0 transition hover:bg-bg-tertiary hover:text-text-primary group-hover:opacity-100"
                      title={locale === 'en' ? 'Rename' : '重命名'}
                      aria-label={locale === 'en' ? 'Rename' : '重命名'}
                    >
                      <I.Edit size={12} />
                    </button>
                  </div>
                )}
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-tertiary">
                  <span>{fmtDate(it.startedAt, locale)}</span>
                  <div className="flex-1" />
                  {it.hasAudio && <I.Mic size={13} />}
                  {it.hasCamera && <I.Camera size={13} />}
                </div>
              </div>
            </Link>
            <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100">
              <Link
                href={`${downloadRoute}/${it.id}` as never}
                onClick={(e) => e.stopPropagation()}
                className="grid h-7 w-7 place-items-center rounded-md text-white transition hover:bg-primary-600"
                style={{ background: 'rgba(0,0,0,0.7)' }}
                title={locale === 'en' ? 'Download' : '下载'}
              >
                <I.Download size={13} />
              </Link>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleDelete(it); }}
                className="grid h-7 w-7 place-items-center rounded-md text-white transition"
                style={{ background: 'rgba(0,0,0,0.7)' }}
                title={locale === 'en' ? 'Delete' : '删除'}
              >
                <I.Trash size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
