import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  DesktopDirectorJobEvidence,
  DesktopDirectorJobStatus,
} from '../../../src/desktop/productContract';
import type { DirectorArtifactIndexV1 } from '../../../src/desktop/teachingDirectorArtifactStore';
import {
  runNativeDirectorArtifactPipeline,
  type NativeDirectorPipelineRequest,
  type NativeDirectorPipelineResult,
} from './nativeDirectorPipeline';
import type {
  NativeRecordingManifest,
  NativeRecordingValidationReport,
} from './nativeHelperClient';
import { DIRECTOR_ARTIFACT_MAX_TOTAL_BYTES } from './directorArtifactWriter';

const RECORDING_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const CHECKPOINT_ID = /^director-[a-f0-9]{64}$/;
const DIRECTOR_REFERENCE = 'director/current.json' as const;
const ARTIFACT_FILE_NAMES = ['attention.json', 'camera.json', 'cleanup.json'] as const;
const ARTIFACT_FILE_NAME_SET = new Set<string>(ARTIFACT_FILE_NAMES);
const FALLBACK_MEDIA_TRACKS = ['camera', 'microphone', 'system-audio'] as const;
const DIRECTOR_CHECKPOINT_METADATA_MAX_BYTES = 256 * 1024;

export type DesktopDirectorPipelineRunner = (
  request: NativeDirectorPipelineRequest,
) => Promise<NativeDirectorPipelineResult>;

export interface DesktopDirectorJobHandle {
  status: DesktopDirectorJobStatus;
  completion: Promise<DesktopDirectorJobStatus>;
}

export interface DesktopDirectorJobServiceOptions {
  videosDirectory: string;
  isCaptureActive(): boolean;
  recoverProject(projectRoot: string): Promise<NativeRecordingManifest>;
  validateProject(projectRoot: string): Promise<NativeRecordingValidationReport>;
  runPipeline?: DesktopDirectorPipelineRunner;
}

interface DirectorJobEntry {
  status: DesktopDirectorJobStatus;
  completion: Promise<DesktopDirectorJobStatus>;
  controller: AbortController;
  settled: boolean;
}

export interface NativeDirectorDurationEvidence {
  durationUs: number;
  observedEndUs: number;
  source: 'native-manifest-segments' | 'native-validation-continuity';
}

interface CurrentCheckpoint {
  checkpointId: string;
  index: DirectorArtifactIndexV1;
}

export interface StopNativeCaptureWithDirectorOptions {
  flushInk(): Promise<void>;
  waitForInkTail(): Promise<void>;
  waitForInputTail(): Promise<void>;
  stopCapture(): Promise<'idle'>;
  onCaptureEnded(): void;
  enqueueDirector(): DesktopDirectorJobHandle;
}

type NativeCaptureStopResult = {
  state: 'idle';
  director: DesktopDirectorJobStatus;
};

/** Shares concurrent stop requests so the native helper and Director enqueue run once. */
export class DesktopNativeCaptureStopCoordinator {
  private inFlight: Promise<NativeCaptureStopResult> | null = null;

