import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, truncate, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DesktopNativeCaptureStopCoordinator,
  DesktopDirectorJobService,
  deriveNativeDirectorDuration,
  parseDesktopDirectorJobPayload,
  resolveDesktopDirectorProjectRoot,
  stopNativeCaptureAndEnqueueDirector,
  type DesktopDirectorPipelineRunner,
} from '../../apps/desktop/src/directorJobService';
import {
  runNativeDirectorArtifactPipeline,
  type NativeDirectorPipelineResult,
} from '../../apps/desktop/src/nativeDirectorPipeline';
import type {
  NativeRecordingManifest,
  NativeRecordingValidationReport,
} from '../../apps/desktop/src/nativeHelperClient';

function manifest(
  recordingId: string,
  state: NativeRecordingManifest['state'] = 'ready',
): NativeRecordingManifest {
  return {
    schemaVersion: 1,
    recordingId,
    state,
    tracks: {
      screen: [{
        index: 0,
        relativePath: 'segments/screen/000000.mp4',
        startUs: 0,
        durationUs: 4_100_001,
        byteLength: 4_096,
      }],
      camera: [],
      microphone: [],
      'system-audio': [],
      'excalidraw-events': [],
      'input-telemetry': [],
    },
  };
}

function validation(
  state: NativeRecordingManifest['state'] = 'ready',
  isValid = true,
): NativeRecordingValidationReport {
  return {
    isValid,
    manifestState: state,
    continuity: {
      isValid,
      requiredTracks: ['screen'],
      tracks: {
        screen: {
          track: 'screen',
          segmentCount: 1,
          firstStartUs: 0,
          endUs: 4_100_001,
          maximumGapUs: 0,
          maximumOverlapUs: 0,
          issues: [],
        },
      },
    },
    segments: [],
  };
}

function readyResult(recordingId: string): NativeDirectorPipelineResult {
  const checkpointId = `director-${'a'.repeat(64)}`;
  return {
    status: 'ready',
    retryable: false,
    checkpoint: {
      schemaVersion: 1,
      indexVersion: 'teaching-director-artifact-index-v1',
      owner: 'recording-manifest',
      artifactSetVersion: 'teaching-director-artifacts-v1',
      checkpointId,
      sourceRecordingId: recordingId,
      sessionId: recordingId,
      status: 'ready',
      artifacts: [],
    },
    evidence: {
      sourceRecordingId: recordingId,
      sessionId: recordingId,
      manifestState: 'ready',
      telemetrySegmentsRead: 0,
      telemetryBytesRead: 0,
      maximumSegmentBytesRead: 0,
      eventCount: 0,
      retainedPlannerEventCount: 0,
      roiObservationCount: 0,
      preservedMedia: true,
    },
  };
}

async function writeCurrentCheckpoint(params: {
  videosDirectory: string;
  recordingId: string;
  checkpointSeed: string;
}): Promise<{ checkpointId: string; projectRoot: string; artifactPaths: string[] }> {
  const checkpointId = `director-${params.checkpointSeed.repeat(64)}`;
  const projectRoot = resolveDesktopDirectorProjectRoot(params.videosDirectory, params.recordingId);
  const checkpointRoot = path.join(projectRoot, 'director', 'checkpoints', checkpointId);
  await mkdir(checkpointRoot, { recursive: true });
  const files = ['attention.json', 'camera.json', 'cleanup.json'].map((fileName, index) => ({
    fileName,
    bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, fileName, value: index })),
  }));
  const index = {
    schemaVersion: 1 as const,
    indexVersion: 'teaching-director-artifact-index-v1' as const,
    owner: 'recording-manifest' as const,
    artifactSetVersion: 'teaching-director-artifacts-v1' as const,
    checkpointId,
    sourceRecordingId: params.recordingId,
    sessionId: params.recordingId,
    status: 'ready' as const,
    artifacts: files.map((file) => ({
      schemaVersion: 1 as const,
      artifactVersion: 'fixture-v1',
      fileName: file.fileName,
      sourceRecordingId: params.recordingId,
      sessionId: params.recordingId,
      checksum: {
        algorithm: 'sha256' as const,
        value: createHash('sha256').update(file.bytes).digest('hex'),
      },
      byteLength: file.bytes.byteLength,
      status: 'ready' as const,
    })),
  };
  for (const file of files) await writeFile(path.join(checkpointRoot, file.fileName), file.bytes);
  await writeFile(path.join(checkpointRoot, 'index.json'), JSON.stringify(index));
  await writeFile(path.join(projectRoot, 'director', 'current.json'), JSON.stringify({
    schemaVersion: 1,
    pointerVersion: 'teaching-director-current-v1',
    checkpointId,
    relativePath: `checkpoints/${checkpointId}`,
    index,
  }));
  return {
    checkpointId,
    projectRoot,
    artifactPaths: files.map((file) => path.join(checkpointRoot, file.fileName)),
  };
}

