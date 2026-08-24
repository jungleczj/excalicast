import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';

export const NATIVE_FINAL_RENDER_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
export const NATIVE_FINAL_RENDER_POINTER_MAX_BYTES = 8 * 1024;
export const NATIVE_FINAL_RENDER_OUTPUT_MAX_BYTES = 2 * 1024 * 1024 * 1024 * 1024;
export const NATIVE_FINAL_RENDER_MAX_DURATION_US = 12 * 60 * 60 * 1_000_000;
export const NATIVE_FINAL_RENDER_MAX_KEEP_RANGES = 65_536;

const RECORDING_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const REQUEST_ID = /^final-r([1-9][0-9]{0,8})-[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface NativeFinalRenderKeepRangeV1 {
  readonly startUs: number;
  readonly endUs: number;
}

export interface NativeFinalRenderIntentV1 {
  readonly schemaVersion: 1;
  readonly recordingId: string;
  readonly revision: number;
  readonly format: 'mp4';
  readonly sourceDurationUs: number;
  readonly keepRanges: readonly NativeFinalRenderKeepRangeV1[];
  readonly output: {
    readonly width: number;
    readonly height: number;
    readonly framesPerSecond: 24 | 30 | 60;
    readonly quality: 'standard' | 'high';
  };
  readonly camera: {
    readonly policy: 'off' | 'overlay';
    readonly layout: 'circle-bottom-right' | 'rounded-bottom-right' | 'rounded-top-right';
  };
  readonly director: {
    readonly policy: 'off' | 'calm' | 'balanced' | 'dynamic';
  };
  readonly teaching: {
    readonly policy: 'off' | 'preselected-only';
  };
}

interface NativeFinalRenderRequestCoreV1 {
  readonly intent: NativeFinalRenderIntentV1;
  readonly intentSha256: string;
  readonly manifestVersion: 'native-final-render-request-v1';
  readonly outputRelativePath: string;
  readonly owner: 'desktop-main';
  readonly recordingId: string;
  readonly requestId: string;
  readonly revision: number;
  readonly schemaVersion: 1;
}

export interface NativeFinalRenderRequestManifestV1 extends NativeFinalRenderRequestCoreV1 {
  readonly requestSha256: string;
}

export interface NativeFinalRenderOutputIdentityV1 {
  readonly relativePath: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface NativeFinalRenderManifestFaults {
  readonly afterRequestLinkBeforeDirectorySync?: () => void | Promise<void>;
  readonly afterRequestDirectorySyncBeforeTemporaryUnlink?: () => void | Promise<void>;
  readonly afterRequestTemporaryUnlinkBeforeDirectorySync?: () => void | Promise<void>;
  /** Deterministic race injection after the source fd is verified and kept open. */
  readonly afterSourceVerifiedBeforeOwnership?: () => void | Promise<void>;
  readonly afterPublishedEntryLinkedBeforeDirectorySync?: () => void | Promise<void>;
  readonly afterPublishedDirectorySyncBeforeSourceUnlink?: () => void | Promise<void>;
  readonly afterSourceUnlinkBeforeOutputsDirectorySync?: () => void | Promise<void>;
  /** Simulates power loss only after the owned file and its parent are durable. */
  readonly afterOwnedOutputDurabilityBarrier?: () => void | Promise<void>;
}

interface NativeFinalRenderCurrentPointerV1 {
  readonly schemaVersion: 1;
  readonly pointerVersion: 'native-final-render-current-v1';
  readonly recordingId: string;
  readonly requestId: string;
  readonly requestSha256: string;
  readonly revision: number;
  readonly state: 'requested' | 'ready';
  readonly output?: NativeFinalRenderOutputIdentityV1;
}

export type NativeFinalRenderObservableStateV1 = NativeFinalRenderRequestManifestV1 & {
  readonly state: 'requested' | 'ready';
  readonly output?: NativeFinalRenderOutputIdentityV1;
};

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  errorCode: string,
): void {
  const keys = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) fail(errorCode);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('native_final_render_intent_invalid');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) fail('native_final_render_intent_invalid');
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function clone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function validateIntent(value: unknown): NativeFinalRenderIntentV1 {
  if (!isRecord(value)) fail('native_final_render_intent_invalid');
  assertExactKeys(value, [
    'schemaVersion', 'recordingId', 'revision', 'format', 'sourceDurationUs', 'keepRanges',
    'output', 'camera', 'director', 'teaching',
  ], 'native_final_render_intent_unknown_key');
  if (value.schemaVersion !== 1
    || typeof value.recordingId !== 'string' || !RECORDING_ID.test(value.recordingId)
    || !safeInteger(value.revision, 1, 999_999_999)
    || value.format !== 'mp4'
    || !safeInteger(value.sourceDurationUs, 1, NATIVE_FINAL_RENDER_MAX_DURATION_US)) {
    if (typeof value.sourceDurationUs === 'number' && value.sourceDurationUs > NATIVE_FINAL_RENDER_MAX_DURATION_US) {
      fail('native_final_render_duration_limit_exceeded');
    }
    fail('native_final_render_intent_invalid');
  }
  if (!Array.isArray(value.keepRanges)
    || value.keepRanges.length < 1
    || value.keepRanges.length > NATIVE_FINAL_RENDER_MAX_KEEP_RANGES) {
    fail(value.keepRanges instanceof Array && value.keepRanges.length > NATIVE_FINAL_RENDER_MAX_KEEP_RANGES
      ? 'native_final_render_keep_range_limit_exceeded'
      : 'native_final_render_keep_ranges_invalid');
  }
  let previousEndUs = -1;
  for (const range of value.keepRanges) {
    if (!isRecord(range)) fail('native_final_render_keep_ranges_invalid');
    assertExactKeys(range, ['startUs', 'endUs'], 'native_final_render_intent_unknown_key');
    if (!safeInteger(range.startUs, 0, value.sourceDurationUs)
      || !safeInteger(range.endUs, 1, value.sourceDurationUs)
      || range.startUs >= range.endUs
      || range.startUs < previousEndUs) {
      fail('native_final_render_keep_ranges_invalid');
    }
    previousEndUs = range.endUs;
  }

  if (!isRecord(value.output)) fail('native_final_render_output_invalid');
  assertExactKeys(
    value.output,
    ['width', 'height', 'framesPerSecond', 'quality'],
    'native_final_render_intent_unknown_key',
  );
  if (!safeInteger(value.output.width, 320, 4_096)
    || !safeInteger(value.output.height, 240, 2_304)
    || (value.output.framesPerSecond !== 24
      && value.output.framesPerSecond !== 30
      && value.output.framesPerSecond !== 60)
    || (value.output.quality !== 'standard' && value.output.quality !== 'high')) {
    fail('native_final_render_output_invalid');
  }

  if (!isRecord(value.camera)) fail('native_final_render_camera_policy_invalid');
  assertExactKeys(value.camera, ['policy', 'layout'], 'native_final_render_intent_unknown_key');
  if ((value.camera.policy !== 'off' && value.camera.policy !== 'overlay')
    || (value.camera.layout !== 'circle-bottom-right'
      && value.camera.layout !== 'rounded-bottom-right'
      && value.camera.layout !== 'rounded-top-right')) {
    fail('native_final_render_camera_policy_invalid');
  }

  if (!isRecord(value.director)) fail('native_final_render_director_policy_invalid');
  assertExactKeys(value.director, ['policy'], 'native_final_render_intent_unknown_key');
  if (value.director.policy !== 'off'
    && value.director.policy !== 'calm'
    && value.director.policy !== 'balanced'
    && value.director.policy !== 'dynamic') {
    fail('native_final_render_director_policy_invalid');
  }

  if (!isRecord(value.teaching)) fail('native_final_render_teaching_policy_invalid');
  assertExactKeys(value.teaching, ['policy'], 'native_final_render_intent_unknown_key');
  if (value.teaching.policy !== 'off' && value.teaching.policy !== 'preselected-only') {
    fail('native_final_render_teaching_policy_invalid');
  }
  return clone(value) as unknown as NativeFinalRenderIntentV1;
}

