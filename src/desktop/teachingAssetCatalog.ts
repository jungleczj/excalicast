import type {
  TeachingAssetKind,
  TeachingAssetPreselectionV1,
} from './teachingRecipePlanner';

export type TeachingAssetSourceProvider = 'chatcut' | 'bundled';
export type TeachingAssetLicenseStatus = 'valid' | 'expired' | 'revoked';
export type TeachingAssetCacheStatus = 'verified' | 'missing' | 'stale' | 'corrupt';
export type TeachingAssetContentSlotType = 'title' | 'number' | 'chart-data';

export interface TeachingAssetContentSlot {
  slotId: string;
  type: TeachingAssetContentSlotType;
}

export interface TeachingAssetCatalogEntry {
  assetId: string;
  catalogVersion: string;
  assetVersion: string;
  kind: TeachingAssetKind;
  source: {
    provider: TeachingAssetSourceProvider;
    uri: string;
  };
  license: {
    licenseId: string;
    status: TeachingAssetLicenseStatus;
  };
  checksum: {
    algorithm: 'sha256';
    value: string;
  };
  cache: {
    status: TeachingAssetCacheStatus;
    checksum?: string;
  };
  durationMs: number;
  contentSlots: TeachingAssetContentSlot[];
}

export interface TeachingAssetCatalogV1 {
  schemaVersion: 1;
  catalogVersion: string;
  entries: TeachingAssetCatalogEntry[];
}

export interface TeachingCatalogSelectionV1 extends TeachingAssetPreselectionV1 {
  catalogVersion: string;
  assets: TeachingAssetCatalogEntry[];
}

export interface TeachingChartData {
  labels: string[];
  series: Array<{
    name: string;
    values: number[];
  }>;
}

export type TeachingAssetContentValue = string | number | TeachingChartData;

export interface MaterializedTeachingAssetContentV1 {
  schemaVersion: 1;
  assetId: string;
  catalogVersion: string;
  assetVersion: string;
  originalAssetVersion: string;
  sourceChecksum: string;
  content: Array<{
    slotId: string;
    type: TeachingAssetContentSlotType;
    value: TeachingAssetContentValue;
  }>;
}

const ASSET_KINDS: readonly TeachingAssetKind[] = ['motion-graphic', 'chart', 'sound-effect'];
const SOURCE_PROVIDERS: readonly TeachingAssetSourceProvider[] = ['chatcut', 'bundled'];
const LICENSE_STATUSES: readonly TeachingAssetLicenseStatus[] = ['valid', 'expired', 'revoked'];
const CACHE_STATUSES: readonly TeachingAssetCacheStatus[] = ['verified', 'missing', 'stale', 'corrupt'];
const SLOT_TYPES: readonly TeachingAssetContentSlotType[] = ['title', 'number', 'chart-data'];
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function validContentSlots(slots: TeachingAssetContentSlot[]): boolean {
  if (!Array.isArray(slots)) return false;
  const ids = new Set<string>();
  return slots.every((slot) => {
    if (
      !slot
      || typeof slot.slotId !== 'string'
      || slot.slotId.length === 0
      || !SLOT_TYPES.includes(slot.type)
      || ids.has(slot.slotId)
    ) return false;
    ids.add(slot.slotId);
    return true;
  });
}

function validCatalogEntry(entry: TeachingAssetCatalogEntry, catalogVersion: string): boolean {
  return Boolean(entry)
    && typeof entry.assetId === 'string'
    && entry.assetId.length > 0
    && entry.catalogVersion === catalogVersion
    && typeof entry.assetVersion === 'string'
    && entry.assetVersion.length > 0
    && ASSET_KINDS.includes(entry.kind)
    && Boolean(entry.source)
    && SOURCE_PROVIDERS.includes(entry.source?.provider)
    && typeof entry.source?.uri === 'string'
    && entry.source.uri.length > 0
    && Boolean(entry.license)
    && typeof entry.license?.licenseId === 'string'
    && entry.license.licenseId.length > 0
    && LICENSE_STATUSES.includes(entry.license?.status)
    && entry.checksum?.algorithm === 'sha256'
    && SHA256_PATTERN.test(entry.checksum?.value ?? '')
    && Boolean(entry.cache)
    && CACHE_STATUSES.includes(entry.cache?.status)
    && (entry.cache.checksum === undefined || SHA256_PATTERN.test(entry.cache.checksum))
    && Number.isFinite(entry.durationMs)
    && entry.durationMs > 0
    && validContentSlots(entry.contentSlots);
}

function cloneEntry(entry: TeachingAssetCatalogEntry): TeachingAssetCatalogEntry {
  return {
    ...entry,
    source: { ...entry.source },
    license: { ...entry.license },
    checksum: { ...entry.checksum },
    cache: { ...entry.cache },
    contentSlots: entry.contentSlots.map((slot) => ({ ...slot })),
  };
}

