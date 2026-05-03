'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listRecordings, deleteRecording } from '@/lib/db-client';
import { I } from '@/components/icons';
import type { RecordingMetadata } from '@/types/recording';


interface Props {
  refreshKey?: number;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;
  if (diff < 24 * 3600_000 && d.getDate() === now.getDate()) return '今天';
  if (diff < 48 * 3600_000) return '昨天';
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

const TINTS = [
  'linear-gradient(135deg, #fef3c7, #fde68a)',
  'linear-gradient(135deg, #dbeafe, #bfdbfe)',
  'linear-gradient(135deg, #ede9fe, #ddd6fe)',
  'linear-gradient(135deg, #dcfce7, #bbf7d0)',
];

export function RecordingsList({ refreshKey = 0 }: Props): JSX.Element {
  const [items, setItems] = useState<RecordingMetadata[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const list = await listRecordings();
    setItems(list);
    setLoaded(true);
  }, []);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('删除这条录制？此操作不可恢复。')) return;
    await deleteRecording(id);
    await refresh();
  }, [refresh]);

  if (!loaded) {
    return <div className="py-12 text-center text-sm text-text-tertiary">加载中…</div>;
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
        <h2 className="text-[18px] font-bold text-text-primary">还没有录制</h2>
        <p className="mt-1.5 text-[13px] text-text-secondary">点开始按钮，第一段讲解就会出现在这里。</p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-[13px] font-semibold text-white"
          style={{ background: 'var(--recording-strong)', boxShadow: '0 4px 12px rgba(220,38,38,0.25)' }}
        >
          <span className="h-2 w-2 rounded-full bg-white" />
          开始第一次录制
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
      {items.map((m, i) => {
        const tint = TINTS[(m.id.charCodeAt(0) + i) % 4];
        return (
          <div
            key={m.id}
            className="group relative overflow-hidden rounded-xl border border-border-default bg-bg-primary transition-all duration-150 hover:-translate-y-0.5"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
          >
            <Link href={`/export/${m.id}`} className="block">
              <div
                className="relative overflow-hidden"
                style={{ aspectRatio: '16/9', background: tint }}
              >
                {m.lastFrameThumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.lastFrameThumbnail} alt="thumbnail" className="h-full w-full object-cover" />
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
                  {fmtDuration(m.durationMs)}
                </span>
                {m.status === 'recording' && (
                  <span className="absolute left-2 top-2 rounded bg-recording px-2 py-0.5 text-[10px] font-semibold text-white">未完成</span>
                )}

                {/* hover 状态：黑色蒙层 + 中央 Play 按钮 */}
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
                <div className="truncate text-[13.5px] font-semibold text-text-primary">
                  录制 {m.id.slice(0, 8)}
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-tertiary">
                  <span>{fmtDate(m.startedAt)}</span>
                  <span
                    className="rounded px-1.5 py-px text-[10px] font-semibold"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                  >本机</span>
                  <div className="flex-1" />
                  {m.hasAudio && <I.Mic size={13} />}
                  {m.hasCamera && <I.Camera size={13} />}
                </div>
              </div>
            </Link>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); void handleDelete(m.id); }}
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-white opacity-0 transition group-hover:opacity-100"
              style={{ background: 'rgba(0,0,0,0.7)' }}
              title="删除"
            >
              <I.Trash size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
