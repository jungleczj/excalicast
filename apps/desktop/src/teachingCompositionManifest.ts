import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, writeFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import {
  createTeachingAssetCatalog,
  type TeachingAssetCatalogEntry,
  type TeachingAssetCatalogV1,
  type TeachingCatalogSelectionV1,
} from '../../../src/desktop/teachingAssetCatalog';
import type {
  TeachingCompositionOperation,
  TeachingCompositionPlanV1,
} from '../../../src/desktop/teachingCompositionExecutor';

export const TEACHING_COMPOSITION_MANIFEST_RELATIVE_PATH = 'teaching/composition.json' as const;
export const TEACHING_COMPOSITION_MANIFEST_MAX_BYTES = 1_048_576;
export const TEACHING_COMPOSITION_ASSET_MAX_BYTES = 64 * 1024 * 1024;

export interface TeachingCompositionManifestV1 {
  readonly schemaVersion: 1;
  readonly manifestVersion: 'teaching-composition-manifest-v1';
  readonly state: 'ready';
  readonly recordingId: string;
  readonly planChecksum: string;
  readonly byteLength: number;
  readonly catalog: TeachingAssetCatalogV1;
  readonly selection: TeachingCatalogSelectionV1;
  readonly plan: TeachingCompositionPlanV1;
}

export interface ResolvedTeachingCompositionAsset {
  readonly path: string;
  readonly byteLength: number;
  readonly mimeType: 'audio/wav' | 'audio/mpeg' | 'audio/ogg' | 'audio/webm';
  /** Held open by main process so a later pathname swap cannot alter a checked asset. */
  readonly fileHandle?: FileHandle;
}

const RECORDING_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const CHECKSUM = /^[a-f0-9]{64}$/;
const MIME_BY_EXTENSION: Readonly<Record<string, ResolvedTeachingCompositionAsset['mimeType']>> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
};

function fail(code: string): never { throw new Error(code); }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) fail('teaching_composition_manifest_value_invalid');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assetUriToPath(localUri: string): string {
  let parsed: URL;
  try { parsed = new URL(localUri); } catch { return fail('teaching_asset_cache_path_unverified'); }
  if (parsed.protocol !== 'file:' || parsed.hostname !== '') fail('teaching_asset_cache_path_unverified');
  try { return path.resolve(decodeURIComponent(parsed.pathname)); } catch { return fail('teaching_asset_cache_path_unverified'); }
}

function assertWithinCacheRoot(candidate: string, cacheRoot: string): void {
  const relative = path.relative(cacheRoot, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    fail('teaching_asset_cache_path_unverified');
  }
}

