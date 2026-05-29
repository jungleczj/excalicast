import type { LibraryItemRow } from '@/lib/db-client';

const cache = new Map<string, string>();

/**
 * 把一个 library item 的 elements 渲染成 SVG，再转 data URL 给 <img src=> 用。
 *  - 按 id 缓存（一个 item 只渲一次；除非用户改它，但 MVP 不支持改）
 *  - 异常 → 返回空 data URL 让组件兜底显示占位
 *
 * 调 Excalidraw 的公开 `exportToSvg` —— v0.17.6 types.d.ts 里有 utils 路径。
 */
export async function libraryThumbnail(item: LibraryItemRow): Promise<string> {
  if (cache.has(item.id)) return cache.get(item.id)!;
  try {
    const { exportToSvg } = await import('@excalidraw/excalidraw');
    const svg = await exportToSvg({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      elements: item.elements as any,
      appState: {
        viewBackgroundColor: '#ffffff',
        exportBackground: true,
        exportWithDarkMode: false,
        exportPadding: 8,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      files: null,
    });
    const xml = new XMLSerializer().serializeToString(svg);
    // btoa 不接受 Unicode；先 encodeURIComponent → unescape 兜底兼容性
    const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
    cache.set(item.id, dataUrl);
    return dataUrl;
  } catch {
    return '';
  }
}

export function invalidateThumbnail(id: string): void {
  cache.delete(id);
}
