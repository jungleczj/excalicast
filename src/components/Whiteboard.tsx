'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import {
  getAllLibraryItems,
  replaceLibraryItems,
  type LibraryItemRow,
} from '@/lib/db-client';

const Excalidraw = dynamic(
  async () => (await import('@excalidraw/excalidraw')).Excalidraw,
  { ssr: false, loading: () => <div className="grid h-full place-items-center text-text-tertiary" /> },
);

export interface WhiteboardChangeFn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (elements: readonly any[], appState: Record<string, unknown>, files: Record<string, unknown>): void;
}

interface Props {
  onChangeRef: RefObject<WhiteboardChangeFn | null>;
}

export default function Whiteboard({ onChangeRef }: Props): JSX.Element {
  const [libraryItems, setLibraryItems] = useState<LibraryItemRow[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  // 从 IndexedDB 装载用户的 Excalidraw library。完成前不挂载 Excalidraw —
  // 否则 initialData.libraryItems 已经空了，老 library 会瞬间被空 onLibraryChange 覆盖回 IDB。
  useEffect(() => {
    let cancelled = false;
    void getAllLibraryItems()
      .then((items) => {
        if (cancelled) return;
        setLibraryItems(items);
      })
      .catch(() => { /* 缓存读不出来就当空 */ })
      .finally(() => {
        if (!cancelled) setLibraryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlers = useMemo(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange: (elements: readonly any[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      onChangeRef.current?.(elements, appState, files);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onLibraryChange: async (items: readonly any[]) => {
      // Excalidraw 全量回调；落 IDB（含从 libraries.excalidraw.com 市集导入进来的）。
      const rows: LibraryItemRow[] = items.map((it) => ({
        id: String(it.id),
        status: (it.status === 'published' ? 'published' : 'unpublished') as 'published' | 'unpublished',
        elements: Array.isArray(it.elements) ? (it.elements as unknown[]) : [],
        created: typeof it.created === 'number' ? it.created : Date.now(),
        name: typeof it.name === 'string' ? it.name : undefined,
      }));
      try { await replaceLibraryItems(rows); } catch { /* 配额满等 */ }
    },
  }), [onChangeRef]);

  // libraryReturnUrl 要指向当前 app 页面 —— libraries.excalidraw.com 市集挑完模版后
  // 会跳回这里（带 ?addLibrary= 参数），Excalidraw 的 useHandleLibrary 自动 import。
  const libraryReturnUrl = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    return `${window.location.origin}${window.location.pathname}`;
  }, []);

  if (!libraryLoaded) {
    return <div className="excalicast-board absolute inset-0 bg-canvas-bg" />;
  }

  return (
    <div className="excalicast-board absolute inset-0 bg-canvas-bg">
      <Excalidraw
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange={handlers.onChange as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onLibraryChange={handlers.onLibraryChange as any}
        libraryReturnUrl={libraryReturnUrl}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialData={{ libraryItems: libraryItems as any }}
      />
    </div>
  );
}
