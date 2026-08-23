import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  NodeDirectorArtifactWriter,
  type DirectorArtifactWriterFaults,
} from '../../apps/desktop/src/directorArtifactWriter';
import type {
  DirectorArtifactCheckpoint,
  DirectorArtifactFileName,
  DirectorArtifactIndexV1,
} from '@/desktop/teachingDirectorArtifactStore';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function checkpoint(seed: string, checkpointId = `director-${createHash('sha256').update(seed).digest('hex')}`): DirectorArtifactCheckpoint {
  const sourceRecordingId = 'recording_writer_1';
  const sessionId = 'session_writer_1';
  const files = (['attention.json', 'camera.json', 'cleanup.json'] as const).map((fileName) => ({
    fileName,
    bytes: new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, fileName, seed })),
  }));
  const index: DirectorArtifactIndexV1 = {
    schemaVersion: 1,
    indexVersion: 'teaching-director-artifact-index-v1',
    owner: 'recording-manifest',
    artifactSetVersion: 'teaching-director-artifacts-v1',
    checkpointId,
    sourceRecordingId,
    sessionId,
    status: 'ready',
    artifacts: files.map((file) => ({
      schemaVersion: 1,
      artifactVersion: `${file.fileName.split('.')[0]}-artifact-v1`,
      fileName: file.fileName,
      sourceRecordingId,
      sessionId,
      checksum: { algorithm: 'sha256', value: sha256(file.bytes) },
      byteLength: file.bytes.byteLength,
      status: 'ready',
    })),
  };
  return { checkpointId, files, index };
}

async function createWriter(root: string, faults?: DirectorArtifactWriterFaults, maxTotalBytes?: number) {
  return new NodeDirectorArtifactWriter({
    projectRoot: root,
    sourceRecordingId: 'recording_writer_1',
    sessionId: 'session_writer_1',
    faults,
    maxTotalBytes,
  });
}

test('writes a complete fsynced checkpoint before atomically publishing current.json', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'director-writer-'));
  try {
    const value = checkpoint('first');
    await (await createWriter(root)).checkpoint(value);

    const checkpointRoot = path.join(root, 'director', 'checkpoints', value.checkpointId);
    const pointer = JSON.parse(await readFile(path.join(root, 'director', 'current.json'), 'utf8'));
    expect(pointer).toMatchObject({
      schemaVersion: 1,
      pointerVersion: 'teaching-director-current-v1',
      checkpointId: value.checkpointId,
      relativePath: `checkpoints/${value.checkpointId}`,
      index: value.index,
    });
    for (const file of value.files) {
      expect(new Uint8Array(await readFile(path.join(checkpointRoot, file.fileName)))).toEqual(file.bytes);
    }
    expect(JSON.parse(await readFile(path.join(checkpointRoot, 'index.json'), 'utf8'))).toEqual(value.index);
    await expect(stat(path.join(root, 'director', '.staging', value.checkpointId))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failure before pointer publication preserves the previous ready checkpoint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'director-writer-fault-'));
  try {
    const first = checkpoint('first');
    await (await createWriter(root)).checkpoint(first);
    const currentPath = path.join(root, 'director', 'current.json');
    const previousCurrent = await readFile(currentPath);
    const second = checkpoint('second');
    const faults: DirectorArtifactWriterFaults = {
      beforePublishCurrent: () => { throw new Error('simulated_crash_before_pointer'); },
    };

    await expect((await createWriter(root, faults)).checkpoint(second)).rejects.toThrow('simulated_crash_before_pointer');
    expect(await readFile(currentPath)).toEqual(previousCurrent);
    await expect(stat(path.join(root, 'director', 'checkpoints', second.checkpointId))).resolves.toBeTruthy();

    await (await createWriter(root)).checkpoint(second);
    const current = JSON.parse(await readFile(currentPath, 'utf8'));
    expect(current.checkpointId).toBe(second.checkpointId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('same checkpoint is idempotent only after validating existing bytes and checksums', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'director-writer-idempotent-'));
  try {
    const value = checkpoint('same');
    await (await createWriter(root)).checkpoint(value);
    const shouldNotPublish: DirectorArtifactWriterFaults = {
      beforePublishCurrent: () => { throw new Error('idempotent_republished'); },
    };
    await expect((await createWriter(root, shouldNotPublish)).checkpoint(value)).resolves.toBeUndefined();

    const artifactPath = path.join(root, 'director', 'checkpoints', value.checkpointId, 'camera.json');
    await writeFile(artifactPath, 'tampered');
    await expect((await createWriter(root)).checkpoint(value)).rejects.toThrow('director_artifact_existing_checkpoint_invalid');
    expect(await readFile(artifactPath, 'utf8')).toBe('tampered');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects invalid identity, filenames, hashes, byte lengths, and total size before writing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'director-writer-invalid-'));
  try {
    const writer = await createWriter(root);
    const crossSession = checkpoint('cross');
    crossSession.index.sessionId = 'another_session';
    await expect(writer.checkpoint(crossSession)).rejects.toThrow('director_artifact_identity_mismatch');

    const escaped = checkpoint('escaped');
    escaped.files[0].fileName = '../attention.json' as DirectorArtifactFileName;
    await expect(writer.checkpoint(escaped)).rejects.toThrow('director_artifact_filename_invalid');

    const badHash = checkpoint('bad-hash');
    badHash.index.artifacts[0].checksum.value = '0'.repeat(64);
    await expect(writer.checkpoint(badHash)).rejects.toThrow('director_artifact_checksum_invalid');

    const badLength = checkpoint('bad-length');
    badLength.index.artifacts[0].byteLength += 1;
    await expect(writer.checkpoint(badLength)).rejects.toThrow('director_artifact_byte_length_invalid');

    const tinyWriter = await createWriter(root, undefined, 10);
    await expect(tinyWriter.checkpoint(checkpoint('oversized'))).rejects.toThrow('director_artifact_total_size_exceeded');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a director symlink instead of escaping the trusted project root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'director-writer-root-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'director-writer-outside-'));
  try {
    await mkdir(root, { recursive: true });
    await symlink(outside, path.join(root, 'director'));
    await expect((await createWriter(root)).checkpoint(checkpoint('symlink'))).rejects.toThrow('director_artifact_path_invalid');
    await expect(stat(path.join(outside, 'current.json'))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