  run(stop: () => Promise<NativeCaptureStopResult>): Promise<NativeCaptureStopResult> {
    if (this.inFlight) return this.inFlight;
    let result: Promise<NativeCaptureStopResult>;
    try {
      result = stop();
    } catch (error) {
      return Promise.reject(error);
    }
    const shared = result.finally(() => {
      if (this.inFlight === shared) this.inFlight = null;
    });
    this.inFlight = shared;
    return shared;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRecordingId(recordingId: string): string {
  if (!RECORDING_ID.test(recordingId)) throw new Error('director_job_request_invalid');
  return recordingId;
}

export function parseDesktopDirectorJobPayload(payload: unknown): { recordingId: string } {
  if (!isRecord(payload) || Object.keys(payload).length !== 1 || typeof payload.recordingId !== 'string') {
    throw new Error('director_job_request_invalid');
  }
  return { recordingId: validateRecordingId(payload.recordingId) };
}

export function resolveDesktopDirectorProjectRoot(
  videosDirectory: string,
  recordingId: string,
): string {
  validateRecordingId(recordingId);
  if (!path.isAbsolute(videosDirectory)) throw new Error('director_videos_directory_invalid');
  return path.join(videosDirectory, 'Excalicast Projects', recordingId);
}

function safeEndUs(startUs: unknown, durationUs: unknown): number | null {
  if (!Number.isSafeInteger(startUs) || (startUs as number) < 0
    || !Number.isSafeInteger(durationUs) || (durationUs as number) < 1) return null;
  const endUs = (startUs as number) + (durationUs as number);
  return Number.isSafeInteger(endUs) && endUs > 0 ? endUs : null;
}

export function deriveNativeDirectorDuration(
  manifest: NativeRecordingManifest,
  validation: NativeRecordingValidationReport,
): NativeDirectorDurationEvidence | null {
  const manifestTrackEnd = (tracks: readonly string[]): number => {
    let maximum = 0;
    for (const track of tracks) {
      const segments = manifest.tracks[track];
      if (!Array.isArray(segments)) continue;
      for (const segment of segments) {
        const endUs = safeEndUs(segment?.startUs, segment?.durationUs);
        if (endUs !== null) maximum = Math.max(maximum, endUs);
      }
    }
    return maximum;
  };
  const validationTrackEnd = (tracks: readonly string[]): number => {
    let maximum = 0;
    for (const track of tracks) {
      const report = validation.continuity.tracks[
        track as keyof NativeRecordingValidationReport['continuity']['tracks']
      ];
      if (!report || !Number.isSafeInteger(report.endUs) || (report.endUs as number) <= 0) continue;
      maximum = Math.max(maximum, report.endUs as number);
    }
    return maximum;
  };
  const manifestScreenEndUs = manifestTrackEnd(['screen']);
  const validationScreenEndUs = validationTrackEnd(['screen']);
  const hasScreenAuthority = manifestScreenEndUs > 0 || validationScreenEndUs > 0;
  const manifestEndUs = hasScreenAuthority
    ? manifestScreenEndUs
    : manifestTrackEnd(FALLBACK_MEDIA_TRACKS);
  const validationEndUs = hasScreenAuthority
    ? validationScreenEndUs
    : validationTrackEnd(FALLBACK_MEDIA_TRACKS);

  const observedEndUs = Math.max(manifestEndUs, validationEndUs);
  if (observedEndUs <= 0) return null;
  const durationUs = Math.ceil(observedEndUs / 1_000) * 1_000;
  if (!Number.isSafeInteger(durationUs) || durationUs <= 0) return null;
  return {
    durationUs,
    observedEndUs,
    source: manifestEndUs >= validationEndUs
      ? 'native-manifest-segments'
      : 'native-validation-continuity',
  };
}

function baseEvidence(): DesktopDirectorJobEvidence {
  return {
    profile: 'Balanced',
    speechActivity: 'unavailable',
    speechIntervalCount: 0,
    preservedMedia: true,
    recoveredCheckpoint: false,
  };
}

function cloneStatus(status: DesktopDirectorJobStatus): DesktopDirectorJobStatus {
  return {
    ...status,
    ...(status.checkpoint ? { checkpoint: { ...status.checkpoint } } : {}),
    evidence: { ...status.evidence },
  };
}

function statusFor(
  recordingId: string,
  status: DesktopDirectorJobStatus['status'],
  code: string,
  retryable: boolean,
  evidence: DesktopDirectorJobEvidence,
  checkpoint?: CurrentCheckpoint,
): DesktopDirectorJobStatus {
  return {
    recordingId,
    status,
    code,
    retryable,
    ...(checkpoint
      ? {
          checkpoint: {
            owner: 'recording-manifest',
            reference: DIRECTOR_REFERENCE,
            checkpointId: checkpoint.checkpointId,
          },
        }
      : {}),
    evidence: { ...evidence },
  };
}

async function readBoundedJson(candidate: string): Promise<unknown | null> {
  try {
    const stat = await lstat(candidate);
    if (!stat.isFile()
      || stat.isSymbolicLink()
      || stat.size < 1
      || stat.size > DIRECTOR_CHECKPOINT_METADATA_MAX_BYTES) return null;
    const bytes = await readFile(candidate);
    if (bytes.byteLength !== stat.size
      || bytes.byteLength > DIRECTOR_CHECKPOINT_METADATA_MAX_BYTES) return null;
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

async function regularDirectory(candidate: string): Promise<boolean> {
  try {
    const stat = await lstat(candidate);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function parseReadyIndex(value: unknown, recordingId: string, checkpointId: string): DirectorArtifactIndexV1 | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.indexVersion !== 'teaching-director-artifact-index-v1'
    || value.owner !== 'recording-manifest'
    || value.artifactSetVersion !== 'teaching-director-artifacts-v1'
    || value.checkpointId !== checkpointId
    || value.sourceRecordingId !== recordingId
    || value.sessionId !== recordingId
    || value.status !== 'ready'
    || !Array.isArray(value.artifacts)
    || value.artifacts.length !== ARTIFACT_FILE_NAMES.length) return null;
  const names = new Set<string>();
  let declaredTotalBytes = 0;
  for (const artifact of value.artifacts) {
    if (!isRecord(artifact)
      || artifact.schemaVersion !== 1
      || typeof artifact.artifactVersion !== 'string'
      || artifact.artifactVersion.length === 0
      || typeof artifact.fileName !== 'string'
      || !ARTIFACT_FILE_NAME_SET.has(artifact.fileName)
      || names.has(artifact.fileName)
      || artifact.sourceRecordingId !== recordingId
      || artifact.sessionId !== recordingId
      || !isRecord(artifact.checksum)
      || artifact.checksum.algorithm !== 'sha256'
      || typeof artifact.checksum.value !== 'string'
      || !/^[a-f0-9]{64}$/.test(artifact.checksum.value)
      || !Number.isSafeInteger(artifact.byteLength)
      || (artifact.byteLength as number) < 1
      || artifact.status !== 'ready') return null;
    declaredTotalBytes += artifact.byteLength as number;
    if (!Number.isSafeInteger(declaredTotalBytes)
      || declaredTotalBytes > DIRECTOR_ARTIFACT_MAX_TOTAL_BYTES) return null;
    names.add(artifact.fileName);
  }
  return value as unknown as DirectorArtifactIndexV1;
}

async function inspectCurrentCheckpoint(
  projectRoot: string,
  recordingId: string,
): Promise<CurrentCheckpoint | null> {
  const directorRoot = path.join(projectRoot, 'director');
  const checkpointsRoot = path.join(directorRoot, 'checkpoints');
  if (!await regularDirectory(projectRoot)
    || !await regularDirectory(directorRoot)
    || !await regularDirectory(checkpointsRoot)) return null;
  const currentPath = path.join(projectRoot, DIRECTOR_REFERENCE);
  const pointer = await readBoundedJson(currentPath);
  if (!isRecord(pointer)
    || pointer.schemaVersion !== 1
    || pointer.pointerVersion !== 'teaching-director-current-v1'
    || typeof pointer.checkpointId !== 'string'
    || !CHECKPOINT_ID.test(pointer.checkpointId)
    || pointer.relativePath !== `checkpoints/${pointer.checkpointId}`) return null;
  const index = parseReadyIndex(pointer.index, recordingId, pointer.checkpointId);
  if (!index) return null;
  const checkpointRoot = path.join(checkpointsRoot, pointer.checkpointId);
  if (!await regularDirectory(checkpointRoot)) return null;
  const indexPath = path.join(checkpointRoot, 'index.json');
  try {
    const persisted = parseReadyIndex(
      await readBoundedJson(indexPath),
      recordingId,
      pointer.checkpointId,
    );
    if (!persisted || JSON.stringify(persisted) !== JSON.stringify(index)) return null;
    let totalBytes = 0;
    for (const artifact of index.artifacts) {
      const artifactPath = path.join(checkpointRoot, artifact.fileName);
      let stat;
      try {
        stat = await lstat(artifactPath);
      } catch {
        return null;
      }
      if (!stat.isFile()
        || stat.isSymbolicLink()
        || stat.size !== artifact.byteLength
        || stat.size > DIRECTOR_ARTIFACT_MAX_TOTAL_BYTES) return null;
      totalBytes += stat.size;
      if (!Number.isSafeInteger(totalBytes)
        || totalBytes > DIRECTOR_ARTIFACT_MAX_TOTAL_BYTES) return null;
      const bytes = await readFile(artifactPath);
      if (bytes.byteLength !== artifact.byteLength
        || createHash('sha256').update(bytes).digest('hex') !== artifact.checksum.value) return null;
    }
  } catch {
    return null;
  }
  return { checkpointId: pointer.checkpointId, index };
}

export class DesktopDirectorJobService {
  private readonly jobs = new Map<string, DirectorJobEntry>();
  private readonly runPipeline: DesktopDirectorPipelineRunner;

  constructor(private readonly options: DesktopDirectorJobServiceOptions) {
    if (!path.isAbsolute(options.videosDirectory)) throw new Error('director_videos_directory_invalid');
    this.runPipeline = options.runPipeline ?? runNativeDirectorArtifactPipeline;
  }

  enqueue(recordingId: string): DesktopDirectorJobHandle {
    validateRecordingId(recordingId);
    const existing = this.jobs.get(recordingId);
    if (existing) return this.handle(existing);
    this.assertCaptureInactive();
    return this.start(recordingId);
  }

  retry(recordingId: string): DesktopDirectorJobHandle {
    validateRecordingId(recordingId);
    const existing = this.jobs.get(recordingId);
    if (existing && !existing.settled) return this.handle(existing);
    if (existing?.status.status !== 'failed') return existing ? this.handle(existing) : this.enqueue(recordingId);
    if (!existing.status.retryable) throw new Error('director_job_not_retryable');
    this.assertCaptureInactive();
    return this.start(recordingId);
  }

  snapshot(recordingId: string): DesktopDirectorJobStatus | null {
    validateRecordingId(recordingId);
    const entry = this.jobs.get(recordingId);
    return entry ? cloneStatus(entry.status) : null;
  }

  assertCaptureMayStart(): void {
    for (const entry of this.jobs.values()) {
      if (!entry.settled) {
        throw new Error('native_capture_director_generation_active');
      }
    }
  }

  async prepareForCapture(timeoutMs = 3_000): Promise<void> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw new Error('native_capture_director_drain_timeout_invalid');
    }
    const active = [...this.jobs.entries()].filter(([, entry]) => !entry.settled);
    if (active.length === 0) return;
    for (const [recordingId, entry] of active) {
      entry.status = statusFor(
        recordingId,
        'failed',
        'director_job_preempted_for_capture',
        true,
        entry.status.evidence,
      );
      entry.controller.abort(new Error('director_job_preempted_for_capture'));
    }
    const drained = Promise.all(active.map(([, entry]) => entry.completion)).then(() => true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    });
    const didDrain = await Promise.race([drained, timedOut]);
    if (timeout) clearTimeout(timeout);
    if (!didDrain) throw new Error('native_capture_director_did_not_drain');
  }

  async status(recordingId: string): Promise<DesktopDirectorJobStatus> {
    validateRecordingId(recordingId);
    const existing = this.jobs.get(recordingId);
    if (existing) return cloneStatus(existing.status);
    const checkpoint = await inspectCurrentCheckpoint(
      resolveDesktopDirectorProjectRoot(this.options.videosDirectory, recordingId),
      recordingId,
    );
    if (checkpoint) {
      const ready = statusFor(recordingId, 'ready', 'director_job_ready', false, {
        ...baseEvidence(),
        recoveredCheckpoint: true,
      }, checkpoint);
      const completion = Promise.resolve(cloneStatus(ready));
      this.jobs.set(recordingId, {
        status: ready,
        completion,
        controller: new AbortController(),
        settled: true,
      });
      return cloneStatus(ready);
    }
    return statusFor(recordingId, 'failed', 'director_job_not_found', true, baseEvidence());
  }

  private start(recordingId: string): DesktopDirectorJobHandle {
    const entry = {
      controller: new AbortController(),
      settled: false,
    } as DirectorJobEntry;
    entry.status = statusFor(
      recordingId,
      'pending',
      'director_job_pending',
      false,
      baseEvidence(),
    );
    entry.completion = Promise.resolve()
      .then(() => this.execute(recordingId, entry))
      .finally(() => { entry.settled = true; });
    this.jobs.set(recordingId, entry);
    return this.handle(entry);
  }

  private handle(entry: DirectorJobEntry): DesktopDirectorJobHandle {
    return { status: cloneStatus(entry.status), completion: entry.completion };
  }

  private async execute(
    recordingId: string,
    entry: DirectorJobEntry,
  ): Promise<DesktopDirectorJobStatus> {
    let evidence = baseEvidence();
    try {
      this.throwIfPreempted(entry);
      this.assertCaptureInactive();
      entry.status = statusFor(
        recordingId,
        'generating',
        'director_job_generating',
        false,
        evidence,
      );
      const projectRoot = resolveDesktopDirectorProjectRoot(this.options.videosDirectory, recordingId);
      const current = await inspectCurrentCheckpoint(projectRoot, recordingId);
      this.throwIfPreempted(entry);
      if (current) {
        evidence = { ...evidence, recoveredCheckpoint: true };
        entry.status = statusFor(
          recordingId,
          'ready',
          'director_job_ready',
          false,
          evidence,
          current,
        );
        return cloneStatus(entry.status);
      }

      const manifest = await this.options.recoverProject(projectRoot);
      this.throwIfPreempted(entry);
      const validation = await this.options.validateProject(projectRoot);
      this.throwIfPreempted(entry);
      if (manifest.recordingId !== recordingId
        || (manifest.state !== 'ready' && manifest.state !== 'interrupted')
        || validation.manifestState !== manifest.state) {
        return this.fail(entry, recordingId, 'director_job_native_identity_invalid', false, evidence);
      }
      evidence = { ...evidence, manifestState: manifest.state };
      if (!validation.isValid || !validation.continuity.isValid) {
        return this.fail(entry, recordingId, 'director_job_native_validation_invalid', false, evidence);
      }
      const duration = deriveNativeDirectorDuration(manifest, validation);
      if (!duration) {
        return this.fail(entry, recordingId, 'director_job_duration_unavailable', false, evidence);
      }
      evidence = {
        ...evidence,
        durationUs: duration.durationUs,
        observedEndUs: duration.observedEndUs,
        durationSource: duration.source,
      };
      entry.status = statusFor(
        recordingId,
        'generating',
        'director_job_generating',
        false,
        evidence,
      );
      this.assertCaptureInactive();
      const result = await this.runPipeline({
        projectRoot,
        sourceRecordingId: recordingId,
        sessionId: recordingId,
        durationUs: duration.durationUs,
        profile: 'Balanced',
        speechActivity: [],
        signal: entry.controller.signal,
      });
      this.throwIfPreempted(entry);
      evidence = {
        ...evidence,
        manifestState: result.evidence.manifestState,
        telemetrySegmentsRead: result.evidence.telemetrySegmentsRead,
        telemetryBytesRead: result.evidence.telemetryBytesRead,
        maximumSegmentBytesRead: result.evidence.maximumSegmentBytesRead,
        eventCount: result.evidence.eventCount,
        retainedPlannerEventCount: result.evidence.retainedPlannerEventCount,
        roiObservationCount: result.evidence.roiObservationCount,
        preservedMedia: result.evidence.preservedMedia,
      };
      if (result.status === 'failed') {
        return this.fail(entry, recordingId, result.code, result.retryable, evidence);
      }
      const checkpoint = { checkpointId: result.checkpoint.checkpointId, index: result.checkpoint };
      entry.status = statusFor(
        recordingId,
        'ready',
        'director_job_ready',
        false,
        evidence,
        checkpoint,
      );
      return cloneStatus(entry.status);
    } catch (error) {
      if (entry.controller.signal.aborted) {
        return this.fail(
          entry,
          recordingId,
          'director_job_preempted_for_capture',
          true,
          evidence,
        );
      }
      const code = error instanceof Error ? error.message : '';
      if (code === 'director_generation_capture_active') {
        return this.fail(entry, recordingId, code, true, evidence);
      }
      return this.fail(entry, recordingId, 'director_job_native_recovery_failed', true, evidence);
    }
  }

  private fail(
    entry: DirectorJobEntry,
    recordingId: string,
    code: string,
    retryable: boolean,
    evidence: DesktopDirectorJobEvidence,
  ): DesktopDirectorJobStatus {
    entry.status = statusFor(recordingId, 'failed', code, retryable, evidence);
    return cloneStatus(entry.status);
  }

  private assertCaptureInactive(): void {
    if (this.options.isCaptureActive()) throw new Error('director_generation_capture_active');
  }

  private throwIfPreempted(entry: DirectorJobEntry): void {
    if (entry.controller.signal.aborted) throw new Error('director_job_preempted_for_capture');
  }
}

export async function stopNativeCaptureAndEnqueueDirector(
  options: StopNativeCaptureWithDirectorOptions,
): Promise<NativeCaptureStopResult> {
  await options.flushInk();
  await options.waitForInkTail();
  await options.waitForInputTail();
  const state = await options.stopCapture();
  options.onCaptureEnded();
  const director = options.enqueueDirector();
  void director.completion.catch(() => undefined);
  return { state, director: cloneStatus(director.status) };
}