function requestForIntent(value: unknown): NativeFinalRenderRequestManifestV1 {
  const validated = validateIntent(value);
  const intentSha256 = sha256(canonicalJson(validated));
  const requestId = `final-r${validated.revision}-${intentSha256.slice(0, 32)}`;
  const core: NativeFinalRenderRequestCoreV1 = {
    intent: validated,
    intentSha256,
    manifestVersion: 'native-final-render-request-v1',
    outputRelativePath: `final/outputs/${requestId}.mp4`,
    owner: 'desktop-main',
    recordingId: validated.recordingId,
    requestId,
    revision: validated.revision,
    schemaVersion: 1,
  };
  const requestSha256 = sha256(canonicalJson(core));
  const request = { ...core, requestSha256 };
  if (Buffer.byteLength(canonicalJson(request), 'utf8') > NATIVE_FINAL_RENDER_REQUEST_MAX_BYTES) {
    fail('native_final_render_request_budget_exceeded');
  }
  return request;
}

async function ensureDirectory(candidate: string, create: boolean): Promise<void> {
  let created = false;
  if (create) {
    const firstCreated = await mkdir(candidate, { recursive: true, mode: 0o700 });
    created = firstCreated !== undefined;
  }
  const details = await lstat(candidate).catch(() => fail('native_final_render_storage_unverified'));
  if (!details.isDirectory() || details.isSymbolicLink()) fail('native_final_render_storage_unverified');
  if (created) await syncDirectory(path.dirname(candidate));
}

