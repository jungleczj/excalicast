import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import type {
  DirectorArtifactCheckpoint,
  DirectorArtifactFileName,
  DirectorArtifactIndexV1,
  DirectorArtifactWriter,
} from '../../../src/desktop/teachingDirectorArtifactStore';

const ARTIFACT_FILE_NAMES = [
  'attention.json',
  'camera.json',
  'cleanup.json',
] as const satisfies readonly DirectorArtifactFileName[];
const ARTIFACT_FILE_NAME_SET = new Set<string>(ARTIFACT_FILE_NAMES);
const CHECKPOINT_ID_PATTERN = /^director-[a-f0-9]{64}$/;

export const DIRECTOR_ARTIFACT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export interface DirectorArtifactWriterFaults {
  beforePublishCurrent?: () => void | Promise<void>;
}

export interface NodeDirectorArtifactWriterOptions {
  projectRoot: string;
  sourceRecordingId: string;
  sessionId: string;
  maxTotalBytes?: number;
  faults?: DirectorArtifactWriterFaults;
  signal?: AbortSignal;
}

interface DirectorCurrentPointerV1 {
  schemaVersion: 1;
  pointerVersion: 'teaching-director-current-v1';
  checkpointId: string;
  relativePath: string;
  index: DirectorArtifactIndexV1;
}

