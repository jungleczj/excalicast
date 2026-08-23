#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { spawnNativeHelper } = require('../apps/desktop/dist/apps/desktop/src/nativeHelperClient.js');
const { runNativeCaptureSoak } = require('../apps/desktop/dist/apps/desktop/src/nativeCaptureSoak.js');
const execFileAsync = promisify(execFile);

const options = parseArguments(process.argv.slice(2));
const helperPath = resolve(options.helper ?? 'native/mac-media-engine/.build-local/arm64-apple-macosx/debug/mac-media-engine');
const durationSeconds = numberOption(options, 'duration-seconds', 60);
const sampleSeconds = numberOption(options, 'sample-seconds', 2);
const sourceID = requiredNumberOption(options, 'source-id');
const recordingId = options['recording-id'] ?? `native-soak-${randomUUID()}`;
const projectRoot = resolve(options['project-root'] ?? join(tmpdir(), `excalicast-${recordingId}`));

await mkdir(projectRoot, { recursive: true });
const client = spawnNativeHelper(helperPath);

try {
  await client.handshake();
  const result = await runNativeCaptureSoak({
    client,
    request: {
      recordingId,
      projectRoot,
      sourceKind: options['source-kind'] === 'window' ? 'window' : 'display',
      sourceID,
      width: numberOption(options, 'width', 2560),
      height: numberOption(options, 'height', 1440),
      framesPerSecond: numberOption(options, 'fps', 30),
      codec: options.codec === 'hevc' ? 'hevc' : 'h264',
      captureSystemAudio: booleanOption(options, 'system-audio'),
      captureMicrophone: booleanOption(options, 'microphone'),
      microphoneDeviceID: options['microphone-device-id'],
      captureCamera: booleanOption(options, 'camera'),
      cameraDeviceID: options['camera-device-id'],
      cameraWidth: numberOption(options, 'camera-width', 1280),
      cameraHeight: numberOption(options, 'camera-height', 720),
      cameraFramesPerSecond: numberOption(options, 'camera-fps', 24),
    },
    durationMs: durationSeconds * 1_000,
    sampleIntervalMs: sampleSeconds * 1_000,
    sampleResidentBytes: client.processId
      ? () => readResidentBytes(client.processId)
      : undefined,
  });
  process.stdout.write(`${JSON.stringify({
    recordingId,
    projectRoot,
    helperPath,
    ...result,
  }, null, 2)}\n`);
  if (!result.summary.passed) process.exitCode = 1;
} finally {
  client.close();
}

async function readResidentBytes(processId) {
  const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(processId)]);
  const residentKilobytes = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(residentKilobytes)) throw new Error('helper_rss_unavailable');
  return residentKilobytes * 1024;
}

function parseArguments(argumentsList) {
  const parsed = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const item = argumentsList[index];
    if (!item.startsWith('--')) throw new Error(`unexpected_argument:${item}`);
    const key = item.slice(2);
    const next = argumentsList[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true';
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function numberOption(optionsMap, key, fallback) {
  if (optionsMap[key] == null) return fallback;
  const value = Number(optionsMap[key]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid_${key}`);
  return value;
}

function requiredNumberOption(optionsMap, key) {
  if (optionsMap[key] == null) throw new Error(`missing_${key}`);
  return numberOption(optionsMap, key, 0);
}

function booleanOption(optionsMap, key) {
  return optionsMap[key] === 'true' || optionsMap[key] === '1';
}
