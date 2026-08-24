import { app, BrowserWindow, ipcMain, protocol, screen, shell } from 'electron';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { RecordingTeachingRecipeSelectionV1 } from '../../../src/types/recording';
import {
  DESKTOP_IPC_CHANNELS,
  mergeDesktopInkSettings,
  normalizeDesktopInkSettings,
  type DesktopInkSettings,
} from '../../../src/desktop/productContract';
import {
  applyDesktopTeleprompterProgress,
  configureDesktopTeleprompter,
  createDesktopTeleprompterState,
  type DesktopTeleprompterConfiguration,
  type DesktopTeleprompterState,
} from '../../../src/desktop/teleprompterSession';
import {
  spawnNativeHelper,
  type NativeHelperClient,
  type NativeHelperHandshake,
} from './nativeHelperClient';
import {
  mergeDesktopCaptureExclusions,
  parseDesktopCapturePayload,
} from './captureRequest';
import {
  bindDesktopRendererRole,
  createDesktopInkWindowOptions,
  createDesktopTeleprompterWindowOptions,
  createDesktopWindowOptions,
  isTrustedDesktopRendererUrl,
  parseDesktopWindowMediaSourceId,
  registerAuthorizedDesktopIpcHandler,
  resolveDesktopTeleprompterBounds,
  type DesktopIpcInvokeHandler,
  type DesktopRendererRole,
} from './windowContract';
import { createNativeInkEventBatch } from './inkEventBatch';
import { createNativeInputTelemetryProducerBatch } from './unifiedEventBatch';
import { readNativeInkEventSegments } from './inkEventReader';
import { readNativeMediaSegmentRange, type NativeReadableMediaTrack } from './nativeMediaReader';
import {
  createNativeMediaResponse,
  NATIVE_MEDIA_SCHEME,
  parseNativeMediaUrl,
} from './nativeMediaProtocol';
import {
  createTeachingAssetResponse,
  TEACHING_ASSET_SCHEME,
  type TeachingAssetLease,
} from './teachingAssetProtocol';
import type { TeachingAssetIdentity } from '../../../src/desktop/teachingAssetProtocol';
import {
  resolveTeachingAssetFromManifest,
  readReadyTeachingCompositionManifest,
  type ResolvedTeachingCompositionAsset,
} from './teachingCompositionManifest';
import {
  persistDesktopTeachingPreselection,
  readDesktopTeachingPreselection,
} from './teachingPreselectionManifest';
import {
  finalizeDesktopTeachingComposition,
  type DesktopTeachingCompositionFinalizeResult,
} from './teachingCompositionLifecycle';
import {
  DesktopNativeCaptureStopCoordinator,
  DesktopDirectorJobService,
  parseDesktopDirectorJobPayload,
  resolveDesktopDirectorProjectRoot,
  stopNativeCaptureAndEnqueueDirector,
} from './directorJobService';

protocol.registerSchemesAsPrivileged([{
  scheme: NATIVE_MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
  },
}, {
  scheme: TEACHING_ASSET_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
  },
}]);

let mainWindow: BrowserWindow | null = null;
let inkWindow: BrowserWindow | null = null;
let teleprompterWindow: BrowserWindow | null = null;
let teleprompterState: DesktopTeleprompterState = createDesktopTeleprompterState();
let inkSettings: DesktopInkSettings = normalizeDesktopInkSettings({
  mode: 'ink',
  backgroundOpacity: 0,
  inkOpacity: 1,
  pointerPolicy: 'pass-through',
});
let nativeHelper: NativeHelperClient | null = null;
let nativeHelperHandshake: NativeHelperHandshake | null = null;
let nativeHelperInitialization: Promise<void> | null = null;
let directorJobs: DesktopDirectorJobService;
const nativeCaptureStopCoordinator = new DesktopNativeCaptureStopCoordinator();
let nativeCaptureStarting = false;
let activeNativeCapture: {
  recordingId: string;
  startedUnixMs: number;
  nextInkEventIndex: number;
  pausedTotalMs: number;
  pauseStartedUnixMs: number | null;
  pausePending: boolean;
} | null = null;
let inkEventCommitTail: Promise<void> = Promise.resolve();
let inputTelemetryCommitTail: Promise<void> = Promise.resolve();
const pendingInkFlushes = new Map<string, () => void>();
const materializedTrackCache = new Map<string, Promise<{
  relativePath: string;
  mimeType: string;
}>>();
// Keep checked descriptors, not raw bytes. Range requests then stream the same
// verified inode instead of re-reading and re-hashing a whole asset per seek.
interface TeachingAssetCacheEntry {
  asset: ResolvedTeachingCompositionAsset;
  activeLeases: number;
}
const teachingAssetCache = new Map<string, TeachingAssetCacheEntry>();
const teachingAssetResolutionFlights = new Map<string, Promise<ResolvedTeachingCompositionAsset>>();
const overflowTeachingAssetLeases = new Map<string, TeachingAssetCacheEntry>();
type TeachingCompositionJobState = 'pending' | 'ready' | 'unsupported' | 'absent' | 'failed';
interface TeachingCompositionJob {
  state: TeachingCompositionJobState;
  code?: string;
  controller: AbortController;
  completion: Promise<DesktopTeachingCompositionFinalizeResult>;
}
const teachingCompositionJobs = new Map<string, TeachingCompositionJob>();
const TEACHING_COMPOSITION_EXPORT_WAIT_MS = 15_000;
const desktopRendererRoles = new Map<number, DesktopRendererRole>();

