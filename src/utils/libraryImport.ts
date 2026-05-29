import {
  getAllLibraryItems,
  replaceLibraryItems,
  type LibraryItemRow,
} from '@/lib/db-client';

export const BROADCAST_CHANNEL = 'excalicast-library';
export const SAME_TAB_EVENT = 'excalicast-library-updated';
export const MARKET_BASE = 'https://libraries.excalidraw.com/libraries/';
export const MARKET_INDEX = 'https://libraries.excalidraw.com/libraries.json';

// ---------------------------------------------------------------------------
// 本地坠牌：已删除模板 id 的本地镜像（localStorage）。
// 云端用软删除行作权威坠牌让删除跨设备传播；本地这份用于：拉取时剔除、
// localOnly 不重新上推、防止竞态把刚删的项又写回。
// ---------------------------------------------------------------------------
const TOMBSTONE_KEY = 'excalicast-library-tombstones';

export function getTombstones(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeTombstones(set: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(Array.from(set)));
  } catch { /* ignore quota/SSR */ }
}

export function addTombstones(ids: string[]): void {
  if (ids.length === 0) return;
  const set = getTombstones();
  for (const id of ids) set.add(id);
  writeTombstones(set);
}

export function removeTombstones(ids: string[]): void {
  if (ids.length === 0) return;
  const set = getTombstones();
  let changed = false;
  for (const id of ids) changed = set.delete(id) || changed;
  if (changed) writeTombstones(set);
}

// 通知所有 LibraryDrawer（同 tab window 事件 + 跨 tab BroadcastChannel）刷新自己。
export function notifyLibraryUpdated(): void {
  try {
    new BroadcastChannel(BROADCAST_CHANNEL).postMessage({ type: 'updated' });
  } catch { /* 浏览器不支持 BroadcastChannel */ }
  try {
    window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT));
  } catch { /* ignore */ }
}

// v2 LibraryItem 转 IDB row。
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

// v1 .excalidrawlib 没有 item id，用元素 id 派生稳定 id，重复导入可去重。
function stableIdFromElements(elements: unknown[]): string {
  const key = elements
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e) => String((e as any)?.id ?? ''))
    .join('|');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return `v1_${(h >>> 0).toString(36)}`;
}

// 按 id 去重，新条目覆盖同 id 旧条目。
export function mergeById(current: LibraryItemRow[], incoming: LibraryItemRow[]): LibraryItemRow[] {
  const map = new Map<string, LibraryItemRow>();
  for (const it of current) map.set(it.id, it);
  for (const it of incoming) map.set(it.id, it);
  return Array.from(map.values());
}

/**
 * 把 .excalidrawlib（v1 或 v2）解析成 LibraryItemRow[]。
 *  - v2: { libraryItems: LibraryItem[] }（每项含 id/status/elements/created）
 *  - v1: { library: ExcalidrawElement[][] }（每项是一组元素数组，无 id）
 * market 上大量库是 v1 —— 只读 libraryItems 的旧代码对 v1 全部落空。
 */
export function parseExcalidrawLib(lib: unknown): LibraryItemRow[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = lib as any;
  if (Array.isArray(obj?.libraryItems)) {
    return obj.libraryItems.map(toRow);
  }
  if (Array.isArray(obj?.library)) {
    return (obj.library as unknown[])
      .map((entry) => (Array.isArray(entry) ? (entry as unknown[]) : null))
      .filter((els): els is unknown[] => els !== null && els.length > 0)
      .map((elements) => ({
        id: stableIdFromElements(elements),
        status: 'unpublished' as const,
        elements,
        created: Date.now(),
      }));
  }
  console.warn('[excalicast] unknown .excalidrawlib shape, keys=', obj && typeof obj === 'object' ? Object.keys(obj) : typeof obj);
  return [];
}

/**
 * 从一个 .excalidrawlib URL 直接导入到本项目 IDB，并通知所有抽屉刷新。
 * 返回导入的新条目数（0 表示空 / 失败）。整个过程在本浏览器。
 * 仅 `opts.pushToCloud` 为真才把内容上行到云端 —— 非 pro 用户的模板数据不离开浏览器。
 */
export async function importLibraryFromUrl(
  libUrl: string,
  opts?: { pushToCloud?: boolean },
): Promise<number> {
  let resp: Response;
  try {
    resp = await fetch(libUrl);
  } catch (err) {
    console.error('[excalicast] library fetch threw', err);
    return 0;
  }
  if (!resp.ok) {
    console.error('[excalicast] library fetch non-OK', resp.status, resp.statusText);
    return 0;
  }
  let lib: unknown;
  try {
    lib = await resp.json();
  } catch (err) {
    console.error('[excalicast] library json parse failed', err);
    return 0;
  }
  const incoming = parseExcalidrawLib(lib);
  if (incoming.length === 0) return 0;
  // 重新导入 ＝ 复活：清掉这些 id 的坠牌，避免下次拉取又把它们移除。
  removeTombstones(incoming.map((it) => it.id));
  const current = await getAllLibraryItems().catch(() => [] as LibraryItemRow[]);
  const before = current.length;
  const merged = mergeById(current, incoming);
  await replaceLibraryItems(merged);
  notifyLibraryUpdated();
  // 上行到云端（仅 pro/max 调用点会传 pushToCloud:true）。动态 import 避免循环依赖。
  if (opts?.pushToCloud) {
    void import('@/services/libraryCloudSync').then((m) => m.pushLibraryItems(incoming)).catch(() => { /* ignore */ });
  }
  return merged.length - before;
}

export interface MarketLibraryEntry {
  id: string;
  name: string;
  description?: string;
  source: string;   // e.g. "youritjang/software-architecture.excalidrawlib"
  preview?: string;  // e.g. "youritjang/software-architecture.png"
  authors?: { name: string; url?: string }[];
}

// 拉取 market 的全量库索引（229+ 条），CORS 已验证为 *。
export async function fetchMarketIndex(): Promise<MarketLibraryEntry[]> {
  const resp = await fetch(MARKET_INDEX);
  if (!resp.ok) throw new Error(`market index ${resp.status}`);
  const data = await resp.json();
  return Array.isArray(data) ? (data as MarketLibraryEntry[]) : [];
}
