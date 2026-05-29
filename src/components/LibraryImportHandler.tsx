'use client';

import { useEffect } from 'react';
import { importLibraryFromUrl } from '@/utils/libraryImport';

function maybeClosePopup(imported: number): void {
  // market 弹出 tab（有 opener）导入成功后自动关，焦点回原 tab；延后 150ms 给广播 drain。
  if (imported > 0 && window.opener) {
    setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 150);
  }
}

/**
 * 兼容性兜底：处理 `#addLibrary=<url>` 形式的回流（手工构造的链接，或未来 market 改回 target）。
 * 注意：libraries.excalidraw.com 的 "Add to Excalidraw" 实际跳的是 excalidraw.com 官方应用，
 * 不会回到我们这里 —— 所以本项目的主路径是 MarketplaceBrowser（应用内浏览导入），
 * 这个 handler 只作 hash 兜底，挂在全局 layout，任何页面都能接住。
 */
export function LibraryImportHandler(): null {
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pending = (window as any).__excalicastPendingLib as string | undefined;
    if (pending) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__excalicastPendingLib = undefined;
      void importLibraryFromUrl(pending).then(maybeClosePopup);
    }

    const onHashChange = () => {
      const m = window.location.hash.match(/addLibrary=([^&]+)/);
      if (!m) return;
      const libUrl = decodeURIComponent(m[1]);
      try {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch { /* ignore */ }
      void importLibraryFromUrl(libUrl).then(maybeClosePopup);
    };
    onHashChange();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return null;
}
