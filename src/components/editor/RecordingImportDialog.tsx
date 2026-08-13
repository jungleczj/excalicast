'use client';

import { useEffect, useMemo, useState, type JSX } from 'react';
import { I } from '@/components/icons';
import { listRecordingSummaries } from '@/lib/db-client';
import { getCurrentOwnerKey } from '@/lib/ownerKey';
import type { RecordingLibrarySummary } from '@/types/recording';

interface Props {
  open: boolean;
  currentRecordingId: string;
  en: boolean;
  onClose: () => void;
  onImport: (recordings: RecordingLibrarySummary[]) => void;
}

function formatDuration(durationMs: number): string {
  const total = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function RecordingImportDialog({ open, currentRecordingId, en, onClose, onImport }: Props): JSX.Element | null {
  const [items, setItems] = useState<RecordingLibrarySummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSelected([]);
    void getCurrentOwnerKey()
      .then((ownerKey) => listRecordingSummaries(ownerKey, { limit: 100, signal: controller.signal }))
      .then((page) => setItems(page.items.filter((item) => (
        item.id !== currentRecordingId && (item.status === 'done' || item.status === 'interrupted')
      ))))
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : 'recording_library_failed');
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [currentRecordingId, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const selectedItems = useMemo(() => selected
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is RecordingLibrarySummary => !!item), [items, selected]);
  if (!open) return null;

  return (
    <div className="recording-import-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="recording-import-dialog" role="dialog" aria-modal="true" aria-labelledby="recording-import-title">
        <header className="recording-import-header">
          <div>
            <span className="label-mono">{en ? 'MAIN TRACK' : '主轨'}</span>
            <h2 id="recording-import-title">{en ? 'Import recordings' : '导入录制'}</h2>
            <p>{en ? 'Choose one or more recordings. They will be inserted at the playhead in this order.' : '选择一个或多个录制，将按当前顺序插入播放头位置。'}</p>
          </div>
          <button type="button" className="recording-import-close" onClick={onClose} aria-label={en ? 'Close' : '关闭'}><I.Close size={15} /></button>
        </header>

        <div className="recording-import-list" role="listbox" aria-multiselectable="true">
          {loading && <div className="recording-import-empty">{en ? 'Loading recording library…' : '正在读取录制库…'}</div>}
          {!loading && error && <div className="recording-import-empty is-error">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="recording-import-empty">{en ? 'No other local recordings are available.' : '录制库中暂无其他可导入的录制。'}</div>
          )}
          {!loading && !error && items.map((item) => {
            const checked = selected.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={checked}
                className={`recording-import-item${checked ? ' is-selected' : ''}`}
                onClick={() => setSelected((current) => checked
                  ? current.filter((id) => id !== item.id)
                  : [...current, item.id])}
              >
                <span className="recording-import-check">{checked ? '✓' : ''}</span>
                <span className="recording-import-copy">
                  <strong>{item.title?.trim() || (en ? `Recording ${item.id.slice(0, 8)}` : `录制 ${item.id.slice(0, 8)}`)}</strong>
                  <small>{new Date(item.startedAt).toLocaleString()} · {formatDuration(item.durationMs)}</small>
                </span>
                <span className="recording-import-media">{item.hasCamera ? (en ? 'Camera' : '摄像头') : (en ? 'Screen' : '画面')}</span>
              </button>
            );
          })}
        </div>

        <footer className="recording-import-footer">
          <span>{en ? `${selected.length} selected` : `已选择 ${selected.length} 条`}</span>
          <div>
            <button type="button" className="btn-sketch" onClick={onClose}>{en ? 'Cancel' : '取消'}</button>
            <button
              type="button"
              className="btn-sketch is-primary"
              data-testid="confirm-import-recordings"
              onClick={() => {
                if (selectedItems.length === 0) return;
                onImport(selectedItems);
                onClose();
              }}
              aria-disabled={selectedItems.length === 0}
            >
              <I.Plus size={12} /> {en ? 'Insert into main track' : '插入主轨'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