function service(params: {
  videosDirectory: string;
  runPipeline: DesktopDirectorPipelineRunner;
  active?: () => boolean;
  recoverProject?: (projectRoot: string) => Promise<NativeRecordingManifest>;
  validateProject?: (projectRoot: string) => Promise<NativeRecordingValidationReport>;
}): DesktopDirectorJobService {
  return new DesktopDirectorJobService({
    videosDirectory: params.videosDirectory,
    isCaptureActive: params.active ?? (() => false),
    recoverProject: params.recoverProject ?? (async (projectRoot) => manifest(path.basename(projectRoot))),
    validateProject: params.validateProject ?? (async () => validation()),
    runPipeline: params.runPipeline,
  });
}

test('renderer Director requests accept only a validated recording id and main owns the project root', () => {
  expect(parseDesktopDirectorJobPayload({ recordingId: 'lesson_2026-08' })).toEqual({
    recordingId: 'lesson_2026-08',
  });
  expect(resolveDesktopDirectorProjectRoot('/Users/teacher/Videos', 'lesson_2026-08')).toBe(
    path.join('/Users/teacher/Videos', 'Excalicast Projects', 'lesson_2026-08'),
  );

  for (const payload of [
    { recordingId: '../lesson' },
    { recordingId: 'lesson', projectRoot: '/tmp/injected' },
    { recordingId: 'lesson', manifestPath: '/tmp/manifest.json' },
    { recordingId: 'lesson', artifact: { bytes: 'spoofed' } },
    { recordingId: 'lesson', event: { atUs: 1 } },
    { recordingId: 'lesson', checkpointId: `director-${'b'.repeat(64)}` },
  ]) {
    expect(() => parseDesktopDirectorJobPayload(payload)).toThrow('director_job_request_invalid');
  }
});

test('enqueue returns pending before a blocked Director pipeline completes and exposes conservative evidence', async () => {
  const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'director-jobs-'));
  let startPipeline!: () => void;
  let releasePipeline!: (result: NativeDirectorPipelineResult) => void;
  const pipelineStarted = new Promise<void>((resolve) => { startPipeline = resolve; });
  const blocked = new Promise<NativeDirectorPipelineResult>((resolve) => { releasePipeline = resolve; });
  const jobs = service({
    videosDirectory,
    runPipeline: async (request) => {
      expect(request).toMatchObject({
        projectRoot: path.join(videosDirectory, 'Excalicast Projects', 'lesson-blocked'),
        sourceRecordingId: 'lesson-blocked',
        sessionId: 'lesson-blocked',
        durationUs: 4_101_000,
        profile: 'Balanced',
        speechActivity: [],
      });
      startPipeline();
      return blocked;
    },
  });

  const enqueued = jobs.enqueue('lesson-blocked');
  expect(enqueued.status).toMatchObject({
    recordingId: 'lesson-blocked',
    status: 'pending',
    code: 'director_job_pending',
    retryable: false,
    evidence: {
      profile: 'Balanced',
      speechActivity: 'unavailable',
      speechIntervalCount: 0,
      preservedMedia: true,
    },
  });
  await pipelineStarted;
  expect(jobs.snapshot('lesson-blocked')).toMatchObject({
    status: 'generating',
    code: 'director_job_generating',
    evidence: {
      durationUs: 4_101_000,
      durationSource: 'native-manifest-segments',
    },
  });

  releasePipeline(readyResult('lesson-blocked'));
  await expect(enqueued.completion).resolves.toMatchObject({
    status: 'ready',
    code: 'director_job_ready',
    retryable: false,
    checkpoint: {
      owner: 'recording-manifest',
      reference: 'director/current.json',
      checkpointId: `director-${'a'.repeat(64)}`,
    },
  });
});