async function storagePaths(projectRoot: string, create: boolean) {
  if (!path.isAbsolute(projectRoot)) fail('native_final_render_project_root_invalid');
  const root = path.resolve(projectRoot);
  const finalRoot = path.join(root, 'final');
  const requests = path.join(finalRoot, 'requests');
  const outputs = path.join(finalRoot, 'outputs');
  const published = path.join(finalRoot, 'published');
  await ensureDirectory(root, create);
  await ensureDirectory(finalRoot, create);
  await ensureDirectory(requests, create);
  await ensureDirectory(outputs, create);
  await ensureDirectory(published, create);
  return {
    root,
    finalRoot,
    requests,
    outputs,
    published,
    current: path.join(finalRoot, 'current.json'),
  };
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
    .catch(() => fail('native_final_render_storage_unverified'));
  try { await handle.sync(); } finally { await handle.close(); }
}

async function readBounded(
  candidate: string,
  maximumBytes: number,
  missingCode: string,
  invalidCode: string,
  allowedLinkCounts: readonly number[] = [1],
): Promise<Buffer> {
  let handle: FileHandle;
  try { handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail(missingCode);
    return fail(invalidCode);
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()
      || !allowedLinkCounts.includes(before.nlink)
      || before.size < 1
      || before.size > maximumBytes
      || !Number.isSafeInteger(before.size)) {
      fail(invalidCode);
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead < 1) fail(invalidCode);
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.dev !== before.dev
      || after.ino !== before.ino
      || !allowedLinkCounts.includes(after.nlink)
      || after.size !== before.size) fail(invalidCode);
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseCanonicalJson(bytes: Buffer, invalidCode: string): unknown {
  try {
    const raw = bytes.toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (canonicalJson(parsed) !== raw) fail(invalidCode);
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === invalidCode) throw error;
    return fail(invalidCode);
  }
}

function parseRequest(value: unknown): NativeFinalRenderRequestManifestV1 {
  if (!isRecord(value)) fail('native_final_render_request_invalid');
  assertExactKeys(value, [
    'intent', 'intentSha256', 'manifestVersion', 'outputRelativePath', 'owner', 'recordingId',
    'requestId', 'requestSha256', 'revision', 'schemaVersion',
  ], 'native_final_render_request_invalid');
  const expected = requestForIntent(value.intent);
  if (canonicalJson(value) !== canonicalJson(expected)) fail('native_final_render_request_invalid');
  return expected;
}

function parsePointer(value: unknown, recordingId: string): NativeFinalRenderCurrentPointerV1 {
  if (!isRecord(value)) fail('native_final_render_pointer_invalid');
  const expectedKeys = value.state === 'ready'
    ? ['schemaVersion', 'pointerVersion', 'recordingId', 'requestId', 'requestSha256', 'revision', 'state', 'output']
    : ['schemaVersion', 'pointerVersion', 'recordingId', 'requestId', 'requestSha256', 'revision', 'state'];
  assertExactKeys(value, expectedKeys, 'native_final_render_pointer_invalid');
  if (value.schemaVersion !== 1
    || value.pointerVersion !== 'native-final-render-current-v1'
    || value.recordingId !== recordingId
    || typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId)
    || typeof value.requestSha256 !== 'string' || !SHA256.test(value.requestSha256)
    || !safeInteger(value.revision, 1, 999_999_999)
    || (value.state !== 'requested' && value.state !== 'ready')) {
    fail('native_final_render_pointer_invalid');
  }
  if (value.state === 'ready') {
    if (!isRecord(value.output)) fail('native_final_render_pointer_invalid');
    assertExactKeys(value.output, ['relativePath', 'sha256', 'byteLength'], 'native_final_render_pointer_invalid');
    if (typeof value.output.relativePath !== 'string'
      || typeof value.output.sha256 !== 'string' || !SHA256.test(value.output.sha256)
      || !safeInteger(value.output.byteLength, 1, NATIVE_FINAL_RENDER_OUTPUT_MAX_BYTES)) {
      fail('native_final_render_pointer_invalid');
    }
  }
  return clone(value) as unknown as NativeFinalRenderCurrentPointerV1;
}

