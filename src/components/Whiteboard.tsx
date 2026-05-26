'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLocale } from 'next-intl';
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

// Excalidraw 的 LibraryItem 转 IDB row 的小工具。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(it: any): LibraryItemRow {
  return {
    id: String(it.id),
    status: (it.status === 'published' ? 'published' : 'unpublished') as 'published' | 'unpublished',
    elements: Array.isArray(it.elements) ? (it.elements as unknown[]) : [],
    created: typeof it.created === 'number' ? it.created : Date.now(),
    name: typeof it.name === 'string' ? it.name : undefined,
  };
}

const BROADCAST_CHANNEL = 'excalicast-library';

export default function Whiteboard({ onChangeRef }: Props): JSX.Element {
  const locale = useLocale();
  const [libraryItems, setLibraryItems] = useState<LibraryItemRow[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);

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

  // 主动监听 url hash —— 市集（libraries.excalidraw.com）选完模版后跳回
  // `${return}#addLibrary=<url>&token=<token>`。Excalidraw 内部 useHandleLibrary
  // 通常也会处理这个 hash，但部分时序下不触发（dynamic import / SSR 边界）。
  // 我们自己 fetch + 写 IDB + 广播给其它 tab 兜底。完成后关闭自己。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const m = window.location.hash.match(/addLibrary=([^&]+)/);
    if (!m) return;
    const libUrl = decodeURIComponent(m[1]);
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(libUrl);
        if (!resp.ok || cancelled) return;
        const lib = await resp.json();
        // .excalidrawlib v2: { type:'excalidrawlib', version:2, libraryItems: LibraryItem[] }
        const incoming = Array.isArray(lib?.libraryItems) ? lib.libraryItems : [];
        if (incoming.length === 0) return;
        // 合并到本地（先读最新 IDB 而不是用 React state，防止时序窗口）
        const current = await getAllLibraryItems().catch(() => [] as LibraryItemRow[]);
        const merged: LibraryItemRow[] = [...current, ...incoming.map(toRow)];
        await replaceLibraryItems(merged);
        // 广播给所有其它 tab（原始录制 tab 会收到并 updateLibrary）
        try {
          new BroadcastChannel(BROADCAST_CHANNEL).postMessage({ type: 'updated' });
        } catch { /* 浏览器不支持 BroadcastChannel */ }
        // 清掉 hash 避免下次 mount 又触发
        try {
          history.replaceState(null, '', window.location.pathname + window.location.search);
        } catch { /* ignore */ }
        // 本 tab 也立即 reflect
        setLibraryItems(merged);
        apiRef.current?.updateLibrary?.({
          libraryItems: merged,
          openLibraryMenu: true,
        });
        // 如果是市集打开的弹出 tab（有 window.opener），关闭自己
        if (window.opener) {
          try { window.close(); } catch { /* ignore */ }
        }
      } catch { /* 网络 / CORS 错误就静默 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // 订阅 BroadcastChannel —— 别的 tab import 完模版会广播过来，本 tab 更新 library。
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(BROADCAST_CHANNEL);
      ch.onmessage = async (ev) => {
        if (ev.data?.type !== 'updated') return;
        const fresh = await getAllLibraryItems().catch(() => [] as LibraryItemRow[]);
        setLibraryItems(fresh);
        apiRef.current?.updateLibrary?.({
          libraryItems: fresh,
          openLibraryMenu: true,
        });
      };
    } catch { /* ignore */ }
    return () => { ch?.close(); };
  }, []);

  const handlers = useMemo(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange: (elements: readonly any[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      onChangeRef.current?.(elements, appState, files);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onLibraryChange: async (items: readonly any[]) => {
      // Excalidraw 全量回调；落 IDB（含从 libraries.excalidraw.com 市集导入进来的）。
      const rows = items.map(toRow);
      try {
        await replaceLibraryItems(rows);
        // 通知其它 tab 也同步
        try {
          new BroadcastChannel(BROADCAST_CHANNEL).postMessage({ type: 'updated' });
        } catch { /* ignore */ }
      } catch { /* 配额满等 */ }
    },
  }), [onChangeRef]);

  // libraryReturnUrl 始终基于 locale 拼到 /app —— 不依赖 window.location.pathname，
  // 否则用户万一是从 /library 间接过来，回跳就会落错地方。
  const libraryReturnUrl = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    return `${window.location.origin}/${locale}/app`;
  }, [locale]);

  if (!libraryLoaded) {
    return <div className="excalicast-board absolute inset-0 bg-canvas-bg" />;
  }

  return (
    <div className="excalicast-board absolute inset-0 bg-canvas-bg">
      <Excalidraw
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        excalidrawAPI={(api: any) => { apiRef.current = api; }}
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