test('duplicate enqueue and duplicate retry share one in-flight promise per recording', async () => {
  const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'director-jobs-'));
  let calls = 0;
  let releaseFirst!: (result: NativeDirectorPipelineResult) => void;
  let releaseSecond!: (result: NativeDirectorPipelineResult) => void;
  const firstRun = new Promise<NativeDirectorPipelineResult>((resolve) => { releaseFirst = resolve; });
  const secondRun = new Promise<NativeDirectorPipelineResult>((resolve) => { releaseSecond = resolve; });
  const jobs = service({
    videosDirectory,
    runPipeline: async () => (++calls === 1 ? firstRun : secondRun),
  });

  const first = jobs.enqueue('lesson-retry');
  const duplicate = jobs.enqueue('lesson-retry');
  expect(duplicate.completion).toBe(first.completion);
  expect(calls).toBe(0);
  releaseFirst({
    status: 'failed',
    retryable: true,
    code: 'director_native_artifact_write_failed',
    evidence: readyResult('lesson-retry').evidence,
  });
  await expect(first.completion).resolves.toMatchObject({
    status: 'failed',
    code: 'director_native_artifact_write_failed',
    retryable: true,
  });
  expect(calls).toBe(1);
  expect(jobs.enqueue('lesson-retry').completion).toBe(first.completion);

  const retry = jobs.retry('lesson-retry');
  const duplicateRetry = jobs.retry('lesson-retry');
  expect(duplicateRetry.completion).toBe(retry.completion);
  releaseSecond(readyResult('lesson-retry'));
  await expect(retry.completion).resolves.toMatchObject({ status: 'ready' });
  expect(calls).toBe(2);
});

test('active capture rejects generation before recovery or pipeline work starts', async () => {
  const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'director-jobs-'));
  let recoveryCalls = 0;
  let pipelineCalls = 0;
  const jobs = service({
    videosDirectory,
    active: () => true,
    recoverProject: async () => { recoveryCalls += 1; return manifest('lesson-active'); },
    runPipeline: async () => { pipelineCalls += 1; return readyResult('lesson-active'); },
  });

  expect(() => jobs.enqueue('lesson-active')).toThrow('director_generation_capture_active');
  expect(() => jobs.retry('lesson-active')).toThrow('director_generation_capture_active');
  await Promise.resolve();
  expect(recoveryCalls).toBe(0);
  expect(pipelineCalls).toBe(0);
});

test('recovery adopts a valid manifest-owned current checkpoint without regenerating', async () => {
  const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'director-jobs-'));
  const recordingId = 'lesson-recovered';
  const { checkpointId } = await writeCurrentCheckpoint({
    videosDirectory,
    recordingId,
    checkpointSeed: 'c',
  });
  let pipelineCalls = 0;
  const jobs = service({
    videosDirectory,
    runPipeline: async () => { pipelineCalls += 1; return readyResult(recordingId); },
  });

  const recovered = jobs.enqueue(recordingId);
  await expect(recovered.completion).resolves.toMatchObject({
    status: 'ready',
    checkpoint: { checkpointId, reference: 'director/current.json' },
    evidence: { recoveredCheckpoint: true, preservedMedia: true },
  });
  expect(pipelineCalls).toBe(0);
});

test('recovery rejects a checkpoint with missing bytes or a checksum mismatch and regenerates', async () => {
  for (const corruption of ['missing-artifact', 'checksum-mismatch'] as const) {
    const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'director-jobs-'));
    const recordingId = `lesson-${corruption}`;
    const checkpoint = await writeCurrentCheckpoint({
      videosDirectory,
      recordingId,
      checkpointSeed: corruption === 'missing-artifact' ? 'd' : 'e',
    });
    if (corruption === 'missing-artifact') await unlink(checkpoint.artifactPaths[0]);
    else await writeFile(checkpoint.artifactPaths[0], 'tampered-attention');
    let pipelineCalls = 0;
    const jobs = service({
      videosDirectory,
      runPipeline: async () => { pipelineCalls += 1; return readyResult(recordingId); },
    });

    await expect(jobs.enqueue(recordingId).completion).resolves.toMatchObject({ status: 'ready' });
    expect(pipelineCalls, corruption).toBe(1);
  }
});