async function verifyCachedAsset(
  entry: TeachingAssetCatalogEntry,
  cacheRoot: string,
  keepFileHandle = false,
  signal?: AbortSignal,
): Promise<{ path: string; byteLength: number; fileHandle?: FileHandle }> {
  if (signal?.aborted) fail('teaching_composition_cancelled');
  if (entry.cache.status !== 'verified'
    || entry.cache.checksum?.toLowerCase() !== entry.checksum.value.toLowerCase()
    || !entry.cache.localUri
    || !CHECKSUM.test(entry.checksum.value)) fail('teaching_asset_cache_unverified');
  const cacheRootInfo = await lstat(cacheRoot).catch(() => fail('teaching_asset_cache_root_invalid'));
  if (!cacheRootInfo.isDirectory() || cacheRootInfo.isSymbolicLink()) fail('teaching_asset_cache_root_invalid');
  const trustedCacheRoot = await realpath(cacheRoot).catch(() => fail('teaching_asset_cache_root_invalid'));
  const declaredCachePath = assetUriToPath(entry.cache.localUri);
  const declaredInfo = await lstat(declaredCachePath).catch(() => fail('teaching_asset_cache_path_unverified'));
  if (!declaredInfo.isFile() || declaredInfo.isSymbolicLink()) fail('teaching_asset_cache_path_unverified');
  const cachePath = await realpath(declaredCachePath).catch(() => fail('teaching_asset_cache_path_unverified'));
  assertWithinCacheRoot(cachePath, trustedCacheRoot);
  const relative = path.relative(trustedCacheRoot, cachePath);
  let current = trustedCacheRoot;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    const info = await lstat(current).catch(() => fail('teaching_asset_cache_path_unverified'));
    if (info.isSymbolicLink()) fail('teaching_asset_cache_path_unverified');
  }
  let fileHandle: FileHandle;
  try {
    fileHandle = await open(cachePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch { return fail('teaching_asset_cache_path_unverified'); }
  let verified = false;
  try {
    const details = await fileHandle.stat();
    if (!details.isFile() || details.size < 1 || details.size > TEACHING_COMPOSITION_ASSET_MAX_BYTES) {
      fail('teaching_asset_cache_path_unverified');
    }
    const hasher = createHash('sha256');
    const buffer = Buffer.allocUnsafe(Math.min(1_048_576, details.size));
    let offset = 0;
    while (offset < details.size) {
      if (signal?.aborted) fail('teaching_composition_cancelled');
      const { bytesRead } = await fileHandle.read(buffer, 0, Math.min(buffer.byteLength, details.size - offset), offset);
      if (bytesRead < 1) fail('teaching_asset_checksum_unverified');
      hasher.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const finalDetails = await fileHandle.stat();
    if (finalDetails.size !== details.size || finalDetails.ino !== details.ino
      || hasher.digest('hex') !== entry.checksum.value.toLowerCase()) {
      fail('teaching_asset_checksum_unverified');
    }
    verified = true;
    return keepFileHandle
      ? { path: cachePath, byteLength: details.size, fileHandle }
      : { path: cachePath, byteLength: details.size };
  } finally {
    // Keep the descriptor only after every identity and checksum assertion has
    // succeeded; failures never leave a cache handle behind.
    if (!keepFileHandle || !verified) await fileHandle.close();
  }
}

/**
 * Main-process-only admission check for a catalog item before capture begins.
 * It deliberately verifies the bytes from the same no-follow descriptor rather
 * than trusting catalog.cache.status. The returned value is never exposed to a
 * renderer and the descriptor is closed before recording starts.
 */
export async function verifyTeachingCatalogAssetForPreselection(input: {
  entry: TeachingAssetCatalogEntry;
  cacheRoot: string;
}): Promise<number> {
  if (!path.isAbsolute(input.cacheRoot)) fail('teaching_asset_cache_root_invalid');
  if (input.entry.license.status !== 'valid') fail('teaching_asset_license_invalid');
  const verified = await verifyCachedAsset(input.entry, path.resolve(input.cacheRoot));
  return verified.byteLength;
}

function sameCatalogAsset(left: TeachingAssetCatalogEntry, right: TeachingAssetCatalogEntry): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function validatePlanSnapshot(params: {
  recordingId: string;
  catalog: TeachingAssetCatalogV1;
  selection: TeachingCatalogSelectionV1;
  plan: TeachingCompositionPlanV1;
}): TeachingAssetCatalogEntry[] {
  const catalog = createTeachingAssetCatalog({
    catalogVersion: params.catalog.catalogVersion,
    entries: params.catalog.entries,
  });
  const { selection, plan, recordingId } = params;
  if (!RECORDING_ID.test(recordingId)
    || selection.schemaVersion !== 1
    || plan.schemaVersion !== 1
    || selection.catalogVersion !== catalog.catalogVersion
    || plan.catalogVersion !== catalog.catalogVersion
    || plan.sourceRecordingId !== recordingId
    || !selection.teachingPackId
    || plan.teachingPackId !== selection.teachingPackId
    || !Number.isFinite(plan.durationMs) || plan.durationMs <= 0
    || !Array.isArray(plan.selectedAssetIds) || !Array.isArray(plan.operations)) {
    fail('teaching_composition_manifest_invalid');
  }
  const byId = new Map(catalog.entries.map((entry) => [entry.assetId, entry]));
  const selectedIds = new Set<string>();
  const selected: TeachingAssetCatalogEntry[] = [];
  if (selection.assets.length !== plan.selectedAssetIds.length) fail('teaching_composition_manifest_selection_invalid');
  for (let index = 0; index < plan.selectedAssetIds.length; index += 1) {
    const assetId = plan.selectedAssetIds[index];
    const catalogEntry = byId.get(assetId);
    const selectionEntry = selection.assets[index];
    if (!catalogEntry || selectedIds.has(assetId) || !selectionEntry || !sameCatalogAsset(catalogEntry, selectionEntry)) {
      fail('teaching_composition_manifest_selection_invalid');
    }
    selectedIds.add(assetId);
    selected.push(catalogEntry);
  }
  const operationIds = new Set<string>();
  for (const operation of plan.operations) {
    if (!operation || operationIds.has(operation.operationId) || !selectedIds.has(operation.asset.assetId)) {
      fail('teaching_composition_manifest_operation_invalid');
    }
    operationIds.add(operation.operationId);
    const asset = byId.get(operation.asset.assetId);
    if (!asset
      || asset.kind !== operation.asset.kind
      || asset.catalogVersion !== operation.asset.catalogVersion
      || asset.assetVersion !== operation.asset.assetVersion
      || asset.checksum.value.toLowerCase() !== operation.asset.checksum.toLowerCase()
      || asset.cache.localUri !== operation.asset.localUri
      || operation.endMs <= operation.startMs
      || operation.startMs < 0
      || operation.endMs > plan.durationMs) fail('teaching_composition_manifest_operation_invalid');
  }
  return selected;
}

function projectManifestPath(projectRoot: string): string {
  if (!path.isAbsolute(projectRoot)) fail('teaching_composition_project_root_invalid');
  return path.join(path.resolve(projectRoot), TEACHING_COMPOSITION_MANIFEST_RELATIVE_PATH);
}

async function readOwnedManifestFile(candidate: string): Promise<Buffer> {
  let handle: FileHandle;
  try { handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { fail('teaching_composition_manifest_missing'); }
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size < 1 || details.size > TEACHING_COMPOSITION_MANIFEST_MAX_BYTES) {
      fail('teaching_composition_manifest_budget_exceeded');
    }
    const bytes = Buffer.allocUnsafe(details.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead < 1) fail('teaching_composition_manifest_invalid');
      offset += bytesRead;
    }
    const finalDetails = await handle.stat();
    if (finalDetails.ino !== details.ino || finalDetails.size !== details.size) {
      fail('teaching_composition_manifest_invalid');
    }
    return bytes;
  } finally { await handle.close(); }
}

