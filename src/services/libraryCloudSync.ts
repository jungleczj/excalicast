'use client';

import {
  getAllLibraryItems,
  replaceLibraryItems,
  type LibraryItemRow,
} from '@/lib/db-client';
import { mergeById, notifyLibraryUpdated } from '@/utils/libraryImport';

// 模板库云同步（pro/max）。所有函数对"未登录 / 非 pro"都安全降级：
// API 返回空或 403，这里静默吞掉，不影响本地使用。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(r: any): LibraryItemRow {
  return {
    id: String(r.id),
    status: r.status === 'published' ? 'published' : 'unpublished',
    elements: Array.isArray(r.elements) ? r.elements : [],
    created: typeof r.created === 'number' ? r.created : Date.now(),
    name: typeof r.name === 'string' ? r.name : undefined,
  };
}

/**
 * 登录(pro/max)后调用：拉云端模板 → 与本地并集 → 写回本地并通知抽屉刷新 →
 * 把"本地有云端没有"的项补传上云（覆盖登出期间本地新增）。
 * 返回是否真的同步了（false = 未登录/非 pro/请求失败，本地保持原样）。
 */
export async function pullAndMergeLibrary(): Promise<boolean> {
  let cloudItems: LibraryItemRow[];
  try {
    const res = await fetch('/api/library', { cache: 'no-store' });
    if (!res.ok) return false;
    const json = (await res.json()) as { items?: unknown[] };
    cloudItems = Array.isArray(json.items) ? json.items.map(toRow) : [];
  } catch {
    return false;
  }

  const local = await getAllLibraryItems().catch(() => [] as LibraryItemRow[]);
  const merged = mergeById(local, cloudItems);
  await replaceLibraryItems(merged);
  notifyLibraryUpdated();

  // 本地独有的（云端没有）→ 补传上云
  const cloudIds = new Set(cloudItems.map((it) => it.id));
  const localOnly = merged.filter((it) => !cloudIds.has(it.id));
  if (localOnly.length > 0) {
    void pushLibraryItems(localOnly);
  }
  return true;
}

/** 上行新增/变更的模板（fire-and-forget；非 pro 时 API 403，静默）。 */
export async function pushLibraryItems(items: LibraryItemRow[]): Promise<void> {
  if (items.length === 0) return;
  try {
    await fetch('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  } catch { /* 网络/未登录/非 pro：静默 */ }
}

/** 删除云端某模板（fire-and-forget）。 */
export async function removeLibraryItemCloud(id: string): Promise<void> {
  try {
    await fetch(`/api/library?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch { /* 静默 */ }
}