/** Builds a local, immutable-by-convention snapshot of the visible teaching catalog. */
export function createTeachingAssetCatalog(params: {
  catalogVersion: string;
  entries: TeachingAssetCatalogEntry[];
}): TeachingAssetCatalogV1 {
  if (!params.catalogVersion || !Array.isArray(params.entries)) {
    throw new Error('teaching_asset_catalog_invalid');
  }

  const ids = new Set<string>();
  const entries = params.entries.map((entry) => {
    if (!validCatalogEntry(entry, params.catalogVersion) || ids.has(entry.assetId)) {
      throw new Error('teaching_asset_catalog_entry_invalid');
    }
    ids.add(entry.assetId);
    return cloneEntry(entry);
  });

  return {
    schemaVersion: 1,
    catalogVersion: params.catalogVersion,
    entries,
  };
}

function hasUsableOfflineCache(entry: TeachingAssetCatalogEntry): boolean {
  return entry.cache.status === 'verified'
    && typeof entry.cache.checksum === 'string'
    && entry.cache.checksum.toLowerCase() === entry.checksum.value.toLowerCase();
}

/** Resolves only IDs explicitly selected in the pre-record UI; it never fills missing categories. */
export function selectTeachingCatalogAssets(params: {
  teachingPackId: string;
  catalog: TeachingAssetCatalogV1;
  selectedAssetIds: string[];
  offline: boolean;
}): TeachingCatalogSelectionV1 {
  if (!params.teachingPackId || !Array.isArray(params.selectedAssetIds)) {
    throw new Error('teaching_asset_selection_invalid');
  }
  const byId = new Map(params.catalog.entries.map((entry) => [entry.assetId, entry]));
  const selected = new Set<string>();
  const assets = params.selectedAssetIds.map((assetId) => {
    if (selected.has(assetId)) throw new Error('teaching_asset_selection_invalid');
    selected.add(assetId);
    const asset = byId.get(assetId);
    if (!asset) throw new Error('teaching_asset_not_in_catalog');
    if (asset.license.status !== 'valid') throw new Error('teaching_asset_license_invalid');
    if (params.offline && !hasUsableOfflineCache(asset)) {
      throw new Error('teaching_asset_offline_cache_unverified');
    }
    return cloneEntry(asset);
  });

  return {
    schemaVersion: 1,
    teachingPackId: params.teachingPackId,
    catalogVersion: params.catalog.catalogVersion,
    assets,
  };
}

function isChartData(value: unknown): value is TeachingChartData {
  if (!value || typeof value !== 'object') return false;
  const chart = value as TeachingChartData;
  if (!Array.isArray(chart.labels) || !chart.labels.every((label) => typeof label === 'string')) return false;
  return Array.isArray(chart.series) && chart.series.every((series) => (
    typeof series?.name === 'string'
    && series.name.length > 0
    && Array.isArray(series.values)
    && series.values.length === chart.labels.length
    && series.values.every((number) => Number.isFinite(number))
  ));
}

function contentValueForSlot(type: TeachingAssetContentSlotType, value: unknown): TeachingAssetContentValue | null {
  if (type === 'title') return typeof value === 'string' && value.length > 0 ? value : null;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (!isChartData(value)) return null;
  return {
    labels: [...value.labels],
    series: value.series.map((series) => ({ name: series.name, values: [...series.values] })),
  };
}

/** Applies post-record values to declared slots without rewriting the source asset identity. */
export function materializeTeachingAssetContent(params: {
  selection: TeachingCatalogSelectionV1;
  assetId: string;
  replacements: Record<string, unknown>;
}): MaterializedTeachingAssetContentV1 {
  const asset = params.selection.assets.find((candidate) => candidate.assetId === params.assetId);
  if (!asset) throw new Error('teaching_asset_not_selected');

  const declaredSlots = new Map(asset.contentSlots.map((slot) => [slot.slotId, slot]));
  for (const slotId of Object.keys(params.replacements)) {
    if (!declaredSlots.has(slotId)) throw new Error('teaching_asset_content_slot_invalid');
  }

  const content = asset.contentSlots.flatMap((slot) => {
    if (!Object.prototype.hasOwnProperty.call(params.replacements, slot.slotId)) return [];
    const value = contentValueForSlot(slot.type, params.replacements[slot.slotId]);
    if (value === null) throw new Error('teaching_asset_content_value_invalid');
    return [{ slotId: slot.slotId, type: slot.type, value }];
  });

  return {
    schemaVersion: 1,
    assetId: asset.assetId,
    catalogVersion: asset.catalogVersion,
    assetVersion: asset.assetVersion,
    originalAssetVersion: asset.assetVersion,
    sourceChecksum: asset.checksum.value,
    content,
  };
}
