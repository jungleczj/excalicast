import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  link,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  adoptCurrentNativeFinalRender,
  persistNativeFinalRenderIntent,
  publishNativeFinalRenderOutput,
  readCurrentNativeFinalRender,
  type NativeFinalRenderIntentV1,
} from '../../apps/desktop/src/nativeFinalRenderManifest';

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

function intent(revision = 1): NativeFinalRenderIntentV1 {
  return {
    schemaVersion: 1,
    recordingId: 'lesson_final_1',
    revision,
    format: 'mp4',
    sourceDurationUs: 12_000_000,
    keepRanges: [
      { startUs: 0, endUs: 4_000_000 },
      { startUs: 5_000_000, endUs: 12_000_000 },
    ],
    output: {
      width: 2560,
      height: 1440,
      framesPerSecond: 30,
      quality: 'high',
    },
    camera: { policy: 'overlay', layout: 'rounded-bottom-right' },
    director: { policy: 'balanced' },
    teaching: { policy: 'preselected-only' },
  };
}

test('persists one immutable canonical request and returns the same observable identity for the same intent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-final-manifest-'));
  try {
    const first = await persistNativeFinalRenderIntent({ projectRoot: root, intent: intent() });
    const second = await persistNativeFinalRenderIntent({
      projectRoot: root,
      intent: JSON.parse(JSON.stringify(intent())) as NativeFinalRenderIntentV1,
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      manifestVersion: 'native-final-render-request-v1',
      owner: 'desktop-main',
      recordingId: 'lesson_final_1',
      revision: 1,
      state: 'requested',
      outputRelativePath: `final/outputs/${first.requestId}.mp4`,
    });
    expect(first.requestId).toMatch(/^final-r1-[a-f0-9]{32}$/);
    expect(first.intentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.requestSha256).toMatch(/^[a-f0-9]{64}$/);

    const requestFiles = await readdir(path.join(root, 'final', 'requests'));
    expect(requestFiles).toEqual([`${first.requestId}.json`]);
    const raw = await readFile(path.join(root, 'final', 'requests', requestFiles[0]), 'utf8');
    expect(raw).not.toMatch(/\n|\r|  /);
    expect(raw.startsWith('{"intent":{"camera":')).toBe(true);
    expect(raw.indexOf('"intentSha256"')).toBeLessThan(raw.indexOf('"manifestVersion"'));
    expect(raw.indexOf('"manifestVersion"')).toBeLessThan(raw.indexOf('"outputRelativePath"'));
    expect(await readCurrentNativeFinalRender({ projectRoot: root, recordingId: 'lesson_final_1' }))
      .toEqual(first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects renderer paths, blobs, unknown keys and semantic limits before creating final storage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-final-invalid-'));
  try {
    await expect(persistNativeFinalRenderIntent({
      projectRoot: root,
      intent: { ...intent(), outputPath: '/tmp/escape.mp4' } as unknown as NativeFinalRenderIntentV1,
    })).rejects.toThrow('native_final_render_intent_unknown_key');
    await expect(persistNativeFinalRenderIntent({
      projectRoot: root,
      intent: { ...intent(), blob: new Blob(['video']) } as unknown as NativeFinalRenderIntentV1,
    })).rejects.toThrow('native_final_render_intent_unknown_key');
    await expect(persistNativeFinalRenderIntent({
      projectRoot: root,
      intent: {
        ...intent(),
        output: { ...intent().output, width: 8_192 },
      },
    })).rejects.toThrow('native_final_render_output_invalid');
    await expect(persistNativeFinalRenderIntent({
      projectRoot: root,
      intent: {
        ...intent(),
        sourceDurationUs: 12 * 60 * 60 * 1_000_000 + 1,
        keepRanges: [{ startUs: 0, endUs: 12 * 60 * 60 * 1_000_000 + 1 }],
      },
    })).rejects.toThrow('native_final_render_duration_limit_exceeded');
    await expect(persistNativeFinalRenderIntent({
      projectRoot: root,
      intent: {
        ...intent(),
        keepRanges: [
          { startUs: 0, endUs: 5_000_000 },
          { startUs: 4_000_000, endUs: 7_000_000 },
        ],
      },
    })).rejects.toThrow('native_final_render_keep_ranges_invalid');

    await expect(readdir(path.join(root, 'final'))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a new revision gets a new identity while a conflicting or stale revision cannot replace current', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-final-revision-'));
  try {
    const first = await persistNativeFinalRenderIntent({ projectRoot: root, intent: intent(1) });
    const sameRevisionChanged = {
      ...intent(1),
      director: { policy: 'dynamic' as const },
    };
    await expect(persistNativeFinalRenderIntent({ projectRoot: root, intent: sameRevisionChanged }))
      .rejects.toThrow('native_final_render_revision_conflict');

    const second = await persistNativeFinalRenderIntent({ projectRoot: root, intent: intent(2) });
    expect(second.requestId).not.toBe(first.requestId);
    expect(second.revision).toBe(2);
    await expect(persistNativeFinalRenderIntent({ projectRoot: root, intent: intent(1) }))
      .rejects.toThrow('native_final_render_revision_stale');
    expect((await readCurrentNativeFinalRender({
      projectRoot: root,
      recordingId: 'lesson_final_1',
    })).requestId).toBe(second.requestId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects symlinked owned directories and never mutates an invalid immutable request', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-final-symlink-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'native-final-outside-'));
  try {
    await symlink(outside, path.join(root, 'final'));
    await expect(persistNativeFinalRenderIntent({ projectRoot: root, intent: intent() }))
      .rejects.toThrow('native_final_render_storage_unverified');
    expect(await readdir(outside)).toEqual([]);

    await rm(path.join(root, 'final'), { force: true });
    const written = await persistNativeFinalRenderIntent({ projectRoot: root, intent: intent() });
    const requestPath = path.join(root, 'final', 'requests', `${written.requestId}.json`);
    await writeFile(requestPath, '{"tampered":true}');
    await expect(persistNativeFinalRenderIntent({ projectRoot: root, intent: intent() }))
      .rejects.toThrow('native_final_render_request_invalid');
    expect(await readFile(requestPath, 'utf8')).toBe('{"tampered":true}');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('publishes and restart-adopts only an output whose actual no-follow file bytes match the ready identity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-final-adopt-'));
  try {
    const request = await persistNativeFinalRenderIntent({ projectRoot: root, intent: intent() });
    const outputPath = path.join(root, request.outputRelativePath);
    const bytes = Buffer.from('playable-mp4-fixture');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);

    const ready = await publishNativeFinalRenderOutput({
      projectRoot: root,
      recordingId: request.recordingId,
      requestId: request.requestId,
      requestSha256: request.requestSha256,
      outputSha256: sha256(bytes),
      outputByteLength: bytes.byteLength,
    });
    expect(ready.state).toBe('ready');
    expect(ready.output).toEqual({
      relativePath: `final/published/${request.requestId}-${sha256(bytes)}.mp4`,
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    });
    await expect(adoptCurrentNativeFinalRender({
      projectRoot: root,
      recordingId: request.recordingId,
    })).resolves.toEqual(ready);

    const ownedOutputPath = path.join(root, ready.output!.relativePath);
    await chmod(ownedOutputPath, 0o600);
    await writeFile(ownedOutputPath, 'tampered-output');
    await expect(adoptCurrentNativeFinalRender({
      projectRoot: root,
      recordingId: request.recordingId,
    })).rejects.toThrow('native_final_render_output_identity_invalid');

    await rm(ownedOutputPath);
    await symlink('/etc/hosts', ownedOutputPath);
    await expect(adoptCurrentNativeFinalRender({
      projectRoot: root,
      recordingId: request.recordingId,
    })).rejects.toThrow('native_final_render_output_unverified');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fails closed before ready when the verified render pathname is swapped', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-final-output-race-'));
  try {
    const request = await persistNativeFinalRenderIntent({ projectRoot: root, intent: intent() });
    const renderPath = path.join(root, request.outputRelativePath);
    const original = Buffer.from('verified-render-output');
    await writeFile(renderPath, original);
    let injected = false;

    await expect(publishNativeFinalRenderOutput({
      projectRoot: root,
      recordingId: request.recordingId,
      requestId: request.requestId,
      requestSha256: request.requestSha256,
      outputSha256: sha256(original),
      outputByteLength: original.byteLength,
      faults: {
        afterSourceVerifiedBeforeOwnership: async () => {
          injected = true;
          await (await import('node:fs/promises')).rename(renderPath, `${renderPath}.verified`);
          await writeFile(renderPath, 'attacker-replacement');
        },
      },
    })).rejects.toThrow('native_final_render_output_unverified');

    expect(injected).toBe(true);
    expect(await readFile(renderPath, 'utf8')).toBe('attacker-replacement');
    await expect(readCurrentNativeFinalRender({
      projectRoot: root,
      recordingId: request.recordingId,
    })).resolves.toMatchObject({ state: 'requested' });
    await expect(stat(path.join(root, 'final', 'published',
      `${request.requestId}-${sha256(original)}.mp4`))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('adopts the helper output inode in O(1) without retaining a second staging file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-final-inode-adoption-'));
  try {
    const request = await persistNativeFinalRenderIntent({ projectRoot: root, intent: intent() });
    const renderPath = path.join(root, request.outputRelativePath);
    const output = Buffer.alloc(4 * 1024 * 1024, 0x5a);
    await writeFile(renderPath, output);
    const sourceStat = await stat(renderPath);

    const ready = await publishNativeFinalRenderOutput({
      projectRoot: root,
      recordingId: request.recordingId,
      requestId: request.requestId,
      requestSha256: request.requestSha256,
      outputSha256: sha256(output),
      outputByteLength: output.byteLength,
    });
    const ownedStat = await stat(path.join(root, ready.output!.relativePath));
    expect(ownedStat.dev).toBe(sourceStat.dev);
    expect(ownedStat.ino).toBe(sourceStat.ino);
    expect(ownedStat.nlink).toBe(1);
    await expect(stat(renderPath)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects request and render output inodes that have external hard links', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-final-hardlink-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'native-final-hardlink-outside-'));
  try {
    const requestProject = path.join(root, 'request-project');
    const request = await persistNativeFinalRenderIntent({ projectRoot: requestProject, intent: intent() });
    const requestPath = path.join(requestProject, 'final', 'requests', `${request.requestId}.json`);
    const requestAlias = path.join(outside, 'request-alias.json');
    await link(requestPath, requestAlias);
    await writeFile(requestAlias, '{"attackerMutation":true}');
    await expect(readCurrentNativeFinalRender({
      projectRoot: requestProject,
      recordingId: request.recordingId,
    })).rejects.toThrow('native_final_render_request_invalid');

    const outputProject = path.join(root, 'output-project');
    const outputRequest = await persistNativeFinalRenderIntent({ projectRoot: outputProject, intent: intent() });
    const renderPath = path.join(outputProject, outputRequest.outputRelativePath);
    const output = Buffer.from('hard-linked-output');
    await writeFile(renderPath, output);
    const outputAlias = path.join(outside, 'output-alias.mp4');
    await link(renderPath, outputAlias);
    await writeFile(outputAlias, 'attacker-output-mutation');
    await expect(publishNativeFinalRenderOutput({
      projectRoot: outputProject,
      recordingId: outputRequest.recordingId,
      requestId: outputRequest.requestId,
      requestSha256: outputRequest.requestSha256,
      outputSha256: sha256(output),
      outputByteLength: output.byteLength,
    })).rejects.toThrow('native_final_render_output_unverified');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('does not publish ready before the owned output file and parent directory durability barrier', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-final-durability-'));
  try {
    const request = await persistNativeFinalRenderIntent({ projectRoot: root, intent: intent() });
    const output = Buffer.from('durable-output');
    await writeFile(path.join(root, request.outputRelativePath), output);
    await expect(publishNativeFinalRenderOutput({
      projectRoot: root,
      recordingId: request.recordingId,
      requestId: request.requestId,
      requestSha256: request.requestSha256,
      outputSha256: sha256(output),
      outputByteLength: output.byteLength,
      faults: {
        afterOwnedOutputDurabilityBarrier: () => { throw new Error('simulated_power_loss_before_ready'); },
      },
    })).rejects.toThrow('simulated_power_loss_before_ready');
    expect((await readCurrentNativeFinalRender({
      projectRoot: root,
      recordingId: request.recordingId,
    })).state).toBe('requested');

    await expect(publishNativeFinalRenderOutput({
      projectRoot: root,
      recordingId: request.recordingId,
      requestId: request.requestId,
      requestSha256: request.requestSha256,
      outputSha256: sha256(output),
      outputByteLength: output.byteLength,
    })).resolves.toMatchObject({ state: 'ready' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restart recovers each legal request double-link crash boundary without accepting an external hardlink', async () => {
  const boundaries = [
    'afterRequestLinkBeforeDirectorySync',
    'afterRequestDirectorySyncBeforeTemporaryUnlink',
    'afterRequestTemporaryUnlinkBeforeDirectorySync',
  ] as const;
  for (const boundary of boundaries) {
    const root = await mkdtemp(path.join(tmpdir(), `native-final-request-${boundary}-`));
    try {
      await expect(persistNativeFinalRenderIntent({
        projectRoot: root,
        intent: intent(),
        faults: {
          [boundary]: () => { throw new Error(`request_crash:${boundary}`); },
        },
      })).rejects.toThrow(`request_crash:${boundary}`);
      await expect(readCurrentNativeFinalRender({
        projectRoot: root,
        recordingId: intent().recordingId,
      })).rejects.toThrow('native_final_render_pointer_missing');

      const recovered = await persistNativeFinalRenderIntent({ projectRoot: root, intent: intent() });
      const requestFiles = await readdir(path.join(root, 'final', 'requests'));
      expect(requestFiles).toEqual([`${recovered.requestId}.json`]);
      expect((await stat(path.join(root, 'final', 'requests', requestFiles[0]))).nlink).toBe(1);
      expect(recovered.state).toBe('requested');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('restart safely completes every output link, directory sync, and source unlink crash boundary', async () => {
  const boundaries = [
    'afterPublishedEntryLinkedBeforeDirectorySync',
    'afterPublishedDirectorySyncBeforeSourceUnlink',
    'afterSourceUnlinkBeforeOutputsDirectorySync',
  ] as const;
  for (const boundary of boundaries) {
    const root = await mkdtemp(path.join(tmpdir(), `native-final-output-${boundary}-`));
    try {
      const request = await persistNativeFinalRenderIntent({ projectRoot: root, intent: intent() });
      const output = Buffer.from(`output:${boundary}`);
      const sourcePath = path.join(root, request.outputRelativePath);
      await writeFile(sourcePath, output);
      await expect(publishNativeFinalRenderOutput({
        projectRoot: root,
        recordingId: request.recordingId,
        requestId: request.requestId,
        requestSha256: request.requestSha256,
        outputSha256: sha256(output),
        outputByteLength: output.byteLength,
        faults: {
          [boundary]: () => { throw new Error(`output_crash:${boundary}`); },
        },
      })).rejects.toThrow(`output_crash:${boundary}`);
      expect((await readCurrentNativeFinalRender({
        projectRoot: root,
        recordingId: request.recordingId,
      })).state).toBe('requested');

      const ready = await publishNativeFinalRenderOutput({
        projectRoot: root,
        recordingId: request.recordingId,
        requestId: request.requestId,
        requestSha256: request.requestSha256,
        outputSha256: sha256(output),
        outputByteLength: output.byteLength,
      });
      const publishedPath = path.join(root, ready.output!.relativePath);
      expect((await stat(publishedPath)).nlink).toBe(1);
      await expect(stat(sourcePath)).rejects.toThrow();
      await expect(adoptCurrentNativeFinalRender({
        projectRoot: root,
        recordingId: request.recordingId,
      })).resolves.toEqual(ready);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
