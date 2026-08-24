import { DESKTOP_IPC_CHANNELS } from './productContract';
import type { NativeTeachingCompositionLifecycle } from '@/types/recording';
import type {
  TeachingCompositionOperation,
  TeachingCompositionSourceTrack,
} from '@/desktop/teachingCompositionExecutor';

const RECORDING_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export interface DesktopTeachingCompositionBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

interface PollDesktopTeachingCompositionOptions {
  bridge: DesktopTeachingCompositionBridge;
  recordingId: string;
  onStatus(status: NativeTeachingCompositionLifecycle): void;
  signal?: AbortSignal;
  intervalMs?: number;
  wait?: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown, minimum = Number.NEGATIVE_INFINITY): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum;
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 16) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function parseSourceTracks(value: unknown): TeachingCompositionSourceTrack[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const kinds: ReadonlyArray<TeachingCompositionSourceTrack['kind']> = [
    'screen', 'camera', 'microphone', 'system-audio',
  ];
  const ids = new Set<string>();
  const parsed: TeachingCompositionSourceTrack[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)
      || typeof candidate.trackId !== 'string'
      || candidate.trackId.trim().length === 0
      || ids.has(candidate.trackId)
      || !kinds.includes(candidate.kind as TeachingCompositionSourceTrack['kind'])) return null;
    ids.add(candidate.trackId);
    parsed.push({
      trackId: candidate.trackId,
      kind: candidate.kind as TeachingCompositionSourceTrack['kind'],
    });
  }
  return parsed;
}

function parseOperation(value: unknown): TeachingCompositionOperation | null {
  if (!isRecord(value)
    || typeof value.operationId !== 'string' || value.operationId.length === 0
    || !['place-motion-graphic', 'render-chart', 'mix-sound-effect'].includes(value.operation as string)
    || !['motion-graphics', 'chart', 'sound-effect'].includes(value.track as string)
    || !isRecord(value.asset)
    || typeof value.asset.assetId !== 'string' || value.asset.assetId.length === 0
    || !['motion-graphic', 'chart', 'sound-effect'].includes(value.asset.kind as string)
    || typeof value.asset.catalogVersion !== 'string' || value.asset.catalogVersion.length === 0
    || typeof value.asset.assetVersion !== 'string' || value.asset.assetVersion.length === 0
    || value.asset.checksumAlgorithm !== 'sha256'
    || typeof value.asset.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(value.asset.checksum)
    || typeof value.asset.localUri !== 'string' || value.asset.localUri.length === 0
    || !isFiniteNumber(value.startMs, 0)
    || !isFiniteNumber(value.endMs, 0) || value.endMs <= value.startMs
    || !isRecord(value.trim)
    || value.trim.sourceStartMs !== 0
    || !isFiniteNumber(value.trim.sourceEndMs, 0)
    || !['once', 'hold-last-frame'].includes(value.trim.playbackMode as string)
    || !Number.isSafeInteger(value.zOrder)
    || !isRecord(value.transition)
    || !isFiniteNumber(value.transition.enterMs, 0)
    || !isFiniteNumber(value.transition.exitMs, 0)
    || value.transition.easing !== 'easeInOutCubic'
    || !Array.isArray(value.content)) return null;

  const expected = {
    'place-motion-graphic': { track: 'motion-graphics', kind: 'motion-graphic', playbackMode: 'hold-last-frame' },
    'render-chart': { track: 'chart', kind: 'chart', playbackMode: 'hold-last-frame' },
    'mix-sound-effect': { track: 'sound-effect', kind: 'sound-effect', playbackMode: 'once' },
  }[value.operation as TeachingCompositionOperation['operation']];
  if (value.track !== expected.track
    || value.asset.kind !== expected.kind
    || value.trim.playbackMode !== expected.playbackMode) return null;

  for (const item of value.content) {
    if (!isRecord(item)
      || typeof item.slotId !== 'string' || item.slotId.length === 0
      || !['title', 'number', 'chart-data'].includes(item.type as string)
      || !isJsonValue(item.value)) return null;
  }

  if (value.operation === 'mix-sound-effect') {
    if (!isRecord(value.audio)
      || !isFiniteNumber(value.audio.gainDb)
      || !isFiniteNumber(value.audio.gainCeilingDb)
      || value.audio.mixesAsIndependentEffect !== true
      || !isRecord(value.audio.ducking)
      || !Array.isArray(value.audio.ducking.targetSourceTracks)
      || value.audio.ducking.targetSourceTracks.some((track) => typeof track !== 'string' || track.length === 0)
      || !isFiniteNumber(value.audio.ducking.attenuationDb)
      || !isFiniteNumber(value.audio.ducking.attackMs, 0)
      || !isFiniteNumber(value.audio.ducking.releaseMs, 0)) return null;
  } else if (value.audio !== undefined) return null;

  return structuredClone(value) as unknown as TeachingCompositionOperation;
}