test('recovery rejects oversized artifact metadata before adopting the checkpoint', async () => {
  const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'director-jobs-'));
  const recordingId = 'lesson-oversized-checkpoint';
  const checkpoint = await writeCurrentCheckpoint({
    videosDirectory,
    recordingId,
    checkpointSeed: 'f',
  });
  const currentPath = path.join(checkpoint.projectRoot, 'director', 'current.json');
  const current = JSON.parse(await readFile(currentPath, 'utf8')) as {
    index: { artifacts: Array<{ byteLength: number }> };
  };
  const oversizedBytes = 16 * 1024 * 1024 + 1;
  current.index.artifacts[0].byteLength = oversizedBytes;
  const indexPath = path.join(
    checkpoint.projectRoot,
    'director',
    'checkpoints',
    `director-${'f'.repeat(64)}`,
    'index.json',
  );
  await writeFile(currentPath, JSON.stringify(current));
  await writeFile(indexPath, JSON.stringify(current.index));
  await truncate(checkpoint.artifactPaths[0], oversizedBytes);
  let pipelineCalls = 0;
  const jobs = service({
    videosDirectory,
    runPipeline: async () => { pipelineCalls += 1; return readyResult(recordingId); },
  });

  await expect(jobs.enqueue(recordingId).completion).resolves.toMatchObject({ status: 'ready' });
  expect(pipelineCalls).toBe(1);
});

test('recovery rejects oversized current and index JSON before adopting a checkpoint', async () => {
  for (const metadataFile of ['current', 'index'] as const) {
    const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'director-jobs-'));
    const recordingId = `lesson-oversized-${metadataFile}`;
    const seed = metadataFile === 'current' ? '1' : '2';
    const checkpoint = await writeCurrentCheckpoint({
      videosDirectory,
      recordingId,
      checkpointSeed: seed,
    });
    const metadataPath = metadataFile === 'current'
      ? path.join(checkpoint.projectRoot, 'director', 'current.json')
      : path.join(
          checkpoint.projectRoot,
          'director',
          'checkpoints',
          `director-${seed.repeat(64)}`,
          'index.json',
        );
    const existing = await readFile(metadataPath, 'utf8');
    await writeFile(metadataPath, `${existing}${' '.repeat(300 * 1024)}`);
    let pipelineCalls = 0;
    const jobs = service({
      videosDirectory,
      runPipeline: async () => { pipelineCalls += 1; return readyResult(recordingId); },
    });

    await expect(jobs.enqueue(recordingId).completion).resolves.toMatchObject({ status: 'ready' });
    expect(pipelineCalls, metadataFile).toBe(1);
  }
});

test('capture and Director race guards prevent either operation from entering while the other is starting or generating', async () => {
  const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'director-jobs-'));
  let active = false;
  let pipelineCalls = 0;
  let pipelineStarted!: () => void;
  let releasePipeline!: (result: NativeDirectorPipelineResult) => void;
  const started = new Promise<void>((resolve) => { pipelineStarted = resolve; });
  const blocked = new Promise<NativeDirectorPipelineResult>((resolve) => { releasePipeline = resolve; });
  const jobs = service({
    videosDirectory,
    active: () => active,
    runPipeline: async () => {
      pipelineCalls += 1;
      pipelineStarted();
      return blocked;
    },
  });

  const generation = jobs.enqueue('lesson-race');
  await started;
  expect(() => jobs.assertCaptureMayStart()).toThrow('native_capture_director_generation_active');
  releasePipeline(readyResult('lesson-race'));
  await generation.completion;
  expect(() => jobs.assertCaptureMayStart()).not.toThrow();

  const second = jobs.enqueue('lesson-active-race');
  active = true;
  await expect(second.completion).resolves.toMatchObject({
    status: 'failed',
    code: 'director_generation_capture_active',
    retryable: true,
  });
  expect(pipelineCalls).toBe(1);
});