function fail(code: string): never {
  throw new Error(code);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isPathInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function pathType(candidate: string): Promise<'missing' | 'directory' | 'file' | 'invalid'> {
  try {
    const value = await lstat(candidate);
    if (value.isSymbolicLink()) return 'invalid';
    if (value.isDirectory()) return 'directory';
    if (value.isFile()) return 'file';
    return 'invalid';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

async function ensureDirectory(candidate: string): Promise<void> {
  const existing = await pathType(candidate);
  if (existing === 'invalid' || existing === 'file') fail('director_artifact_path_invalid');
  if (existing === 'missing') await mkdir(candidate);
  if (await pathType(candidate) !== 'directory') fail('director_artifact_path_invalid');
}

async function writeSyncedFile(candidate: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(candidate, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(candidate: string): Promise<void> {
  const handle = await open(candidate, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && Buffer.from(left).equals(Buffer.from(right));
}

export class NodeDirectorArtifactWriter implements DirectorArtifactWriter {
  private readonly projectRoot: string;
  private readonly sourceRecordingId: string;
  private readonly sessionId: string;
  private readonly maxTotalBytes: number;
  private readonly faults?: DirectorArtifactWriterFaults;
  private readonly signal?: AbortSignal;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: NodeDirectorArtifactWriterOptions) {
    if (!options.projectRoot || !options.sourceRecordingId || !options.sessionId) {
      fail('director_artifact_identity_mismatch');
    }
    if (options.maxTotalBytes !== undefined
      && (!Number.isSafeInteger(options.maxTotalBytes) || options.maxTotalBytes < 0)) {
      fail('director_artifact_total_size_invalid');
    }
    this.projectRoot = path.resolve(options.projectRoot);
    this.sourceRecordingId = options.sourceRecordingId;
    this.sessionId = options.sessionId;
    this.maxTotalBytes = options.maxTotalBytes ?? DIRECTOR_ARTIFACT_MAX_TOTAL_BYTES;
    this.faults = options.faults;
    this.signal = options.signal;
  }

  checkpoint(value: DirectorArtifactCheckpoint): Promise<void> {
    const operation = this.tail.then(() => this.checkpointNow(value));
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private validate(value: DirectorArtifactCheckpoint): void {
    if (!CHECKPOINT_ID_PATTERN.test(value.checkpointId)
      || value.index.checkpointId !== value.checkpointId) {
      fail('director_artifact_checkpoint_id_invalid');
    }
    if (value.index.schemaVersion !== 1
      || value.index.indexVersion !== 'teaching-director-artifact-index-v1'
      || value.index.owner !== 'recording-manifest'
      || value.index.artifactSetVersion !== 'teaching-director-artifacts-v1'
      || value.index.status !== 'ready'
      || value.index.artifacts.some((artifact) => artifact.status !== 'ready')) {
      fail('director_artifact_checkpoint_invalid');
    }
    if (value.index.sourceRecordingId !== this.sourceRecordingId
      || value.index.sessionId !== this.sessionId
      || value.index.artifacts.some((artifact) => (
        artifact.sourceRecordingId !== this.sourceRecordingId
        || artifact.sessionId !== this.sessionId
      ))) {
      fail('director_artifact_identity_mismatch');
    }
    if (value.files.length !== ARTIFACT_FILE_NAMES.length
      || value.index.artifacts.length !== ARTIFACT_FILE_NAMES.length) {
      fail('director_artifact_filename_invalid');
    }

    const files = new Map<DirectorArtifactFileName, Uint8Array>();
    for (const file of value.files) {
      if (!ARTIFACT_FILE_NAME_SET.has(file.fileName) || files.has(file.fileName)) {
        fail('director_artifact_filename_invalid');
      }
      files.set(file.fileName, file.bytes);
    }
    const metadataNames = new Set<string>();
    let totalBytes = 0;
    for (const metadata of value.index.artifacts) {
      if (!ARTIFACT_FILE_NAME_SET.has(metadata.fileName) || metadataNames.has(metadata.fileName)) {
        fail('director_artifact_filename_invalid');
      }
      metadataNames.add(metadata.fileName);
      const bytes = files.get(metadata.fileName);
      if (!bytes) fail('director_artifact_filename_invalid');
      if (metadata.byteLength !== bytes.byteLength) fail('director_artifact_byte_length_invalid');
      if (metadata.checksum.algorithm !== 'sha256'
        || !/^[a-f0-9]{64}$/.test(metadata.checksum.value)
        || metadata.checksum.value !== sha256(bytes)) {
        fail('director_artifact_checksum_invalid');
      }
      totalBytes += bytes.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > this.maxTotalBytes) {
        fail('director_artifact_total_size_exceeded');
      }
    }
  }

  private safeChild(...segments: string[]): string {
    const candidate = path.resolve(this.projectRoot, ...segments);
    if (!isPathInside(this.projectRoot, candidate)) fail('director_artifact_path_invalid');
    return candidate;
  }

  private async prepareDirectories(): Promise<{
    directorRoot: string;
    stagingRoot: string;
    checkpointsRoot: string;
  }> {
    const projectType = await pathType(this.projectRoot);
    if (projectType === 'missing') await mkdir(this.projectRoot, { recursive: true });
    if (await pathType(this.projectRoot) !== 'directory') fail('director_artifact_path_invalid');

    const directorRoot = this.safeChild('director');
    await ensureDirectory(directorRoot);
    const stagingRoot = this.safeChild('director', '.staging');
    await ensureDirectory(stagingRoot);
    const checkpointsRoot = this.safeChild('director', 'checkpoints');
    await ensureDirectory(checkpointsRoot);
    return { directorRoot, stagingRoot, checkpointsRoot };
  }

  private async validateExistingCheckpoint(
    checkpointRoot: string,
    value: DirectorArtifactCheckpoint,
  ): Promise<void> {
    try {
      if (await pathType(checkpointRoot) !== 'directory') throw new Error('invalid');
      for (const file of value.files) {
        const artifactPath = path.join(checkpointRoot, file.fileName);
        if (!isPathInside(checkpointRoot, artifactPath) || await pathType(artifactPath) !== 'file') {
          throw new Error('invalid');
        }
        const existing = await readFile(artifactPath);
        if (!bytesEqual(existing, file.bytes)) throw new Error('invalid');
      }
      const indexPath = path.join(checkpointRoot, 'index.json');
      if (await pathType(indexPath) !== 'file'
        || !bytesEqual(await readFile(indexPath), jsonBytes(value.index))) {
        throw new Error('invalid');
      }
    } catch {
      fail('director_artifact_existing_checkpoint_invalid');
    }
  }

  private async checkpointNow(value: DirectorArtifactCheckpoint): Promise<void> {
    this.throwIfAborted();
    this.validate(value);
    this.throwIfAborted();
    const { directorRoot, stagingRoot, checkpointsRoot } = await this.prepareDirectories();
    this.throwIfAborted();
    const stagingPath = path.join(stagingRoot, value.checkpointId);
    const checkpointPath = path.join(checkpointsRoot, value.checkpointId);
    if (!isPathInside(stagingRoot, stagingPath) || !isPathInside(checkpointsRoot, checkpointPath)) {
      fail('director_artifact_path_invalid');
    }

    const pointer: DirectorCurrentPointerV1 = {
      schemaVersion: 1,
      pointerVersion: 'teaching-director-current-v1',
      checkpointId: value.checkpointId,
      relativePath: `checkpoints/${value.checkpointId}`,
      index: value.index,
    };
    const pointerBytes = jsonBytes(pointer);
    const currentPath = path.join(directorRoot, 'current.json');
    let currentTempPath: string | null = null;
    let checkpointReady = false;

    try {
      const checkpointType = await pathType(checkpointPath);
      if (checkpointType !== 'missing') {
        await this.validateExistingCheckpoint(checkpointPath, value);
        checkpointReady = true;
      } else {
        const stagingType = await pathType(stagingPath);
        if (stagingType === 'invalid' || stagingType === 'file') fail('director_artifact_path_invalid');
        if (stagingType === 'directory') await rm(stagingPath, { recursive: true, force: true });
        await mkdir(stagingPath);
        for (const file of value.files) {
          this.throwIfAborted();
          await writeSyncedFile(path.join(stagingPath, file.fileName), file.bytes);
        }
        this.throwIfAborted();
        await writeSyncedFile(path.join(stagingPath, 'index.json'), jsonBytes(value.index));
        await syncDirectory(stagingPath);
        await rename(stagingPath, checkpointPath);
        await syncDirectory(checkpointsRoot);
        checkpointReady = true;
      }

      const currentType = await pathType(currentPath);
      this.throwIfAborted();
      if (currentType === 'invalid' || currentType === 'directory') fail('director_artifact_path_invalid');
      if (currentType === 'file') {
        const alreadyPublished = bytesEqual(await readFile(currentPath), pointerBytes);
        this.throwIfAborted();
        if (alreadyPublished) return;
      }

      await this.faults?.beforePublishCurrent?.();
      this.throwIfAborted();
      currentTempPath = path.join(directorRoot, `.current-${randomUUID()}.tmp`);
      await writeSyncedFile(currentTempPath, pointerBytes);
      this.throwIfAborted();
      await rename(currentTempPath, currentPath);
      currentTempPath = null;
      await syncDirectory(directorRoot);
    } catch (error) {
      if (currentTempPath) await rm(currentTempPath, { force: true }).catch(() => undefined);
      if (!checkpointReady) await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) fail('director_artifact_cancelled');
  }
}