function handleDesktopIpc(channel: string, handler: DesktopIpcInvokeHandler): void {
  registerAuthorizedDesktopIpcHandler({
    ipcMain,
    roles: desktopRendererRoles,
    channel,
    handler,
  });
}

function rendererBaseUrl(): string {
  return process.env.EXCALICAST_RENDERER_URL
    ?? (app.isPackaged ? 'https://excalicast.cc/app' : 'http://localhost:3001/app');
}

function configureTrustedNavigation(window: BrowserWindow): void {
  const baseUrl = rendererBaseUrl();
  const guard = (event: Electron.Event, url: string) => {
    if (isTrustedDesktopRendererUrl(url, baseUrl)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  window.webContents.on('will-navigate', guard);
  window.webContents.on('will-redirect', guard);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function initializeNativeHelper(): Promise<void> {
  const packagedPath = path.join(process.resourcesPath, 'bin', 'mac-media-engine');
  const developmentPath = path.join(
    app.getAppPath(),
    'native/mac-media-engine/.build-local/arm64-apple-macosx/debug/mac-media-engine',
  );
  const executablePath = process.env.EXCALICAST_MEDIA_HELPER_PATH
    ?? (app.isPackaged ? packagedPath : developmentPath);
  if (!executablePath || !fs.existsSync(executablePath)) return;
  nativeHelper = spawnNativeHelper(executablePath);
  nativeHelperHandshake = await nativeHelper.handshake();
}

function registerDesktopIpc(): void {
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.teleprompterGetState, () => teleprompterState);
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.teleprompterConfigure, (_event, payload: unknown) => {
    const value = objectPayload(payload, 'desktop_teleprompter_payload_invalid');
    if (value.configuration) {
      teleprompterState = configureDesktopTeleprompter(
        teleprompterState,
        value.configuration as DesktopTeleprompterConfiguration,
      );
    } else if (value.progress) {
      const progress = objectPayload(value.progress, 'desktop_teleprompter_progress_invalid');
      teleprompterState = applyDesktopTeleprompterProgress(teleprompterState, {
        currentWord: progress.currentWord as number,
        recognitionStatus: progress.recognitionStatus as DesktopTeleprompterState['recognitionStatus'],
        heard: typeof progress.heard === 'string' ? progress.heard : '',
      });
    } else {
      throw new Error('desktop_teleprompter_payload_invalid');
    }
    applyTeleprompterVisibility();
    broadcastTeleprompterState();
    return teleprompterState;
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.teleprompterSetMode, (_event, payload: unknown) => {
    const value = objectPayload(payload, 'desktop_teleprompter_mode_invalid');
    if (value.mode === 'close') {
      teleprompterState = { ...teleprompterState, visible: false };
      teleprompterWindow?.hide();
    } else if (value.mode === 'compact' || value.mode === 'expanded') {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const window = createOrMoveTeleprompterWindow();
      window.setBounds(resolveDesktopTeleprompterBounds(display, value.mode), true);
      if (teleprompterState.visible) window.showInactive();
    } else {
      throw new Error('desktop_teleprompter_mode_invalid');
    }
    broadcastTeleprompterState();
    return teleprompterState;
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.inkGetSettings, () => desktopInkState());
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.inkSetMode, async (_event, payload: unknown) => {
    const value = objectPayload(payload, 'desktop_ink_mode_invalid');
    if ((value.mode !== 'ink' && value.mode !== 'full-board')
      || (value.pointerPolicy !== 'draw' && value.pointerPolicy !== 'pass-through')) {
      throw new Error('desktop_ink_mode_invalid');
    }
    const displayID = value.displayID === undefined
      ? undefined
      : requiredSafeInteger(value.displayID, 'desktop_ink_display_invalid');
    inkSettings = mergeDesktopInkSettings(inkSettings, {
      mode: value.mode,
      pointerPolicy: value.pointerPolicy,
    });
    const window = createOrMoveInkWindow(displayID);
    applyInkWindowSettings(window);
    broadcastInkSettings();
    return desktopInkState();
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.inkSetOpacity, (_event, payload: unknown) => {
    const value = objectPayload(payload, 'desktop_ink_opacity_invalid');
    if (typeof value.backgroundOpacity !== 'number' || typeof value.inkOpacity !== 'number') {
      throw new Error('desktop_ink_opacity_invalid');
    }
    inkSettings = mergeDesktopInkSettings(inkSettings, {
      backgroundOpacity: value.backgroundOpacity,
      inkOpacity: value.inkOpacity,
    });
    broadcastInkSettings();
    return desktopInkState();
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.inkAppendEvents, async (_event, payload: unknown) => {
    const active = activeNativeCapture;
    if (!active) throw new Error('desktop_ink_recording_inactive');
    if (active.pauseStartedUnixMs !== null) return { committed: false, reason: 'capture_paused' };
    const helper = await requireNativeHelper();
    const commit = inkEventCommitTail.then(async () => {
      const batch = createNativeInkEventBatch(
        payload,
        active.startedUnixMs,
        active.nextInkEventIndex,
        active.pausedTotalMs,
      );
      await helper.appendInkEvents(batch);
      active.nextInkEventIndex += 1;
      return batch.index;
    });
    inkEventCommitTail = commit.then(() => undefined, () => undefined);
    return { committed: true, index: await commit };
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.inputTelemetryAppend, async (_event, payload: unknown) => {
    const active = activeNativeCapture;
    if (!active) throw new Error('desktop_input_telemetry_recording_inactive');
    const batch = createNativeInputTelemetryProducerBatch(payload, active.recordingId);
    const helper = await requireNativeHelper();
    const commit = inputTelemetryCommitTail.then(() => helper.appendInputTelemetry(batch));
    inputTelemetryCommitTail = commit.then(() => undefined, () => undefined);
    const acknowledgement = await commit;
    return { committed: true, ...acknowledgement };
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.inkFlushComplete, (_event, payload: unknown) => {
    const value = objectPayload(payload, 'desktop_ink_flush_invalid');
    if (typeof value.requestId !== 'string') throw new Error('desktop_ink_flush_invalid');
    pendingInkFlushes.get(value.requestId)?.();
    pendingInkFlushes.delete(value.requestId);
    return { acknowledged: true };
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.capturePermissions, async () => {
    const helper = await requireNativeHelper();
    return helper.capturePermissions();
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.captureRequestPermissions, async (_event, payload: unknown) => {
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const helper = await requireNativeHelper();
    return helper.requestCapturePermissions({
      captureMicrophone: value.captureMicrophone === true,
      captureCamera: value.captureCamera === true,
    });
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.captureSources, async () => {
    const helper = await requireNativeHelper();
    return helper.captureSources();
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.captureDevices, async () => {
    const helper = await requireNativeHelper();
    return helper.captureDevices();
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.capturePreflight, async (_event, payload: unknown) => {
    const helper = await requireNativeHelper();
    return helper.preflightCapture(toNativeCaptureRequest(payload));
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.captureStart, async (_event, payload: unknown) => {
    const request = toNativeCaptureRequest(payload);
    if (nativeCaptureStarting || activeNativeCapture) throw new Error('native_capture_already_active');
    nativeCaptureStarting = true;
    try {
      await prepareTeachingCompositionForCapture();
      const rawPayload = objectPayload(payload, 'native_capture_request_invalid');
      const teachingRecipe = teachingRecipeFromCapturePayload(rawPayload.teachingRecipe);
      // This is deliberately non-fatal: unsupported teaching assets never
      // prevent the selected media capture from starting.
      await persistDesktopTeachingPreselection({
        projectRoot: request.projectRoot,
        catalogPath: path.join(app.getPath('userData'), 'Teaching Assets', 'catalog.json'),
        cacheRoot: path.join(app.getPath('userData'), 'Teaching Assets'),
        recordingId: request.recordingId,
        recipe: teachingRecipe,
        recipeInvalid: rawPayload.teachingRecipe !== undefined && !teachingRecipe,
      }).catch((error) => console.error('[desktop] teaching preselection failed', error));
      await directorJobs.prepareForCapture(3_000);
      directorJobs.assertCaptureMayStart();
      const helper = await requireNativeHelper();
      const result = await helper.startCapture(request);
      activeNativeCapture = {
        recordingId: request.recordingId,
        startedUnixMs: Date.now(),
        nextInkEventIndex: 0,
        pausedTotalMs: 0,
        pauseStartedUnixMs: null,
        pausePending: false,
      };
      inkEventCommitTail = Promise.resolve();
      inputTelemetryCommitTail = Promise.resolve();
      broadcastInkSettings();
      return result;
    } finally {
      nativeCaptureStarting = false;
    }
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.captureStop, async () => {
    const active = activeNativeCapture;
    if (!active) throw new Error('native_capture_inactive');
    return nativeCaptureStopCoordinator.run(async () => {
      const helper = await requireNativeHelper();
      return stopNativeCaptureAndEnqueueDirector({
        flushInk: requestInkWindowFlush,
        waitForInkTail: () => inkEventCommitTail,
        waitForInputTail: () => inputTelemetryCommitTail,
        stopCapture: () => helper.stopCapture(),
        onCaptureEnded: () => {
          if (activeNativeCapture === active) activeNativeCapture = null;
          broadcastInkSettings();
          // Director telemetry may continue to enrich a later rerun, but the
          // deterministic first compile starts only after durable media stop.
          beginTeachingCompositionFinalization(active.recordingId);
        },
        enqueueDirector: () => directorJobs.enqueue(active.recordingId),
      });
    });
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.capturePause, async () => {
    if (!activeNativeCapture) throw new Error('native_capture_inactive');
    activeNativeCapture.pausePending = true;
    broadcastInkSettings();
    try {
      await requestInkWindowFlush();
      await inkEventCommitTail;
      await inputTelemetryCommitTail;
      const state = await (await requireNativeHelper()).pauseCapture();
      if (activeNativeCapture.pauseStartedUnixMs === null) {
        activeNativeCapture.pauseStartedUnixMs = Date.now();
      }
      activeNativeCapture.pausePending = false;
      broadcastInkSettings();
      return { state };
    } catch (error) {
      activeNativeCapture.pausePending = false;
      broadcastInkSettings();
      throw error;
    }
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.captureResume, async () => {
    if (!activeNativeCapture) throw new Error('native_capture_inactive');
    const state = await (await requireNativeHelper()).resumeCapture();
    const pausedAt = activeNativeCapture.pauseStartedUnixMs;
    if (pausedAt !== null) activeNativeCapture.pausedTotalMs += Date.now() - pausedAt;
    activeNativeCapture.pauseStartedUnixMs = null;
    activeNativeCapture.pausePending = false;
    broadcastInkSettings();
    return { state };
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.captureSetMicrophoneMuted, async (_event, payload: unknown) => {
    if (!activeNativeCapture) throw new Error('native_capture_inactive');
    const value = objectPayload(payload, 'native_microphone_mute_invalid');
    if (typeof value.muted !== 'boolean') throw new Error('native_microphone_mute_invalid');
    return { muted: await (await requireNativeHelper()).setMicrophoneMuted(value.muted) };
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.captureSetSystemAudioMuted, async (_event, payload: unknown) => {
    if (!activeNativeCapture) throw new Error('native_capture_inactive');
    const value = objectPayload(payload, 'native_system_audio_mute_invalid');
    if (typeof value.muted !== 'boolean') throw new Error('native_system_audio_mute_invalid');
    return { muted: await (await requireNativeHelper()).setSystemAudioMuted(value.muted) };
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.captureSetCameraVisibility, async (_event, payload: unknown) => {
    if (!activeNativeCapture) throw new Error('native_capture_inactive');
    const value = objectPayload(payload, 'native_camera_visibility_invalid');
    if (typeof value.hidden !== 'boolean') throw new Error('native_camera_visibility_invalid');
    return { hidden: await (await requireNativeHelper()).setCameraVisibility(value.hidden) };
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.captureSetCameraHardware, async (_event, payload: unknown) => {
    if (!activeNativeCapture) throw new Error('native_capture_inactive');
    const value = objectPayload(payload, 'native_camera_hardware_invalid');
    if (typeof value.enabled !== 'boolean') throw new Error('native_camera_hardware_invalid');
    return (await requireNativeHelper()).setCameraHardwareEnabled(value.enabled);
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.captureStatus, async () => {
    if (nativeHelperInitialization) await nativeHelperInitialization;
    if (!nativeHelper) return { available: false, state: 'idle', helper: null };
    const status = await nativeHelper.captureStatus();
    return {
      available: true,
      ...status,
      helper: nativeHelperHandshake,
    };
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.projectRecover, async (_event, payload: unknown) => {
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const recordingId = typeof value.recordingId === 'string' ? value.recordingId : '';
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recordingId)) {
      throw new Error('native_recovery_request_invalid');
    }
    const helper = await requireNativeHelper();
    const manifest = await helper.recoverProject(
      resolveDesktopDirectorProjectRoot(app.getPath('videos'), recordingId),
    );
    const director = enqueueDirectorAfterRecovery(recordingId);
    if (!activeNativeCapture && !nativeCaptureStarting) beginTeachingCompositionFinalization(recordingId);
    return { ...manifest, ...(director ? { director } : {}) };
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.projectValidate, async (_event, payload: unknown) => {
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const recordingId = typeof value.recordingId === 'string' ? value.recordingId : '';
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recordingId)) {
      throw new Error('native_validation_request_invalid');
    }
    const helper = await requireNativeHelper();
    const validation = await helper.validateProject(
      resolveDesktopDirectorProjectRoot(app.getPath('videos'), recordingId),
    );
    const director = enqueueDirectorAfterRecovery(recordingId);
    if (!activeNativeCapture && !nativeCaptureStarting) beginTeachingCompositionFinalization(recordingId);
    return { ...validation, ...(director ? { director } : {}) };
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.projectDirectorStatus, async (_event, payload: unknown) => {
    const { recordingId } = parseDesktopDirectorJobPayload(payload);
    return directorJobs.status(recordingId);
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.projectDirectorRetry, (_event, payload: unknown) => {
    const { recordingId } = parseDesktopDirectorJobPayload(payload);
    return directorJobs.retry(recordingId).status;
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.projectReadMediaSegment, async (_event, payload: unknown) => {
    if (activeNativeCapture) throw new Error('native_media_read_during_capture');
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const recordingId = typeof value.recordingId === 'string' ? value.recordingId : '';
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recordingId)) {
      throw new Error('native_media_read_request_invalid');
    }
    const projectRoot = path.join(app.getPath('videos'), 'Excalicast Projects', recordingId);
    const helper = await requireNativeHelper();
    const manifest = await helper.recoverProject(projectRoot);
    return readNativeMediaSegmentRange(projectRoot, manifest, {
      track: value.track as NativeReadableMediaTrack,
      segmentIndex: value.segmentIndex as number,
      offset: value.offset as number,
      length: value.length as number,
    });
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.projectReadInkEvents, async (_event, payload: unknown) => {
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const recordingId = typeof value.recordingId === 'string' ? value.recordingId : '';
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recordingId)) {
      throw new Error('native_ink_event_read_request_invalid');
    }
    const projectRoot = path.join(app.getPath('videos'), 'Excalicast Projects', recordingId);
    const helper = await requireNativeHelper();
    const manifest = await helper.recoverProject(projectRoot);
    return { segments: await readNativeInkEventSegments(projectRoot, manifest) };
  });
  handleDesktopIpc(DESKTOP_IPC_CHANNELS.projectReadTeachingCompositionExport, async (_event, payload: unknown) => {
    if (activeNativeCapture || nativeCaptureStarting) throw new Error('teaching_composition_read_during_capture');
    const { recordingId } = parseDesktopDirectorJobPayload(payload);
    let job = teachingCompositionJobs.get(recordingId);
    if (!job) {
      const preselection = await readDesktopTeachingPreselection({
        projectRoot: resolveDesktopDirectorProjectRoot(app.getPath('videos'), recordingId),
        recordingId,
      });
      if (preselection) job = beginTeachingCompositionFinalization(recordingId);
    }
    if (job) {
      if (job.state === 'pending') {
        const settled = await Promise.race([
          job.completion.then(() => true, () => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), TEACHING_COMPOSITION_EXPORT_WAIT_MS)),
        ]);
        if (!settled && job.state === 'pending') return { state: 'pending' as const };
      }
      if (job.state === 'unsupported') return { state: 'unsupported' as const, code: job.code ?? 'teaching_composition_unsupported' };
      if (job.state === 'failed') return { state: 'failed' as const, code: job.code ?? 'teaching_composition_finalization_failed' };
      if (job.state === 'absent') return { state: 'absent' as const };
    }
    let manifest;
    try {
      manifest = await readReadyTeachingCompositionManifest({
        projectRoot: resolveDesktopDirectorProjectRoot(app.getPath('videos'), recordingId),
        recordingId,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'teaching_composition_manifest_missing') {
        return { state: 'absent' as const };
      }
      throw error;
    }
    if (manifest.plan.operations.some((operation) => operation.operation !== 'mix-sound-effect')) {
      throw new Error('teaching_composition_export_unsupported_capability');
    }
    // Return execution metadata only. Asset bytes stay behind excalicast-asset.
    return { state: 'ready' as const, sourceTracks: manifest.plan.sourceTracks, operations: manifest.plan.operations };
  });
}

function enqueueDirectorAfterRecovery(recordingId: string) {
  try {
    return directorJobs.enqueue(recordingId).status;
  } catch (error) {
    if (error instanceof Error && error.message === 'director_generation_capture_active') return undefined;
    console.error('[desktop] Director recovery enqueue failed', error);
    return undefined;
  }
}

async function finalizeDesktopTeachingCompositionAfterNativeStop(
  recordingId: string,
  signal: AbortSignal,
): Promise<DesktopTeachingCompositionFinalizeResult> {
  const projectRoot = resolveDesktopDirectorProjectRoot(app.getPath('videos'), recordingId);
  const helper = await requireNativeHelper();
  const [manifest, validation] = await Promise.all([
    helper.recoverProject(projectRoot),
    helper.validateProject(projectRoot),
  ]);
  const outcome = await finalizeDesktopTeachingComposition({
    projectRoot,
    cacheRoot: path.join(app.getPath('userData'), 'Teaching Assets'),
    recordingId,
    manifest,
    validation,
    signal,
  });
  return outcome;
}

function beginTeachingCompositionFinalization(recordingId: string): TeachingCompositionJob {
  const existing = teachingCompositionJobs.get(recordingId);
  if (existing?.state === 'pending') return existing;
  let job!: TeachingCompositionJob;
  const controller = new AbortController();
  const completion = finalizeDesktopTeachingCompositionAfterNativeStop(recordingId, controller.signal).then(
    (outcome) => {
      job.state = outcome.state;
      if (outcome.state === 'unsupported') job.code = outcome.code;
      return outcome;
    },
    (error) => {
      job.state = 'failed';
      job.code = error instanceof Error ? error.message : 'teaching_composition_finalization_failed';
      throw error;
    },
  );
  job = { state: 'pending', controller, completion };
  teachingCompositionJobs.set(recordingId, job);
  void completion.catch((error) => console.error('[desktop] teaching composition finalization failed', error));
  return job;
}

async function prepareTeachingCompositionForCapture(): Promise<void> {
  const pending = [...teachingCompositionJobs.values()].filter((job) => job.state === 'pending');
  for (const job of pending) job.controller.abort();
  if (pending.length === 0) return;
  const drained = await Promise.race([
    Promise.allSettled(pending.map((job) => job.completion)).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (!drained) throw new Error('teaching_composition_drain_timeout');
}

async function requireNativeHelper(): Promise<NativeHelperClient> {
  if (nativeHelperInitialization) await nativeHelperInitialization;
  if (!nativeHelper) throw new Error('native_media_helper_unavailable');
  return nativeHelper;
}

function registerNativeMediaProtocol(): void {
  protocol.handle(NATIVE_MEDIA_SCHEME, async (request) => {
    try {
      if (activeNativeCapture) return new Response('capture active', { status: 409 });
      const { recordingId, track } = parseNativeMediaUrl(request.url);
      const projectRoot = path.join(app.getPath('videos'), 'Excalicast Projects', recordingId);
      const key = `${recordingId}:${track}`;
      let materialized = materializedTrackCache.get(key);
      if (!materialized) {
        materialized = requireNativeHelper().then((helper) => helper.materializeProjectTrack(projectRoot, track));
        materializedTrackCache.set(key, materialized);
        void materialized.catch(() => materializedTrackCache.delete(key));
      }
      const result = await materialized;
      const mediaPath = path.resolve(projectRoot, result.relativePath);
      const normalizedRoot = `${path.resolve(projectRoot)}${path.sep}`;
      if (!mediaPath.startsWith(normalizedRoot) || !result.relativePath.startsWith(`materialized/${track}.`)) {
        throw new Error('native_materialized_track_path_invalid');
      }
      return createNativeMediaResponse(request, mediaPath, result.mimeType);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'native_media_protocol_failed';
      const status = message === 'native_media_range_invalid' ? 416 : 404;
      return new Response(message, { status });
    }
  });
}

/** The renderer may name an asset identity, but never a filesystem path. */
function registerTeachingAssetProtocol(): void {
  protocol.handle(TEACHING_ASSET_SCHEME, async (request) => {
    try {
      // No asset read/decode while real-time capture owns CPU, storage, and I/O.
      if (activeNativeCapture || nativeCaptureStarting) return new Response('capture active', { status: 409 });
      return await createTeachingAssetResponse(request, resolveCachedTeachingAsset);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'teaching_asset_protocol_failed';
      const status = message === 'native_media_range_invalid' ? 416 : 404;
      return new Response(message, { status });
    }
  });
}

function teachingAssetCacheKey(identity: TeachingAssetIdentity): string {
  return `${identity.recordingId}\u0000${identity.assetId}\u0000${identity.assetVersion}\u0000${identity.checksum}`;
}

function leaseTeachingAsset(key: string, entry: TeachingAssetCacheEntry): TeachingAssetLease {
  entry.activeLeases += 1;
  // Map reinsertion makes recent requests least likely to be evicted.
  teachingAssetCache.delete(key);
  teachingAssetCache.set(key, entry);
  let released = false;
  return {
    ...entry.asset,
    release: () => {
      if (released) return;
      released = true;
      entry.activeLeases = Math.max(0, entry.activeLeases - 1);
    },
  };
}

function leaseOverflowTeachingAsset(key: string, entry: TeachingAssetCacheEntry): TeachingAssetLease {
  entry.activeLeases += 1;
  let released = false;
  return {
    ...entry.asset,
    release: async () => {
      if (released) return;
      released = true;
      entry.activeLeases = Math.max(0, entry.activeLeases - 1);
      if (entry.activeLeases === 0 && overflowTeachingAssetLeases.get(key) === entry) {
        overflowTeachingAssetLeases.delete(key);
        await entry.asset.fileHandle?.close();
      }
    },
  };
}

async function resolveCachedTeachingAsset(identity: TeachingAssetIdentity): Promise<TeachingAssetLease> {
  const key = teachingAssetCacheKey(identity);
  const existing = teachingAssetCache.get(key);
  if (existing) return leaseTeachingAsset(key, existing);
  const overflow = overflowTeachingAssetLeases.get(key);
  if (overflow) return leaseOverflowTeachingAsset(key, overflow);
  let flight = teachingAssetResolutionFlights.get(key);
  if (!flight) {
    flight = resolveTeachingAssetFromManifest({
      projectRoot: resolveDesktopDirectorProjectRoot(app.getPath('videos'), identity.recordingId),
      cacheRoot: path.join(app.getPath('userData'), 'Teaching Assets'),
      ...identity,
    });
    teachingAssetResolutionFlights.set(key, flight);
    void flight.finally(() => teachingAssetResolutionFlights.delete(key)).catch(() => undefined);
  }
  const resolved = await flight;
  const completedExisting = teachingAssetCache.get(key);
  if (completedExisting) {
    // Concurrent callers share the singleflight result already inserted by the
    // first continuation; take a lease on that same verified descriptor.
    return leaseTeachingAsset(key, completedExisting);
  }
  const completedOverflow = overflowTeachingAssetLeases.get(key);
  if (completedOverflow) return leaseOverflowTeachingAsset(key, completedOverflow);
  while (teachingAssetCache.size >= 64) {
    const evictable = [...teachingAssetCache.entries()].find(([, entry]) => entry.activeLeases === 0);
    if (!evictable) {
      // All cached descriptors are streaming. Concurrent callers share one
      // overflow lease and the descriptor closes after the final body closes.
      const overflowEntry: TeachingAssetCacheEntry = { asset: resolved, activeLeases: 0 };
      overflowTeachingAssetLeases.set(key, overflowEntry);
      return leaseOverflowTeachingAsset(key, overflowEntry);
    }
    teachingAssetCache.delete(evictable[0]);
    await evictable[1].asset.fileHandle?.close().catch(() => undefined);
  }
  const entry: TeachingAssetCacheEntry = { asset: resolved, activeLeases: 0 };
  teachingAssetCache.set(key, entry);
  return leaseTeachingAsset(key, entry);
}

function toNativeCaptureRequest(payload: unknown) {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const recordingId = typeof value.recordingId === 'string' ? value.recordingId : '';
  return parseDesktopCapturePayload(
    mergeDesktopCaptureExclusions(payload, privateOverlayWindowIDs()),
    path.join(app.getPath('videos'), 'Excalicast Projects', recordingId),
  );
}

function teachingRecipeFromCapturePayload(value: unknown): RecordingTeachingRecipeSelectionV1 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const recipe = value as Record<string, unknown>;
  if (Object.keys(recipe).some((key) => !['schemaVersion', 'enabled', 'teachingPackId', 'selectedAssetIds'].includes(key))
    || recipe.schemaVersion !== 1
    || typeof recipe.enabled !== 'boolean'
    || typeof recipe.teachingPackId !== 'string'
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(recipe.teachingPackId)
    || !Array.isArray(recipe.selectedAssetIds)
    || recipe.selectedAssetIds.length > 128
    || !recipe.selectedAssetIds.every((assetId) => typeof assetId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(assetId))) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    enabled: recipe.enabled,
    teachingPackId: recipe.teachingPackId,
    selectedAssetIds: [...recipe.selectedAssetIds],
  };
}

function createOrMoveInkWindow(displayID?: number): BrowserWindow {
  const display = displayID === undefined
    ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    : screen.getAllDisplays().find((candidate) => candidate.id === displayID);
  if (!display) throw new Error('desktop_ink_display_not_found');
  if (inkWindow && !inkWindow.isDestroyed()) {
    inkWindow.setBounds(display.bounds, false);
    return inkWindow;
  }
  const preload = path.join(__dirname, 'preload.js');
  const window = new BrowserWindow(createDesktopInkWindowOptions(preload, display.bounds));
  const unbindRole = bindDesktopRendererRole(desktopRendererRoles, window.webContents, 'ink');
  configureTrustedNavigation(window);
  inkWindow = window;
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  window.setContentProtection(true);
  window.on('closed', () => {
    unbindRole();
    if (inkWindow === window) inkWindow = null;
  });
  void window.loadURL(desktopInkRendererUrl());
  return window;
}

function applyInkWindowSettings(window: BrowserWindow): void {
  const passThrough = inkSettings.pointerPolicy === 'pass-through';
  window.setIgnoreMouseEvents(passThrough, { forward: true });
  window.setFocusable(!passThrough);
  if (passThrough) window.showInactive();
  else window.show();
}

function desktopInkRendererUrl(): string {
  const rendererUrl = new URL(rendererBaseUrl());
  rendererUrl.pathname = '/desktop-ink';
  rendererUrl.search = '';
  rendererUrl.hash = '';
  return rendererUrl.toString();
}

function createOrMoveTeleprompterWindow(): BrowserWindow {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (teleprompterWindow && !teleprompterWindow.isDestroyed()) {
    teleprompterWindow.setBounds(resolveDesktopTeleprompterBounds(display, 'compact'), false);
    return teleprompterWindow;
  }
  const preload = path.join(__dirname, 'preload.js');
  const window = new BrowserWindow(createDesktopTeleprompterWindowOptions(preload, display));
  const unbindRole = bindDesktopRendererRole(desktopRendererRoles, window.webContents, 'teleprompter');
  configureTrustedNavigation(window);
  teleprompterWindow = window;
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  window.setContentProtection(true);
  window.on('closed', () => {
    unbindRole();
    if (teleprompterWindow === window) teleprompterWindow = null;
  });
  const rendererUrl = new URL(rendererBaseUrl());
  rendererUrl.pathname = '/notch';
  rendererUrl.search = '';
  rendererUrl.hash = '';
  void window.loadURL(rendererUrl.toString());
  return window;
}

function applyTeleprompterVisibility(): void {
  if (!teleprompterState.visible) {
    teleprompterWindow?.hide();
    return;
  }
  createOrMoveTeleprompterWindow().showInactive();
}

function broadcastTeleprompterState(): void {
  for (const window of [mainWindow, teleprompterWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(DESKTOP_IPC_CHANNELS.teleprompterStateChanged, teleprompterState);
    }
  }
}

function desktopInkState(): DesktopInkSettings & {
  visible: boolean;
  windowID?: number;
  recordingActive: boolean;
  recordingId: string | null;
  paused: boolean;
} {
  return {
    ...inkSettings,
    visible: inkWindow?.isDestroyed() === false && inkWindow.isVisible(),
    windowID: privateOverlayWindowIDs()[0],
    recordingActive: activeNativeCapture !== null,
    recordingId: activeNativeCapture?.recordingId ?? null,
    paused: activeNativeCapture !== null
      && (activeNativeCapture.pausePending || activeNativeCapture.pauseStartedUnixMs !== null),
  };
}

function broadcastInkSettings(): void {
  const state = desktopInkState();
  for (const window of [mainWindow, inkWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(DESKTOP_IPC_CHANNELS.inkSettingsChanged, state);
    }
  }
}

async function requestInkWindowFlush(): Promise<void> {
  if (!inkWindow || inkWindow.isDestroyed() || !inkWindow.isVisible() || !activeNativeCapture) return;
  const requestId = randomUUID();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      pendingInkFlushes.delete(requestId);
      resolve();
    }, 2_000);
    pendingInkFlushes.set(requestId, () => {
      clearTimeout(timeout);
      resolve();
    });
    inkWindow?.webContents.send(DESKTOP_IPC_CHANNELS.inkFlushRequested, { requestId });
  });
}

function privateOverlayWindowIDs(): number[] {
  const ids: number[] = [];
  for (const window of [inkWindow, teleprompterWindow]) {
    if (!window || window.isDestroyed() || !window.isVisible()) continue;
    try { ids.push(parseDesktopWindowMediaSourceId(window.getMediaSourceId())); }
    catch { /* best-effort exclusion */ }
  }
  return ids;
}

function objectPayload(payload: unknown, errorCode: string): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(errorCode);
  return payload as Record<string, unknown>;
}

function requiredSafeInteger(value: unknown, errorCode: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(errorCode);
  return value as number;
}

function createMainWindow(): BrowserWindow {
  const preload = path.join(__dirname, 'preload.js');
  const window = new BrowserWindow(createDesktopWindowOptions(preload));
  const unbindRole = bindDesktopRendererRole(desktopRendererRoles, window.webContents, 'main');
  const rendererUrl = rendererBaseUrl();

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    unbindRole();
    if (mainWindow === window) mainWindow = null;
  });
  configureTrustedNavigation(window);
  void window.loadURL(rendererUrl);
  return window;
}

void app.whenReady().then(() => {
  directorJobs = new DesktopDirectorJobService({
    videosDirectory: app.getPath('videos'),
    isCaptureActive: () => nativeCaptureStarting || activeNativeCapture !== null,
    recoverProject: async (projectRoot) => (await requireNativeHelper()).recoverProject(projectRoot),
    validateProject: async (projectRoot) => (await requireNativeHelper()).validateProject(projectRoot),
  });
  registerNativeMediaProtocol();
  registerTeachingAssetProtocol();
  registerDesktopIpc();
  nativeHelperInitialization = initializeNativeHelper().catch((error: unknown) => {
    nativeHelper?.close();
    nativeHelper = null;
    nativeHelperHandshake = null;
    console.error('[desktop] native helper unavailable', error);
  });
  mainWindow = createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on('before-quit', () => {
  nativeCaptureStarting = false;
  activeNativeCapture = null;
  for (const resolve of pendingInkFlushes.values()) resolve();
  pendingInkFlushes.clear();
  inkWindow?.destroy();
  inkWindow = null;
  teleprompterWindow?.destroy();
  teleprompterWindow = null;
  desktopRendererRoles.clear();
  for (const entry of teachingAssetCache.values()) void entry.asset.fileHandle?.close();
  teachingAssetCache.clear();
  for (const entry of overflowTeachingAssetLeases.values()) void entry.asset.fileHandle?.close();
  overflowTeachingAssetLeases.clear();
  nativeHelper?.close();
  nativeHelper = null;
  nativeHelperHandshake = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
