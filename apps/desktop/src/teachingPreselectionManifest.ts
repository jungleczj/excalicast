import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createTeachingAssetCatalog,
  selectTeachingCatalogAssets,
  type TeachingAssetCatalogV1,
  type TeachingCatalogSelectionV1,
} from '../../../src/desktop/teachingAssetCatalog';
import type { RecordingTeachingRecipeSelectionV1 } from '../../../src/types/recording';
import { verifyTeachingCatalogAssetForPreselection } from './teachingCompositionManifest';

const MAX_BYTES = 1_048_576;
const MAX_SELECTED_ASSETS = 32;
const MAX_SELECTED_CACHE_BYTES = 128 * 1024 * 1024;
const RELATIVE_PATH = 'teaching/preselection.json';

export type TeachingPreselectionManifestV1 =
  | {
    schemaVersion: 1;
    state: 'ready';
    recordingId: string;
    catalog: TeachingAssetCatalogV1;
    selection: TeachingCatalogSelectionV1;
  }
  | {
    schemaVersion: 1;
    state: 'unsupported';
    recordingId: string;
    code: string;
  };

function fail(code: string): never { throw new Error(code); }
function recordingId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) fail('teaching_preselection_invalid');
  return value;
}
function destination(projectRoot: string): string {
  if (!path.isAbsolute(projectRoot)) fail('teaching_preselection_invalid');
  return path.join(path.resolve(projectRoot), RELATIVE_PATH);
}

async function safeDirectory(projectRoot: string): Promise<string> {
  const root = path.resolve(projectRoot);
  const directory = path.join(root, 'teaching');
  await mkdir(root, { recursive: true });
  const rootInfo = await lstat(root).catch(() => fail('teaching_preselection_directory_unverified'));
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('teaching_preselection_directory_unverified');
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory).catch(() => fail('teaching_preselection_directory_unverified'));
  if (!info.isDirectory() || info.isSymbolicLink()) fail('teaching_preselection_directory_unverified');
  return directory;
}

async function readBoundedRegularFile(candidate: string, code: string): Promise<string> {
  let handle;
  try { handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    fail(code);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > MAX_BYTES) fail(code);
    const bytes = Buffer.allocUnsafe(info.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead < 1) fail(code);
      offset += bytesRead;
    }
    const finalInfo = await handle.stat();
    if (finalInfo.ino !== info.ino || finalInfo.size !== info.size) fail(code);
    return bytes.toString('utf8');
  } finally { await handle.close(); }
}

async function assertAuthorityCatalogPath(catalogPath: string, cacheRoot: string): Promise<void> {
  const rootInfo = await lstat(cacheRoot).catch(() => fail('teaching_preselection_catalog_path_unverified'));
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('teaching_preselection_catalog_path_unverified');
  const trustedRoot = await realpath(cacheRoot).catch(() => fail('teaching_preselection_catalog_path_unverified'));
  const catalogParent = await realpath(path.dirname(catalogPath)).catch(() => fail('teaching_preselection_catalog_path_unverified'));
  if (catalogParent !== trustedRoot || path.basename(catalogPath) !== 'catalog.json') {
    fail('teaching_preselection_catalog_path_unverified');
  }
  const catalogInfo = await lstat(catalogPath).catch(() => fail('teaching_preselection_catalog_unavailable'));
  if (!catalogInfo.isFile() || catalogInfo.isSymbolicLink()) fail('teaching_preselection_catalog_path_unverified');
}

async function write(projectRoot: string, value: TeachingPreselectionManifestV1): Promise<TeachingPreselectionManifestV1> {
  const target = destination(projectRoot);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) fail('teaching_preselection_budget_exceeded');
  const directory = await safeDirectory(projectRoot);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const temporaryHandle = await open(temporary, constants.O_RDONLY);
    try { await temporaryHandle.sync(); } finally { await temporaryHandle.close(); }
    await rename(temporary, target);
    const directoryHandle = await open(directory, constants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return value;
}

/** Main-only: freezes a verified catalog selection before any media capture begins. */
export async function persistDesktopTeachingPreselection(input: {
  projectRoot: string;
  catalogPath: string;
  cacheRoot: string;
  recordingId: string;
  recipe?: RecordingTeachingRecipeSelectionV1;
  /** True only when the renderer attempted a malformed teaching request. */
  recipeInvalid?: boolean;
}): Promise<TeachingPreselectionManifestV1 | undefined> {
  const id = recordingId(input.recordingId);
  if (!input.recipe?.enabled) {
    return input.recipeInvalid
      ? write(input.projectRoot, { schemaVersion: 1, state: 'unsupported', recordingId: id, code: 'teaching_preselection_recipe_invalid' })
      : undefined;
  }
  try {
    if (!path.isAbsolute(input.cacheRoot)) fail('teaching_preselection_catalog_path_unverified');
    await assertAuthorityCatalogPath(input.catalogPath, input.cacheRoot);
    const raw = await readBoundedRegularFile(input.catalogPath, 'teaching_preselection_catalog_unavailable');
    const candidate = JSON.parse(raw) as TeachingAssetCatalogV1;
    const catalog = createTeachingAssetCatalog({
      catalogVersion: candidate.catalogVersion,
      entries: candidate.entries,
    });
    const selection = selectTeachingCatalogAssets({
      teachingPackId: input.recipe.teachingPackId,
      catalog,
      selectedAssetIds: input.recipe.selectedAssetIds,
      offline: true,
    });
    if (selection.assets.length > MAX_SELECTED_ASSETS) fail('teaching_preselection_asset_limit');
    let selectedCacheBytes = 0;
    for (const asset of selection.assets) {
      selectedCacheBytes += await verifyTeachingCatalogAssetForPreselection({ entry: asset, cacheRoot: input.cacheRoot });
      if (selectedCacheBytes > MAX_SELECTED_CACHE_BYTES) fail('teaching_preselection_cache_budget_exceeded');
    }
    return write(input.projectRoot, { schemaVersion: 1, state: 'ready', recordingId: id, catalog, selection });
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith('teaching_')
      ? error.message
      : 'teaching_preselection_catalog_unavailable';
    return write(input.projectRoot, { schemaVersion: 1, state: 'unsupported', recordingId: id, code });
  }
}

export async function readDesktopTeachingPreselection(input: {
  projectRoot: string;
  recordingId: string;
}): Promise<TeachingPreselectionManifestV1 | undefined> {
  const id = recordingId(input.recordingId);
  let raw: string;
  try { raw = await readBoundedRegularFile(destination(input.projectRoot), 'teaching_preselection_invalid'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let value: TeachingPreselectionManifestV1;
  try { value = JSON.parse(raw) as TeachingPreselectionManifestV1; }
  catch { fail('teaching_preselection_invalid'); }
  if (!value || value.schemaVersion !== 1 || value.recordingId !== id
    || (value.state !== 'ready' && value.state !== 'unsupported')) fail('teaching_preselection_invalid');
  return value;
}