async function ensureManifestDirectory(projectRoot: string): Promise<string> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const directory = path.join(resolvedProjectRoot, 'teaching');
  try {
    await mkdir(resolvedProjectRoot, { recursive: true });
    const rootInfo = await lstat(resolvedProjectRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('teaching_composition_manifest_directory_unverified');
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('teaching_composition_manifest_directory_unverified');
    return directory;
  } catch (error) {
    if (error instanceof Error && error.message === 'teaching_composition_manifest_directory_unverified') throw error;
    return fail('teaching_composition_manifest_directory_unverified');
  }
}

function toPersistedSnapshot(input: {
  recordingId: string;
  catalog: TeachingAssetCatalogV1;
  selection: TeachingCatalogSelectionV1;
  plan: TeachingCompositionPlanV1;
}): TeachingCompositionManifestV1 {
  const snapshot = {
    schemaVersion: 1 as const,
    manifestVersion: 'teaching-composition-manifest-v1' as const,
    state: 'ready' as const,
    recordingId: input.recordingId,
    catalog: clone(input.catalog),
    selection: clone(input.selection),
    plan: clone(input.plan),
  };
  const planChecksum = sha256(canonicalJson({ catalog: snapshot.catalog, selection: snapshot.selection, plan: snapshot.plan }));
  const body = canonicalJson({ ...snapshot, planChecksum });
  const byteLength = Buffer.byteLength(body, 'utf8');
  if (byteLength > TEACHING_COMPOSITION_MANIFEST_MAX_BYTES) fail('teaching_composition_manifest_budget_exceeded');
  return { ...snapshot, planChecksum, byteLength };
}

function parsePersistedManifest(value: unknown, recordingId: string): TeachingCompositionManifestV1 {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.manifestVersion !== 'teaching-composition-manifest-v1'
    || value.state !== 'ready'
    || value.recordingId !== recordingId
    || typeof value.planChecksum !== 'string' || !CHECKSUM.test(value.planChecksum)
    || typeof value.byteLength !== 'number' || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
    || !isRecord(value.catalog) || !isRecord(value.selection) || !isRecord(value.plan)) {
    fail('teaching_composition_manifest_invalid');
  }
  const snapshot = value as unknown as TeachingCompositionManifestV1;
  validatePlanSnapshot({ recordingId, catalog: snapshot.catalog, selection: snapshot.selection, plan: snapshot.plan });
  const expectedChecksum = sha256(canonicalJson({ catalog: snapshot.catalog, selection: snapshot.selection, plan: snapshot.plan }));
  if (expectedChecksum !== snapshot.planChecksum) fail('teaching_composition_manifest_checksum_invalid');
  const expectedBody = canonicalJson({
    schemaVersion: snapshot.schemaVersion,
    manifestVersion: snapshot.manifestVersion,
    state: snapshot.state,
    recordingId: snapshot.recordingId,
    catalog: snapshot.catalog,
    selection: snapshot.selection,
    plan: snapshot.plan,
    planChecksum: snapshot.planChecksum,
  });
  if (Buffer.byteLength(expectedBody, 'utf8') !== snapshot.byteLength
    || snapshot.byteLength > TEACHING_COMPOSITION_MANIFEST_MAX_BYTES) {
    fail('teaching_composition_manifest_budget_exceeded');
  }
  return clone(snapshot);
}

