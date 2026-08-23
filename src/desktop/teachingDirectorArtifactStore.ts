import type { AttentionObservation } from './attentionEngine';
import type { SpeechActivityInterval } from './autoCleanupPlanner';
import type { CameraPlannerProfile } from './cameraPlanner';
import {
  buildTeachingDirectorArtifacts,
  type TeachingDirectorArtifactSetV1,
} from './teachingDirectorArtifacts';
import { parseUnifiedEvent, type UnifiedEvent } from './unifiedEventSchema';

export type DirectorArtifactFileName = 'attention.json' | 'camera.json' | 'cleanup.json';
export type DirectorArtifactStatus = 'pending' | 'ready' | 'failed';

export interface DirectorRecordingMetadata {
  sourceRecordingId: string;
  sessionId: string;
  durationUs: number;
  profile: CameraPlannerProfile;
  attentionWindowMs?: number;
}

export interface DirectorArtifactPersistenceInput {
  recording: DirectorRecordingMetadata;
  events: UnifiedEvent[];
  speechActivity: SpeechActivityInterval[];
  roiObservations: AttentionObservation[];
}

export interface DirectorArtifactIndexEntryV1 {
  schemaVersion: 1;
  artifactVersion: string;
  fileName: DirectorArtifactFileName;
  sourceRecordingId: string;
  sessionId: string;
  checksum: {
    algorithm: 'sha256';
    value: string;
  };
  byteLength: number;
  status: DirectorArtifactStatus;
}

export interface DirectorArtifactIndexV1 {
  schemaVersion: 1;
  indexVersion: 'teaching-director-artifact-index-v1';
  owner: 'recording-manifest';
  artifactSetVersion: 'teaching-director-artifacts-v1';
  checkpointId: string;
  sourceRecordingId: string;
  sessionId: string;
  status: DirectorArtifactStatus;
  artifacts: DirectorArtifactIndexEntryV1[];
}

export interface DirectorArtifactFile {
  fileName: DirectorArtifactFileName;
  bytes: Uint8Array;
}

export interface DirectorArtifactCheckpoint {
  checkpointId: string;
  files: DirectorArtifactFile[];
  index: DirectorArtifactIndexV1;
}

/** Implementations must publish all files and the index together or publish nothing. */
export interface DirectorArtifactWriter {
  checkpoint(value: DirectorArtifactCheckpoint): Promise<void>;
}

function cloneIndex(index: DirectorArtifactIndexV1): DirectorArtifactIndexV1 {
  return {
    ...index,
    artifacts: index.artifacts.map((artifact) => ({
      ...artifact,
      checksum: { ...artifact.checksum },
    })),
  };
}

function withStatus(index: DirectorArtifactIndexV1, status: DirectorArtifactStatus): DirectorArtifactIndexV1 {
  return {
    ...cloneIndex(index),
    status,
    artifacts: index.artifacts.map((artifact) => ({ ...artifact, checksum: { ...artifact.checksum }, status })),
  };
}

function bytesForJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('director_artifact_checksum_unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function artifactFiles(artifactSet: TeachingDirectorArtifactSetV1): Array<{
  fileName: DirectorArtifactFileName;
  artifactVersion: string;
  bytes: Uint8Array;
}> {
  return [
    {
      fileName: 'attention.json',
      artifactVersion: artifactSet.artifacts.attention.artifactVersion,
      bytes: bytesForJson(artifactSet.artifacts.attention),
    },
    {
      fileName: 'camera.json',
      artifactVersion: artifactSet.artifacts.camera.artifactVersion,
      bytes: bytesForJson(artifactSet.artifacts.camera),
    },
    {
      fileName: 'cleanup.json',
      artifactVersion: artifactSet.artifacts.cleanup.artifactVersion,
      bytes: bytesForJson(artifactSet.artifacts.cleanup),
    },
  ];
}

async function buildIndex(params: {
  artifactSet: TeachingDirectorArtifactSetV1;
  files: ReturnType<typeof artifactFiles>;
}): Promise<DirectorArtifactIndexV1> {
  const checksums = await Promise.all(params.files.map((file) => sha256(file.bytes)));
  const checkpointSeed = bytesForJson({
    indexVersion: 'teaching-director-artifact-index-v1',
    artifactSetVersion: params.artifactSet.artifactSetVersion,
    sourceRecordingId: params.artifactSet.sourceRecordingId,
    sessionId: params.artifactSet.sessionId,
    files: params.files.map((file, index) => ({ fileName: file.fileName, checksum: checksums[index] })),
  });
  const checkpointId = `director-${await sha256(checkpointSeed)}`;
  return {
    schemaVersion: 1,
    indexVersion: 'teaching-director-artifact-index-v1',
    owner: 'recording-manifest',
    artifactSetVersion: 'teaching-director-artifacts-v1',
    checkpointId,
    sourceRecordingId: params.artifactSet.sourceRecordingId,
    sessionId: params.artifactSet.sessionId,
    status: 'pending',
    artifacts: params.files.map((file, index) => ({
      schemaVersion: 1,
      artifactVersion: file.artifactVersion,
      fileName: file.fileName,
      sourceRecordingId: params.artifactSet.sourceRecordingId,
      sessionId: params.artifactSet.sessionId,
      checksum: { algorithm: 'sha256', value: checksums[index] },
      byteLength: file.bytes.byteLength,
      status: 'pending',
    })),
  };
}