async function readRequest(
  requests: string,
  requestId: string,
  allowedLinkCounts: readonly number[] = [1],
): Promise<NativeFinalRenderRequestManifestV1> {
  if (!REQUEST_ID.test(requestId)) fail('native_final_render_request_invalid');
  return readRequestPath(path.join(requests, `${requestId}.json`), allowedLinkCounts);
}

async function readRequestPath(
  candidate: string,
  allowedLinkCounts: readonly number[] = [1],
): Promise<NativeFinalRenderRequestManifestV1> {
  const bytes = await readBounded(
    candidate,
    NATIVE_FINAL_RENDER_REQUEST_MAX_BYTES,
    'native_final_render_request_missing',
    'native_final_render_request_invalid',
    allowedLinkCounts,
  );
  return parseRequest(parseCanonicalJson(bytes, 'native_final_render_request_invalid'));
}

async function readPointer(current: string, recordingId: string): Promise<NativeFinalRenderCurrentPointerV1> {
  const bytes = await readBounded(
    current,
    NATIVE_FINAL_RENDER_POINTER_MAX_BYTES,
    'native_final_render_pointer_missing',
    'native_final_render_pointer_invalid',
  );
  return parsePointer(parseCanonicalJson(bytes, 'native_final_render_pointer_invalid'), recordingId);
}

async function readPointerIfPresent(
  current: string,
  recordingId: string,
): Promise<NativeFinalRenderCurrentPointerV1 | undefined> {
  try { return await readPointer(current, recordingId); }
  catch (error) {
    if (error instanceof Error && error.message === 'native_final_render_pointer_missing') return undefined;
    throw error;
  }
}

function observable(
  request: NativeFinalRenderRequestManifestV1,
  pointer: NativeFinalRenderCurrentPointerV1,
): NativeFinalRenderObservableStateV1 {
  return {
    ...request,
    state: pointer.state,
    ...(pointer.output ? { output: pointer.output } : {}),
  };
}

function publishedOutputRelativePath(requestId: string, outputSha256: string): string {
  if (!REQUEST_ID.test(requestId) || !SHA256.test(outputSha256)) {
    fail('native_final_render_output_identity_invalid');
  }
  return `final/published/${requestId}-${outputSha256}.mp4`;
}