test('capture priority aborts and drains a cooperative blocked Director job', async () => {
  const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'director-jobs-'));
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let observedSignal: AbortSignal | undefined;
  const jobs = service({
    videosDirectory,
    runPipeline: async (request) => {
      observedSignal = request.signal;
      markStarted();
      return new Promise<NativeDirectorPipelineResult>((resolve) => {
        request.signal?.addEventListener('abort', () => resolve({
          status: 'failed',
          retryable: true,
          code: 'director_native_cancelled',
          evidence: readyResult('lesson-preempt').evidence,
        }), { once: true });
      });
    },
  });

  const generation = jobs.enqueue('lesson-preempt');
  await started;
  await jobs.prepareForCapture(100);
  expect(observedSignal?.aborted).toBe(true);
  await expect(generation.completion).resolves.toMatchObject({
    status: 'failed',
    code: 'director_job_preempted_for_capture',
    retryable: true,
  });
  expect(() => jobs.assertCaptureMayStart()).not.toThrow();
});

test('capture priority times out while an uncooperative Director runner still owns resources', async () => {
  const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'director-jobs-'));
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let release!: (result: NativeDirectorPipelineResult) => void;
  const blocked = new Promise<NativeDirectorPipelineResult>((resolve) => { release = resolve; });
  let observedSignal: AbortSignal | undefined;
  const jobs = service({
    videosDirectory,
    runPipeline: async (request) => {
      observedSignal = request.signal;
      markStarted();
      return blocked;
    },
  });

  const generation = jobs.enqueue('lesson-preempt-timeout');
  await started;
  await expect(jobs.prepareForCapture(5)).rejects.toThrow('native_capture_director_did_not_drain');
  expect(observedSignal?.aborted).toBe(true);
  expect(jobs.snapshot('lesson-preempt-timeout')).toMatchObject({
    status: 'failed',
    code: 'director_job_preempted_for_capture',
    retryable: true,
  });
  expect(() => jobs.assertCaptureMayStart()).toThrow('native_capture_director_generation_active');
  expect(jobs.retry('lesson-preempt-timeout').completion).toBe(generation.completion);

  release(readyResult('lesson-preempt-timeout'));
  await expect(generation.completion).resolves.toMatchObject({
    status: 'failed',
    code: 'director_job_preempted_for_capture',
  });
  expect(() => jobs.assertCaptureMayStart()).not.toThrow();
});

