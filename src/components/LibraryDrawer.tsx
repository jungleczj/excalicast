'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { v4 as uuidv4 } from 'uuid';
import { I } from '@/components/icons';
import { LibraryItemCard } from '@/components/LibraryItemCard';
import { MarketplaceBrowser } from '@/components/MarketplaceBrowser';
import {
  addLibraryItem,
  getAllLibraryItems,
  removeLibraryItem,
  type LibraryItemRow,
} from '@/lib/db-client';
import { invalidateThumbnail } from '@/utils/libraryThumbnail';

const BROADCAST_CHANNEL = 'excalicast-library';
const SAME_TAB_EVENT = 'excalicast-library-updated';

interface Props {
  open: boolean;
  onClose: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  excalidrawApiRef: React.RefObject<any>;
}

export function LibraryDrawer({ open, onClose, excalidrawApiRef }: Props): JSX.Element | null {
  const t = useTranslations('libraryDrawer');
  const [items, setItems] = useState<LibraryItemRow[]>([]);
  const [view, setView] = useState<'mine' | 'market'>('mine');
  // 用 tick 强制重渲：getAppState().selectedElementIds 没有 React 订阅，按需 polling
  const [, setTick] = useState(0);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // 首次打开 / 任何时刻：拉一次 IDB
  useEffect(() => {
    let cancelled = false;
    void getAllLibraryItems().then((rows) => {
      if (!cancelled) setItems(rows);
    });
    return () => { cancelled = true; };
  }, []);

  // 跨 tab：BroadcastChannel —— 别的 tab 改了 IDB 之后过来通知
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      const ch = new BroadcastChannel(BROADCAST_CHANNEL);
      channelRef.current = ch;
      ch.onmessage = async (ev) => {
        if (ev.data?.type !== 'updated') return;
        const fresh = await getAllLibraryItems().catch(() => [] as LibraryItemRow[]);
        setItems(fresh);
      };
      return () => { ch.close(); channelRef.current = null; };
    } catch {
      return;
    }
  }, []);

  // 同 tab：window CustomEvent —— BroadcastChannel 不会派发到同 browsing context
  // 所以同 tab 的 Whiteboard 改 IDB 之后这边收不到，必须用 window 事件兜底。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = async () => {
      const fresh = await getAllLibraryItems().catch(() => [] as LibraryItemRow[]);
      setItems(fresh);
    };
    window.addEventListener(SAME_TAB_EVENT, handler);
    return () => window.removeEventListener(SAME_TAB_EVENT, handler);
  }, []);

  // 打开抽屉时每 500ms 探一下选区，决定「+添加选中」是否 disabled
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [open]);

  const selectionCount = (() => {
    const api = excalidrawApiRef.current;
    if (!api) return 0;
    try {
      const ids = api.getAppState()?.selectedElementIds ?? {};
      return Object.keys(ids).filter((k) => ids[k]).length;
    } catch {
      return 0;
    }
  })();

  const broadcastUpdated = useCallback(() => {
    try {
      channelRef.current?.postMessage({ type: 'updated' });
    } catch { /* ignore */ }
    try {
      window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT));
    } catch { /* ignore */ }
  }, []);

  const handleAddSelected = useCallback(async () => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    try {
      const all = api.getSceneElements() ?? [];
      const sel = api.getAppState()?.selectedElementIds ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const elements = (all as any[]).filter((e: any) => sel[e.id]);
      if (elements.length === 0) return;
      const item: LibraryItemRow = {
        id: uuidv4(),
        status: 'unpublished',
        elements,
        created: Date.now(),
      };
      await addLibraryItem(item);
      setItems((prev) => [...prev, item]);
      broadcastUpdated();
    } catch (err) {
      console.error('add_to_library_failed', err);
    }
  }, [excalidrawApiRef, broadcastUpdated]);

  const handleDelete = useCallback(async (id: string) => {
    await removeLibraryItem(id);
    invalidateThumbnail(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
    broadcastUpdated();
  }, [broadcastUpdated]);

  // 导入完成后：刷新自家列表并切回"我的模板"
  const handleImported = useCallback(async () => {
    const fresh = await getAllLibraryItems().catch(() => [] as LibraryItemRow[]);
    setItems(fresh);
    setView('mine');
  }, []);

  if (!open) return null;

  const canAdd = selectionCount > 0;

  return (
    <div
      className="rb-no-record fixed right-0 top-0 z-40 flex h-full flex-col"
      style={{
        width: 320,
        background: 'var(--paper)',
        borderLeft: '1.5px solid var(--ink)',
        boxShadow: '-4px 0 0 var(--hi)',
        color: 'var(--ink)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2"
        style={{
          padding: '12px 14px',
          borderBottom: '1.5px solid var(--ink)',
        }}
      >
        {view === 'market' && (
          <button
            type="button"
            onClick={() => setView('mine')}
            title={t('back')}
            className="grid place-items-center"
            style={{
              width: 24, height: 24, background: 'var(--paper)', border: '1.4px solid var(--ink)',
              borderRadius: 3, color: 'var(--ink)', cursor: 'pointer', padding: 0,
            }}
          >
            <I.ChevronLeft size={12} />
          </button>
        )}
        <span
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}
        >
          {view === 'market' ? t('marketTitle') : t('title')}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          title={t('close')}
          className="grid place-items-center"
          style={{
            width: 26, height: 26, background: 'var(--paper)', border: '1.4px solid var(--ink)',
            borderRadius: 3, color: 'var(--ink)', cursor: 'pointer', padding: 0,
          }}
        >
          <I.Close size={12} />
        </button>
      </div>

      {view === 'market' ? (
        <MarketplaceBrowser onImported={handleImported} />
      ) : (
        <>
          {/* Actions */}
          <div className="flex flex-col gap-2" style={{ padding: '10px 12px' }}>
            <button
              type="button"
              onClick={handleAddSelected}
              disabled={!canAdd}
              title={canAdd ? t('addSelected') : t('addSelectedDisabled')}
              className="flex items-center justify-center gap-2"
              style={{
                padding: '7px 10px',
                background: canAdd ? 'var(--hi)' : 'rgba(0,0,0,0.04)',
                border: '1.5px solid var(--ink)',
                borderRadius: 3,
                boxShadow: canAdd ? '2px 2px 0 var(--ink)' : 'none',
                color: 'var(--ink)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: canAdd ? 'pointer' : 'not-allowed',
                opacity: canAdd ? 1 : 0.55,
              }}
            >
              <I.Plus size={13} />
              {t('addSelected')}
              {canAdd && <span style={{ opacity: 0.7 }}>· {selectionCount}</span>}
            </button>
            <button
              type="button"
              onClick={() => setView('market')}
              title={t('browse')}
              className="flex items-center justify-center gap-2"
              style={{
                padding: '7px 10px',
                background: 'var(--paper)',
                border: '1.5px solid var(--ink)',
                borderRadius: 3,
                color: 'var(--ink)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              <I.Sparkles size={13} />
              {t('browse')}
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto" style={{ padding: '4px 12px 14px' }}>
            {items.length === 0 ? (
              <div
                style={{
                  padding: '24px 6px',
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  color: 'var(--ink-3)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.02em',
                }}
              >
                {t('empty')}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {items.map((item) => (
                  <LibraryItemCard
                    key={item.id}
                    item={item}
                    onDelete={handleDelete}
                    deleteTooltip={t('deleteTooltip')}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