export class DirectorArtifactPersistenceService {
  private current: DirectorArtifactIndexV1 | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly writer: DirectorArtifactWriter) {}

  snapshot(): DirectorArtifactIndexV1 | null {
    return this.current ? cloneIndex(this.current) : null;
  }

  persist(input: DirectorArtifactPersistenceInput): Promise<DirectorArtifactIndexV1> {
    const operation = this.tail.then(() => this.persistNow(input));
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async persistNow(input: DirectorArtifactPersistenceInput): Promise<DirectorArtifactIndexV1> {
    const events = input.events.map((event) => parseUnifiedEvent(event));
    if (events.some((event) => event.sessionId !== input.recording.sessionId)) {
      throw new Error('teaching_director_store_session_mismatch');
    }
    const artifactSet = buildTeachingDirectorArtifacts({
      sourceRecordingId: input.recording.sourceRecordingId,
      sessionId: input.recording.sessionId,
      durationUs: input.recording.durationUs,
      profile: input.recording.profile,
      events,
      speechActivity: input.speechActivity.map((interval) => ({ ...interval })),
      roiObservations: input.roiObservations.map((observation) => ({
        ...observation,
        bbox: { ...observation.bbox },
        features: { ...observation.features },
      })),
      ...(input.recording.attentionWindowMs === undefined
        ? {}
        : { attentionWindowMs: input.recording.attentionWindowMs }),
    });
    const files = artifactFiles(artifactSet);
    const pending = await buildIndex({ artifactSet, files });
    if (this.current?.status === 'ready' && this.current.checkpointId === pending.checkpointId) {
      return cloneIndex(this.current);
    }
    this.current = pending;
    const ready = withStatus(pending, 'ready');
    try {
      await this.writer.checkpoint({
        checkpointId: pending.checkpointId,
        files: files.map((file) => ({ fileName: file.fileName, bytes: new Uint8Array(file.bytes) })),
        index: cloneIndex(ready),
      });
      this.current = ready;
      return cloneIndex(ready);
    } catch (error) {
      this.current = withStatus(pending, 'failed');
      throw error;
    }
  }
}

/** Test/reference writer that models one manifest transaction in memory. */
export class MemoryDirectorArtifactWriter implements DirectorArtifactWriter {
  private files = new Map<DirectorArtifactFileName, Uint8Array>();
  private index: DirectorArtifactIndexV1 | null = null;
  private nextFailure: Error | null = null;
  commitCount = 0;
  checkpointAttempts = 0;

  failNextCheckpoint(error: Error): void {
    this.nextFailure = error;
  }

  async checkpoint(value: DirectorArtifactCheckpoint): Promise<void> {
    this.checkpointAttempts += 1;
    if (this.index?.checkpointId === value.checkpointId) return;
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      throw failure;
    }
    if (value.index.status !== 'ready'
      || value.index.checkpointId !== value.checkpointId
      || value.index.artifacts.some((artifact) => artifact.status !== 'ready')) {
      throw new Error('director_artifact_checkpoint_invalid');
    }
    const prepared = new Map<DirectorArtifactFileName, Uint8Array>();
    for (const file of value.files) {
      const metadata = value.index.artifacts.find((artifact) => artifact.fileName === file.fileName);
      if (!metadata || metadata.byteLength !== file.bytes.byteLength || prepared.has(file.fileName)) {
        throw new Error('director_artifact_checkpoint_invalid');
      }
      prepared.set(file.fileName, new Uint8Array(file.bytes));
    }
    if (prepared.size !== value.index.artifacts.length) {
      throw new Error('director_artifact_checkpoint_invalid');
    }

    // These two assignments are the in-memory equivalent of one manifest rename.
    this.files = prepared;
    this.index = cloneIndex(value.index);
    this.commitCount += 1;
  }

  read(fileName: DirectorArtifactFileName): Uint8Array | null {
    const bytes = this.files.get(fileName);
    return bytes ? new Uint8Array(bytes) : null;
  }

  readIndex(): DirectorArtifactIndexV1 | null {
    return this.index ? cloneIndex(this.index) : null;
  }
}
