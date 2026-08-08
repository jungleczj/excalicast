'use client';

import { getClientDb } from '@/lib/db-client';
import {
  AUTO_EDIT_ANALYZER_VERSION,
  type AutoEditCacheAdapter,
  type AutoEditCacheValue,
} from '@/services/autoEditAnalyzer';

function rowId(key: string, variant: string): string {
  return `${key}::${variant}`;
}

export const indexedDbAutoEditCache: AutoEditCacheAdapter = {
  async get(key, variant) {
    const row = await getClientDb().autoEditCaches.get(rowId(key, variant));
    if (!row || row.analyzerVersion !== AUTO_EDIT_ANALYZER_VERSION) return null;
    return row.value as AutoEditCacheValue;
  },
  async set(key, variant, value) {
    const recordingId = key.split('::', 1)[0];
    const db = getClientDb();
    await db.autoEditCaches.put({
      id: rowId(key, variant),
      recordingId,
      analyzerVersion: AUTO_EDIT_ANALYZER_VERSION,
      variant,
      value,
      updatedAt: Date.now(),
    });

    const stale = await db.autoEditCaches
      .where('recordingId')
      .equals(recordingId)
      .filter((row) => row.analyzerVersion !== AUTO_EDIT_ANALYZER_VERSION)
      .primaryKeys();
    if (stale.length > 0) await db.autoEditCaches.bulkDelete(stale);
  },
};