test('native pipeline cancellation before current publication never publishes ready', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'director-cancel-'));
  const recordingId = 'lesson-pipeline-cancel';
  await writeFile(path.join(projectRoot, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    recordingId,
    state: 'ready',
    tracks: {
      screen: [], camera: [], microphone: [], 'system-audio': [],
      'excalidraw-events': [], 'input-telemetry': [],
    },
  }));
  const controller = new AbortController();
  const result = await runNativeDirectorArtifactPipeline({
    projectRoot,
    sourceRecordingId: recordingId,
    sessionId: recordingId,
    durationUs: 1_000_000,
    profile: 'Balanced',
    speechActivity: [],
    signal: controller.signal,
    writerFaults: {
      beforePublishCurrent() { controller.abort(); },
    },
  });

  expect(result).toMatchObject({
    status: 'failed',
    code: 'director_native_cancelled',
    retryable: true,
  });
  await expect(readFile(path.join(projectRoot, 'director', 'current.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('native stop drains both telemetry tails and helper stop before enqueue, then returns without awaiting Director', async () => {
  const order: string[] = [];
  let releaseDirector!: () => void;
  let directorSettled = false;
  const completion = new Promise<void>((resolve) => { releaseDirector = resolve; })
    .then(() => { directorSettled = true; });
  const pendingStatus = {
    recordingId: 'lesson-stop',
    status: 'pending' as const,
    code: 'director_job_pending',
    retryable: false,
    evidence: {
      profile: 'Balanced' as const,
      speechActivity: 'unavailable' as const,
      speechIntervalCount: 0 as const,
      preservedMedia: true as const,
      recoveredCheckpoint: false,
    },
  };

  const stopped = await stopNativeCaptureAndEnqueueDirector({
    flushInk: async () => { order.push('ink-flush'); },
    waitForInkTail: async () => { order.push('ink-tail'); },
    waitForInputTail: async () => { order.push('input-tail'); },
    stopCapture: async () => { order.push('helper-stop'); return 'idle'; },
    onCaptureEnded: () => { order.push('capture-ended'); },
    enqueueDirector: () => {
      order.push('director-enqueue');
      return { status: pendingStatus, completion: completion.then(() => pendingStatus) };
    },
  });

  expect(order).toEqual([
    'ink-flush', 'ink-tail', 'input-tail', 'helper-stop', 'capture-ended', 'director-enqueue',
  ]);
  expect(stopped).toEqual({ state: 'idle', director: pendingStatus });
  expect(directorSettled).toBe(false);
  releaseDirector();
  await completion;
});

test('failed helper stop leaves capture active for retry and never enqueues Director', async () => {
  let captureEnded = false;
  let enqueueCalls = 0;
  await expect(stopNativeCaptureAndEnqueueDirector({
    flushInk: async () => undefined,
    waitForInkTail: async () => undefined,
    waitForInputTail: async () => undefined,
    stopCapture: async () => { throw new Error('native_stop_io_failed'); },
    onCaptureEnded: () => { captureEnded = true; },
    enqueueDirector: () => {
      enqueueCalls += 1;
      throw new Error('must_not_enqueue');
    },
  })).rejects.toThrow('native_stop_io_failed');
  expect(captureEnded).toBe(false);
  expect(enqueueCalls).toBe(0);
});

test('concurrent duplicate native stops share one helper stop and one Director enqueue', async () => {
  const coordinator = new DesktopNativeCaptureStopCoordinator();
  let tasksStarted = 0;
  let helperStops = 0;
  let enqueueCalls = 0;
  let releaseHelperStop!: () => void;
  const helperStopped = new Promise<void>((resolve) => { releaseHelperStop = resolve; });
  const pendingStatus = {
    recordingId: 'lesson-duplicate-stop',
    status: 'pending' as const,
    code: 'director_job_pending',
    retryable: false,
    evidence: {
      profile: 'Balanced' as const,
      speechActivity: 'unavailable' as const,
      speechIntervalCount: 0 as const,
      preservedMedia: true as const,
      recoveredCheckpoint: false,
    },
  };
  const stop = () => {
    tasksStarted += 1;
    return stopNativeCaptureAndEnqueueDirector({
      flushInk: async () => undefined,
      waitForInkTail: async () => undefined,
      waitForInputTail: async () => undefined,
      stopCapture: async () => {
        helperStops += 1;
        await helperStopped;
        return 'idle';
      },
      onCaptureEnded: () => undefined,
      enqueueDirector: () => {
        enqueueCalls += 1;
        return { status: pendingStatus, completion: Promise.resolve(pendingStatus) };
      },
    });
  };

  const first = coordinator.run(stop);
  const duplicate = coordinator.run(stop);
  expect(duplicate).toBe(first);
  expect(tasksStarted).toBe(1);
  releaseHelperStop();
  await expect(first).resolves.toEqual({ state: 'idle', director: pendingStatus });
  expect(helperStops).toBe(1);
  expect(enqueueCalls).toBe(1);
});

test('desktop main wires Director only after stop tails and protects the capture-start race', async () => {
  const source = await readFile(path.join(process.cwd(), 'apps/desktop/src/main.ts'), 'utf8');
  const start = source.slice(
    source.indexOf('DESKTOP_IPC_CHANNELS.captureStart'),
    source.indexOf('DESKTOP_IPC_CHANNELS.captureStop'),
  );
  expect(start.indexOf('directorJobs.assertCaptureMayStart()')).toBeLessThan(start.indexOf('helper.startCapture(request)'));
  expect(start.indexOf('await directorJobs.prepareForCapture')).toBeLessThan(start.indexOf('helper.startCapture(request)'));
  expect(start.indexOf('nativeCaptureStarting = true')).toBeLessThan(start.indexOf('helper.startCapture(request)'));
  expect(start).toContain('nativeCaptureStarting = false');

  const stop = source.slice(
    source.indexOf('DESKTOP_IPC_CHANNELS.captureStop'),
    source.indexOf('DESKTOP_IPC_CHANNELS.capturePause'),
  );
  expect(stop).toContain('nativeCaptureStopCoordinator.run');
  expect(stop).toContain('stopNativeCaptureAndEnqueueDirector');
  expect(stop).not.toContain('await director');
  expect(source).toContain('handleDesktopIpc(DESKTOP_IPC_CHANNELS.projectDirectorStatus');
  expect(source).toContain('handleDesktopIpc(DESKTOP_IPC_CHANNELS.projectDirectorRetry');
});

test('browser stop and finalize recipe source path remains Director-independent', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/app/[locale]/app/page.tsx'), 'utf8');
  const browserStopStart = source.indexOf("const s = sessionRef.current ?? recordingLifecycle.activeSession()");
  const browserStopEnd = source.indexOf("  }, [clearDisplayStream", browserStopStart);
  const browserStop = source.slice(browserStopStart, browserStopEnd);
  expect(browserStop).toContain("recordingLifecycle.stop('done')");
  expect(browserStop).toContain('router.push(exportHref)');
  expect(browserStop).toContain('finalizeRecordingTeachingRecipe(meta)');
  expect(browserStop).not.toContain('projectDirectorStatus');
  expect(browserStop).not.toContain('projectDirectorRetry');
  expect(browserStop).not.toContain('directorJob');
});