async function writeTemporary(directory: string, body: string, prefix: string): Promise<string> {
  const temporary = path.join(directory, `.${prefix}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(body, { encoding: 'utf8' });
    await handle.sync();
    return temporary;
  } finally {
    await handle?.close();
  }
}

async function persistImmutableRequest(
  requests: string,
  request: NativeFinalRenderRequestManifestV1,
  faults?: NativeFinalRenderManifestFaults,
): Promise<void> {
  const destination = path.join(requests, `${request.requestId}.json`);
  const body = canonicalJson(request);
  const temporaryPrefix = `.${request.requestId}.`;
  const ownedTemporaries = (await readdir(requests))
    .filter((entry) => entry.startsWith(temporaryPrefix) && entry.endsWith('.tmp'))
    .map((entry) => path.join(requests, entry));
  const destinationInfo = await lstat(destination).catch(() => undefined);

  if (destinationInfo) {
    if (destinationInfo.nlink === 1) {
      if (ownedTemporaries.length !== 0) fail('native_final_render_request_invalid');
      const existing = await readRequest(requests, request.requestId);
      if (canonicalJson(existing) !== body) fail('native_final_render_request_invalid');
      await syncDirectory(requests);
      return;
    }
    if (destinationInfo.nlink !== 2 || ownedTemporaries.length !== 1) {
      fail('native_final_render_request_invalid');
    }
    const temporaryInfo = await lstat(ownedTemporaries[0]).catch(() => fail('native_final_render_request_invalid'));
    if (temporaryInfo.dev !== destinationInfo.dev || temporaryInfo.ino !== destinationInfo.ino
      || temporaryInfo.nlink !== 2 || temporaryInfo.size !== destinationInfo.size) {
      fail('native_final_render_request_invalid');
    }
    const existing = await readRequest(requests, request.requestId, [2]);
    const temporaryRequest = await readRequestPath(ownedTemporaries[0], [2]);
    if (canonicalJson(existing) !== body || canonicalJson(temporaryRequest) !== body) {
      fail('native_final_render_request_invalid');
    }
    // The destination entry may not have reached disk before the previous
    // process died. Persist it while the temporary alias still protects bytes.
    await syncDirectory(requests);
    await unlink(ownedTemporaries[0]);
    await syncDirectory(requests);
    const recovered = await readRequest(requests, request.requestId);
    if (canonicalJson(recovered) !== body) fail('native_final_render_request_invalid');
    return;
  }

  if (ownedTemporaries.length > 1) fail('native_final_render_request_invalid');
  const temporary = ownedTemporaries[0] ?? await writeTemporary(requests, body, request.requestId);
  const temporaryRequest = await readRequestPath(temporary);
  if (canonicalJson(temporaryRequest) !== body) fail('native_final_render_request_invalid');
  await link(temporary, destination);
  await faults?.afterRequestLinkBeforeDirectorySync?.();
  await syncDirectory(requests);
  await faults?.afterRequestDirectorySyncBeforeTemporaryUnlink?.();
  await unlink(temporary);
  await faults?.afterRequestTemporaryUnlinkBeforeDirectorySync?.();
  await syncDirectory(requests);
  const persisted = await readRequest(requests, request.requestId);
  if (canonicalJson(persisted) !== body) fail('native_final_render_request_invalid');
}

async function publishPointer(finalRoot: string, current: string, pointer: NativeFinalRenderCurrentPointerV1) {
  const body = canonicalJson(pointer);
  if (Buffer.byteLength(body, 'utf8') > NATIVE_FINAL_RENDER_POINTER_MAX_BYTES) {
    fail('native_final_render_pointer_invalid');
  }
  const temporary = await writeTemporary(finalRoot, body, 'current');
  try {
    await rename(temporary, current);
    await syncDirectory(finalRoot);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

const projectLocks = new Map<string, Promise<void>>();

async function withProjectLock<T>(projectRoot: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(projectRoot);
  const previous = projectLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  projectLocks.set(key, gate);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (projectLocks.get(key) === gate) projectLocks.delete(key);
  }
}

async function loadCurrent(
  projectRoot: string,
  recordingId: string,
): Promise<{ request: NativeFinalRenderRequestManifestV1; pointer: NativeFinalRenderCurrentPointerV1 }> {
  if (!RECORDING_ID.test(recordingId)) fail('native_final_render_intent_invalid');
  const paths = await storagePaths(projectRoot, false);
  const pointer = await readPointer(paths.current, recordingId);
  const request = await readRequest(paths.requests, pointer.requestId);
  if (request.recordingId !== recordingId
    || request.requestSha256 !== pointer.requestSha256
    || request.revision !== pointer.revision) {
    fail('native_final_render_pointer_invalid');
  }
  if (pointer.output
    && pointer.output.relativePath !== publishedOutputRelativePath(request.requestId, pointer.output.sha256)) {
    fail('native_final_render_pointer_invalid');
  }
  return { request, pointer };
}

/** Main-only boundary: validates semantic renderer intent and owns every filesystem identity. */
export function persistNativeFinalRenderIntent(input: {
  projectRoot: string;
  intent: unknown;
  faults?: NativeFinalRenderManifestFaults;
}): Promise<NativeFinalRenderObservableStateV1> {
  return withProjectLock(input.projectRoot, async () => {
    // Keep renderer validation inside the asynchronous main-process boundary,
    // but before any storage directory is created.
    const candidate = requestForIntent(input.intent);
    const paths = await storagePaths(input.projectRoot, true);
    const current = await readPointerIfPresent(paths.current, candidate.recordingId);
    if (current) {
      const currentRequest = await readRequest(paths.requests, current.requestId);
      if (currentRequest.requestSha256 !== current.requestSha256) fail('native_final_render_pointer_invalid');
      if (candidate.revision < current.revision) fail('native_final_render_revision_stale');
      if (candidate.revision === current.revision && candidate.requestId !== current.requestId) {
        fail('native_final_render_revision_conflict');
      }
      if (candidate.requestId === current.requestId) {
        if (candidate.requestSha256 !== current.requestSha256) fail('native_final_render_request_invalid');
        return observable(currentRequest, current);
      }
    }

    await persistImmutableRequest(paths.requests, candidate, input.faults);
    const pointer: NativeFinalRenderCurrentPointerV1 = {
      schemaVersion: 1,
      pointerVersion: 'native-final-render-current-v1',
      recordingId: candidate.recordingId,
      requestId: candidate.requestId,
      requestSha256: candidate.requestSha256,
      revision: candidate.revision,
      state: 'requested',
    };
    await publishPointer(paths.finalRoot, paths.current, pointer);
    return observable(candidate, pointer);
  });
}

export async function readCurrentNativeFinalRender(input: {
  projectRoot: string;
  recordingId: string;
}): Promise<NativeFinalRenderObservableStateV1> {
  const { request, pointer } = await loadCurrent(input.projectRoot, input.recordingId);
  return observable(request, pointer);
}

interface VerifiedOutputSource {
  readonly handle: FileHandle;
  readonly dev: number;
  readonly ino: number;
  readonly byteLength: number;
  readonly sha256: string;
}

async function hashFileHandle(
  handle: FileHandle,
  byteLength: number,
): Promise<string> {
  const hasher = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let offset = 0;
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.byteLength, byteLength - offset),
      offset,
    );
    if (bytesRead < 1) fail('native_final_render_output_unverified');
    hasher.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return hasher.digest('hex');
}

function assertSameSingleLinkOutput(
  details: Awaited<ReturnType<FileHandle['stat']>>,
  expected?: Pick<VerifiedOutputSource, 'dev' | 'ino' | 'byteLength'>,
): void {
  if (!details.isFile()
    || details.nlink !== 1
    || details.size < 1
    || details.size > NATIVE_FINAL_RENDER_OUTPUT_MAX_BYTES
    || !Number.isSafeInteger(details.size)
    || (expected && (details.dev !== expected.dev
      || details.ino !== expected.ino
      || details.size !== expected.byteLength))) {
    fail('native_final_render_output_unverified');
  }
}

async function openVerifiedOutputSource(
  candidate: string,
  outputsDirectory: string,
): Promise<VerifiedOutputSource> {
  let handle: FileHandle;
  try { handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { return fail('native_final_render_output_unverified'); }
  let verified = false;
  try {
    const before = await handle.stat();
    assertSameSingleLinkOutput(before);
    const identity = { dev: before.dev, ino: before.ino, byteLength: before.size };
    const outputSha256 = await hashFileHandle(handle, before.size);
    const after = await handle.stat();
    assertSameSingleLinkOutput(after, identity);
    // A ready pointer must never outrun the renderer's file or its directory
    // entry after power loss.
    await handle.sync();
    await syncDirectory(outputsDirectory);
    verified = true;
    return { handle, ...identity, sha256: outputSha256 };
  } finally {
    if (!verified) await handle.close();
  }
}

async function hashOutput(candidate: string): Promise<{ sha256: string; byteLength: number }> {
  let handle: FileHandle;
  try { handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { return fail('native_final_render_output_unverified'); }
  try {
    const before = await handle.stat();
    assertSameSingleLinkOutput(before);
    const expected = { dev: before.dev, ino: before.ino, byteLength: before.size };
    const outputSha256 = await hashFileHandle(handle, before.size);
    assertSameSingleLinkOutput(await handle.stat(), expected);
    return { sha256: outputSha256, byteLength: before.size };
  } finally {
    await handle.close();
  }
}

async function inspectOutputWithLinks(
  candidate: string,
  allowedLinkCounts: readonly number[],
): Promise<{ dev: number; ino: number; nlink: number; sha256: string; byteLength: number }> {
  let handle: FileHandle;
  try { handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { return fail('native_final_render_output_unverified'); }
  try {
    const before = await handle.stat();
    if (!before.isFile()
      || !allowedLinkCounts.includes(before.nlink)
      || before.size < 1
      || before.size > NATIVE_FINAL_RENDER_OUTPUT_MAX_BYTES
      || !Number.isSafeInteger(before.size)) fail('native_final_render_output_unverified');
    const outputSha256 = await hashFileHandle(handle, before.size);
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino || after.nlink !== before.nlink
      || after.size !== before.size) fail('native_final_render_output_unverified');
    return {
      dev: before.dev,
      ino: before.ino,
      nlink: before.nlink,
      sha256: outputSha256,
      byteLength: before.size,
    };
  } finally {
    await handle.close();
  }
}

async function recoverOwnedOutputIfPresent(input: {
  sourcePath: string;
  destination: string;
  outputsDirectory: string;
  publishedDirectory: string;
  expectedSha256: string;
  expectedByteLength: number;
}): Promise<boolean> {
  const destinationExists = await lstat(input.destination).then(() => true).catch(() => false);
  if (!destinationExists) return false;
  const destination = await inspectOutputWithLinks(input.destination, [1, 2]);
  if (destination.sha256 !== input.expectedSha256
    || destination.byteLength !== input.expectedByteLength) {
    fail('native_final_render_output_identity_invalid');
  }
  const sourceExists = await lstat(input.sourcePath).then(() => true).catch(() => false);
  if (destination.nlink === 1) {
    if (sourceExists) fail('native_final_render_output_unverified');
    // Re-issue both barriers: this also recovers a crash after source unlink
    // but before the outputs-directory deletion became durable.
    await syncDirectory(input.publishedDirectory);
    await syncDirectory(input.outputsDirectory);
    return true;
  }
  if (!sourceExists) fail('native_final_render_output_unverified');
  const source = await inspectOutputWithLinks(input.sourcePath, [2]);
  if (source.dev !== destination.dev
    || source.ino !== destination.ino
    || source.sha256 !== destination.sha256
    || source.byteLength !== destination.byteLength) {
    fail('native_final_render_output_unverified');
  }
  // Exactly two links at the two derived owned paths is the only legal
  // intermediate state. More links were rejected above as external aliases.
  await syncDirectory(input.publishedDirectory);
  await unlink(input.sourcePath);
  await syncDirectory(input.outputsDirectory);
  const recovered = await hashOutput(input.destination);
  if (recovered.sha256 !== input.expectedSha256
    || recovered.byteLength !== input.expectedByteLength) {
    fail('native_final_render_output_identity_invalid');
  }
  return true;
}

async function publishOwnedOutput(input: {
  source: VerifiedOutputSource;
  sourcePath: string;
  outputsDirectory: string;
  publishedDirectory: string;
  relativePath: string;
  faults?: NativeFinalRenderManifestFaults;
}): Promise<void> {
  const destination = path.join(path.dirname(input.publishedDirectory), '..', input.relativePath);
  // Re-open the helper pathname after any asynchronous boundary. Holding the
  // original fd is not enough: the directory entry itself may have changed.
  const reopened = await openVerifiedOutputSource(input.sourcePath, input.outputsDirectory);
  try {
    if (reopened.dev !== input.source.dev
      || reopened.ino !== input.source.ino
      || reopened.byteLength !== input.source.byteLength
      || reopened.sha256 !== input.source.sha256) {
      fail('native_final_render_output_unverified');
    }
  } finally {
    await reopened.handle.close();
  }

  assertSameSingleLinkOutput(await input.source.handle.stat(), input.source);
  await input.source.handle.chmod(0o400);
  await input.source.handle.sync();

  let linkedByMain = false;
  let linkedValidated = false;
  try {
    await link(input.sourcePath, destination);
    linkedByMain = true;
    let linkedHandle: FileHandle;
    try { linkedHandle = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch { return fail('native_final_render_output_unverified'); }
    try {
      const linked = await linkedHandle.stat();
      if (!linked.isFile()
        || linked.dev !== input.source.dev
        || linked.ino !== input.source.ino
        || linked.nlink !== 2
        || linked.size !== input.source.byteLength
        || await hashFileHandle(linkedHandle, linked.size) !== input.source.sha256) {
        fail('native_final_render_output_unverified');
      }
    } finally {
      await linkedHandle.close();
    }
    linkedValidated = true;
    await input.faults?.afterPublishedEntryLinkedBeforeDirectorySync?.();
    // Persist the destination while the source path is still a durable second
    // link. At every crash boundary at least one path now survives restart.
    await syncDirectory(input.publishedDirectory);
    await input.faults?.afterPublishedDirectorySyncBeforeSourceUnlink?.();
    await unlink(input.sourcePath);
    await input.faults?.afterSourceUnlinkBeforeOutputsDirectorySync?.();
    await syncDirectory(input.outputsDirectory);
    assertSameSingleLinkOutput(await input.source.handle.stat(), input.source);
    const owned = await hashOutput(destination);
    if (owned.sha256 !== input.source.sha256 || owned.byteLength !== input.source.byteLength) {
      fail('native_final_render_output_identity_invalid');
    }
  } catch (reason) {
    if (linkedByMain && !linkedValidated) {
      await unlink(destination).catch(() => undefined);
      await syncDirectory(input.publishedDirectory).catch(() => undefined);
    }
    if (!linkedByMain && (reason as NodeJS.ErrnoException).code === 'EEXIST') {
      fail('native_final_render_output_unverified');
    }
    throw reason;
  }
}

/** Publishes ready only after main re-hashes the actual derived output path from one no-follow descriptor. */
export function publishNativeFinalRenderOutput(input: {
  projectRoot: string;
  recordingId: string;
  requestId: string;
  requestSha256: string;
  outputSha256: string;
  outputByteLength: number;
  faults?: NativeFinalRenderManifestFaults;
}): Promise<NativeFinalRenderObservableStateV1> {
  return withProjectLock(input.projectRoot, async () => {
    if (!REQUEST_ID.test(input.requestId)
      || !SHA256.test(input.requestSha256)
      || !SHA256.test(input.outputSha256)
      || !safeInteger(input.outputByteLength, 1, NATIVE_FINAL_RENDER_OUTPUT_MAX_BYTES)) {
      fail('native_final_render_output_identity_invalid');
    }
    const { request, pointer } = await loadCurrent(input.projectRoot, input.recordingId);
    if (request.requestId !== input.requestId || request.requestSha256 !== input.requestSha256) {
      fail('native_final_render_request_identity_mismatch');
    }
    if (pointer.state === 'ready') {
      if (!pointer.output
        || pointer.output.sha256 !== input.outputSha256
        || pointer.output.byteLength !== input.outputByteLength) {
        fail('native_final_render_output_identity_invalid');
      }
      const actual = await hashOutput(path.join(path.resolve(input.projectRoot), pointer.output.relativePath));
      if (actual.sha256 !== pointer.output.sha256 || actual.byteLength !== pointer.output.byteLength) {
        fail('native_final_render_output_identity_invalid');
      }
      return observable(request, pointer);
    }
    const paths = await storagePaths(input.projectRoot, false);
    const output: NativeFinalRenderOutputIdentityV1 = {
      relativePath: publishedOutputRelativePath(request.requestId, input.outputSha256),
      sha256: input.outputSha256,
      byteLength: input.outputByteLength,
    };
    const ownedPath = path.join(path.resolve(input.projectRoot), output.relativePath);
    const outputPath = path.join(path.resolve(input.projectRoot), request.outputRelativePath);
    if (await recoverOwnedOutputIfPresent({
      sourcePath: outputPath,
      destination: ownedPath,
      outputsDirectory: paths.outputs,
      publishedDirectory: paths.published,
      expectedSha256: output.sha256,
      expectedByteLength: output.byteLength,
    })) {
      await input.faults?.afterOwnedOutputDurabilityBarrier?.();
      const ready: NativeFinalRenderCurrentPointerV1 = { ...pointer, state: 'ready', output };
      await publishPointer(paths.finalRoot, paths.current, ready);
      return observable(request, ready);
    }
    const source = await openVerifiedOutputSource(outputPath, paths.outputs);
    try {
      if (source.sha256 !== input.outputSha256 || source.byteLength !== input.outputByteLength) {
        fail('native_final_render_output_identity_invalid');
      }
      await input.faults?.afterSourceVerifiedBeforeOwnership?.();
      assertSameSingleLinkOutput(await source.handle.stat(), source);
      await publishOwnedOutput({
        source,
        sourcePath: outputPath,
        outputsDirectory: paths.outputs,
        publishedDirectory: paths.published,
        relativePath: output.relativePath,
        faults: input.faults,
      });
    } finally {
      await source.handle.close();
    }
    await input.faults?.afterOwnedOutputDurabilityBarrier?.();
    const ready: NativeFinalRenderCurrentPointerV1 = { ...pointer, state: 'ready', output };
    await publishPointer(paths.finalRoot, paths.current, ready);
    return observable(request, ready);
  });
}

/** Restart boundary: never adopts a ready label without independently verifying the output bytes. */
export async function adoptCurrentNativeFinalRender(input: {
  projectRoot: string;
  recordingId: string;
}): Promise<NativeFinalRenderObservableStateV1> {
  const { request, pointer } = await loadCurrent(input.projectRoot, input.recordingId);
  if (pointer.state !== 'ready' || !pointer.output) fail('native_final_render_output_not_ready');
  const actual = await hashOutput(path.join(path.resolve(input.projectRoot), pointer.output.relativePath));
  if (actual.sha256 !== pointer.output.sha256 || actual.byteLength !== pointer.output.byteLength) {
    fail('native_final_render_output_identity_invalid');
  }
  return observable(request, pointer);
}