function parseOperations(value: unknown): TeachingCompositionOperation[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = new Set<string>();
  const parsed: TeachingCompositionOperation[] = [];
  for (const candidate of value) {
    const operation = parseOperation(candidate);
    if (!operation || ids.has(operation.operationId)) return null;
    ids.add(operation.operationId);
    parsed.push(operation);
  }
  return parsed;
}

function parseStatus(value: unknown): NativeTeachingCompositionLifecycle {
  if (!isRecord(value) || typeof value.state !== 'string') {
    throw new Error('desktop_teaching_composition_status_invalid');
  }
  if (value.state === 'ready') {
    const sourceTracks = parseSourceTracks(value.sourceTracks);
    const operations = parseOperations(value.operations);
    if (value.code !== undefined || !sourceTracks || !operations) {
      throw new Error('desktop_teaching_composition_status_invalid');
    }
    const audioSourceTrackIds = new Set(
      sourceTracks
        .filter((track) => track.kind === 'microphone' || track.kind === 'system-audio')
        .map((track) => track.trackId),
    );
    if (operations.some((operation) => {
      if (operation.operation !== 'mix-sound-effect') return false;
      return !operation.audio
        || operation.audio.ducking.targetSourceTracks.some((trackId) => !audioSourceTrackIds.has(trackId));
    })) {
      throw new Error('desktop_teaching_composition_status_invalid');
    }
    if (operations.some((operation) => operation.operation !== 'mix-sound-effect')) {
      return {
        status: 'unsupported',
        code: 'teaching_composition_renderer_capability_unsupported',
      };
    }
    return { status: 'ready', sourceTracks, operations };
  }
  if (value.state === 'pending' || value.state === 'generating') {
    if (value.code !== undefined || value.sourceTracks !== undefined || value.operations !== undefined) {
      throw new Error('desktop_teaching_composition_status_invalid');
    }
    return { status: value.state };
  }
  if (value.state === 'unsupported' || value.state === 'failed') {
    if (typeof value.code !== 'string' || !value.code.startsWith('teaching_composition_')) {
      throw new Error('desktop_teaching_composition_status_invalid');
    }
    if (value.sourceTracks !== undefined || value.operations !== undefined) {
      throw new Error('desktop_teaching_composition_status_invalid');
    }
    return value.state === 'unsupported'
      ? { status: 'unsupported', code: value.code }
      : { status: 'failed', code: value.code, retryable: false };
  }
  if (value.state === 'absent') {
    if (value.code !== undefined || value.sourceTracks !== undefined || value.operations !== undefined) {
      throw new Error('desktop_teaching_composition_status_invalid');
    }
    return { status: 'failed', code: 'teaching_composition_manifest_absent', retryable: false };
  }
  throw new Error('desktop_teaching_composition_status_invalid');
}

function waitForPoll(intervalMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('desktop_teaching_composition_poll_aborted'));
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, intervalMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error('desktop_teaching_composition_poll_aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function pollDesktopTeachingComposition(
  options: PollDesktopTeachingCompositionOptions,
): Promise<NativeTeachingCompositionLifecycle> {
  if (!RECORDING_ID.test(options.recordingId)) {
    throw new Error('desktop_teaching_composition_status_invalid');
  }
  const wait = options.wait ?? (() => waitForPoll(options.intervalMs ?? 250, options.signal));
  while (true) {
    if (options.signal?.aborted) throw new Error('desktop_teaching_composition_poll_aborted');
    const response = await options.bridge.invoke(
      DESKTOP_IPC_CHANNELS.projectReadTeachingCompositionExport,
      { recordingId: options.recordingId },
    );
    if (options.signal?.aborted) throw new Error('desktop_teaching_composition_poll_aborted');
    const status = parseStatus(response);
    options.onStatus({ ...status });
    if (status.status !== 'pending' && status.status !== 'generating') return status;
    await wait();
  }
}