test('duration uses only native manifest or validation end evidence and rounds to pipeline granularity', () => {
  expect(deriveNativeDirectorDuration(manifest('lesson-duration'), validation())).toEqual({
    durationUs: 4_101_000,
    observedEndUs: 4_100_001,
    source: 'native-manifest-segments',
  });
  const noSegments = manifest('lesson-validation');
  noSegments.tracks = {};
  expect(deriveNativeDirectorDuration(noSegments, validation())).toEqual({
    durationUs: 4_101_000,
    observedEndUs: 4_100_001,
    source: 'native-validation-continuity',
  });
  expect(deriveNativeDirectorDuration(noSegments, {
    ...validation(),
    continuity: { ...validation().continuity, tracks: {} },
  })).toBeNull();

  const lateEvents = manifest('lesson-media-duration');
  lateEvents.tracks['input-telemetry'] = [{
    index: 0,
    relativePath: 'segments/input-telemetry/000000.segment',
    startUs: 0,
    durationUs: 90_000_000,
    byteLength: 1_024,
  }];
  lateEvents.tracks['excalidraw-events'] = [{
    index: 0,
    relativePath: 'segments/excalidraw-events/000000.segment',
    startUs: 0,
    durationUs: 120_000_000,
    byteLength: 1_024,
  }];
  expect(deriveNativeDirectorDuration(lateEvents, validation())).toEqual({
    durationUs: 4_101_000,
    observedEndUs: 4_100_001,
    source: 'native-manifest-segments',
  });
});

test('failed generation preserves native media and an already published checkpoint, then explicit retry can become ready', async () => {
  const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'director-jobs-'));
  const recordingId = 'lesson-preserve';
  const projectRoot = resolveDesktopDirectorProjectRoot(videosDirectory, recordingId);
  const mediaPath = path.join(projectRoot, 'segments', 'screen', '000000.mp4');
  const currentPath = path.join(projectRoot, 'director', 'current.json');
  await mkdir(path.dirname(mediaPath), { recursive: true });
  await mkdir(path.dirname(currentPath), { recursive: true });
  await writeFile(mediaPath, 'media-before-director');
  let calls = 0;
  const jobs = service({
    videosDirectory,
    recoverProject: async () => {
      if (calls === 0) await writeFile(currentPath, '{"previous":"checkpoint"}');
      return manifest(recordingId);
    },
    runPipeline: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 'failed', retryable: true, code: 'director_native_artifact_write_failed',
          evidence: readyResult(recordingId).evidence,
        };
      }
      return readyResult(recordingId);
    },
  });

  const failed = jobs.enqueue(recordingId);
  await expect(failed.completion).resolves.toMatchObject({ status: 'failed', retryable: true });
  expect(await readFile(mediaPath, 'utf8')).toBe('media-before-director');
  expect(await readFile(currentPath, 'utf8')).toBe('{"previous":"checkpoint"}');

  await expect(jobs.retry(recordingId).completion).resolves.toMatchObject({ status: 'ready' });
  expect(await readFile(mediaPath, 'utf8')).toBe('media-before-director');
});