/** Main-process only: persists a compiler-produced plan next to its recording atomically. */
export async function writeReadyTeachingCompositionManifest(input: {
  projectRoot: string;
  cacheRoot: string;
  recordingId: string;
  catalog: TeachingAssetCatalogV1;
  selection: TeachingCatalogSelectionV1;
  plan: TeachingCompositionPlanV1;
  signal?: AbortSignal;
}): Promise<TeachingCompositionManifestV1> {
  if (input.signal?.aborted) fail('teaching_composition_cancelled');
  if (!path.isAbsolute(input.cacheRoot)) fail('teaching_asset_cache_root_invalid');
  const cacheRoot = path.resolve(input.cacheRoot);
  const selected = validatePlanSnapshot(input);
  for (const entry of selected) await verifyCachedAsset(entry, cacheRoot, false, input.signal);
  const manifest = toPersistedSnapshot(input);
  const destination = projectManifestPath(input.projectRoot);
  const manifestDirectory = await ensureManifestDirectory(input.projectRoot);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const body = canonicalJson(manifest);
  try {
    if (input.signal?.aborted) fail('teaching_composition_cancelled');
    await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const descriptor = await open(temporary, 'r');
    try { await descriptor.sync(); } finally { await descriptor.close(); }
    if (input.signal?.aborted) fail('teaching_composition_cancelled');
    await rename(temporary, destination);
    const directoryHandle = await open(manifestDirectory, constants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch (error) {
    try { await (await import('node:fs/promises')).unlink(temporary); } catch { /* no partial manifest is visible */ }
    throw error;
  }
  return manifest;
}

/** Main-process only: validates a bounded, ready snapshot before it is exposed to an export request. */
export async function readReadyTeachingCompositionManifest(input: {
  projectRoot: string;
  recordingId: string;
}): Promise<TeachingCompositionManifestV1> {
  if (!RECORDING_ID.test(input.recordingId)) fail('teaching_composition_manifest_invalid');
  const manifestPath = projectManifestPath(input.projectRoot);
  const bytes = await readOwnedManifestFile(manifestPath);
  try { return parsePersistedManifest(JSON.parse(bytes.toString('utf8')), input.recordingId); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('teaching_')) throw error;
    return fail('teaching_composition_manifest_invalid');
  }
}

/** Resolves only an identity that was selected, planned and checksummed in the owned manifest. */
export async function resolveTeachingAssetFromManifest(input: {
  projectRoot: string;
  cacheRoot: string;
  recordingId: string;
  assetId: string;
  assetVersion: string;
  checksum: string;
}): Promise<ResolvedTeachingCompositionAsset> {
  if (!path.isAbsolute(input.cacheRoot) || !CHECKSUM.test(input.checksum)) fail('teaching_asset_identity_unverified');
  const manifest = await readReadyTeachingCompositionManifest(input);
  const operation = manifest.plan.operations.find((candidate) => (
    candidate.operation === 'mix-sound-effect'
    && candidate.asset.assetId === input.assetId
    && candidate.asset.assetVersion === input.assetVersion
    && candidate.asset.checksum.toLowerCase() === input.checksum.toLowerCase()
  ));
  const entry = manifest.selection.assets.find((candidate) => (
    candidate.assetId === input.assetId
    && candidate.assetVersion === input.assetVersion
    && candidate.checksum.value.toLowerCase() === input.checksum.toLowerCase()
    && candidate.kind === 'sound-effect'
  ));
  if (!operation || !entry) fail('teaching_asset_identity_unverified');
  const verified = await verifyCachedAsset(entry, path.resolve(input.cacheRoot), true);
  const mimeType = MIME_BY_EXTENSION[path.extname(verified.path).toLowerCase()];
  if (!mimeType) fail('teaching_asset_mime_unsupported');
  return { ...verified, mimeType };
}
