export type DesktopFeatureId =
  | 'whiteboard.excalidraw-full'
  | 'recording.all-sources'
  | 'recording.camera-layouts'
  | 'recording.framing-backgrounds'
  | 'project.library-cloud-share'
  | 'editor.timeline-multirecording'
  | 'editor.autozoom-highlight-keypoints'
  | 'editor.captions-audio-repair-dubbing'
  | 'editor.ratios-export'
  | 'teleprompter.smart-readalong'
  | 'chatcut.assisted-editing';

export type DesktopFeatureImplementation = 'shared' | 'web-adapter' | 'desktop-native' | 'omitted';

export type DesktopDirectorJobPhase = 'pending' | 'generating' | 'ready' | 'failed';

export interface DesktopDirectorCheckpointReference {
  owner: 'recording-manifest';
  reference: 'director/current.json';
  checkpointId: string;
}

export interface DesktopDirectorJobEvidence {
  profile: 'Balanced';
  speechActivity: 'unavailable';
  speechIntervalCount: 0;
  preservedMedia: true;
  recoveredCheckpoint: boolean;
  durationUs?: number;
  observedEndUs?: number;
  durationSource?: 'native-manifest-segments' | 'native-validation-continuity';
  manifestState?: 'ready' | 'interrupted' | 'unknown';
  telemetrySegmentsRead?: number;
  telemetryBytesRead?: number;
  maximumSegmentBytesRead?: number;
  eventCount?: number;
  retainedPlannerEventCount?: number;
  roiObservationCount?: number;
}

export interface DesktopDirectorJobStatus {
  recordingId: string;
  status: DesktopDirectorJobPhase;
  code: string;
  retryable: boolean;
  checkpoint?: DesktopDirectorCheckpointReference;
  evidence: DesktopDirectorJobEvidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalSafeInteger(value: unknown, minimum: number): boolean {
  return value === undefined || (Number.isSafeInteger(value) && (value as number) >= minimum);
}

export function isDesktopDirectorJobStatus(value: unknown): value is DesktopDirectorJobStatus {
  if (!isRecord(value)
    || typeof value.recordingId !== 'string'
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.recordingId)
    || !['pending', 'generating', 'ready', 'failed'].includes(value.status as string)
    || typeof value.code !== 'string'
    || !value.code.startsWith('director_')
    || typeof value.retryable !== 'boolean'
    || !isRecord(value.evidence)
    || value.evidence.profile !== 'Balanced'
    || value.evidence.speechActivity !== 'unavailable'
    || value.evidence.speechIntervalCount !== 0
    || value.evidence.preservedMedia !== true
    || typeof value.evidence.recoveredCheckpoint !== 'boolean'
    || !isOptionalSafeInteger(value.evidence.durationUs, 1)
    || !isOptionalSafeInteger(value.evidence.observedEndUs, 1)
    || (value.evidence.durationSource !== undefined
      && value.evidence.durationSource !== 'native-manifest-segments'
      && value.evidence.durationSource !== 'native-validation-continuity')
    || (value.evidence.manifestState !== undefined
      && value.evidence.manifestState !== 'ready'
      && value.evidence.manifestState !== 'interrupted'
      && value.evidence.manifestState !== 'unknown')
    || !isOptionalSafeInteger(value.evidence.telemetrySegmentsRead, 0)
    || !isOptionalSafeInteger(value.evidence.telemetryBytesRead, 0)
    || !isOptionalSafeInteger(value.evidence.maximumSegmentBytesRead, 0)
    || !isOptionalSafeInteger(value.evidence.eventCount, 0)
    || !isOptionalSafeInteger(value.evidence.retainedPlannerEventCount, 0)
    || !isOptionalSafeInteger(value.evidence.roiObservationCount, 0)) return false;
  const hasAnyDurationEvidence = value.evidence.durationUs !== undefined
    || value.evidence.observedEndUs !== undefined
    || value.evidence.durationSource !== undefined;
  if (hasAnyDurationEvidence && (value.evidence.durationUs === undefined
    || value.evidence.observedEndUs === undefined
    || value.evidence.durationSource === undefined)) return false;
  if (value.checkpoint !== undefined) {
    if (!isRecord(value.checkpoint)
      || value.checkpoint.owner !== 'recording-manifest'
      || value.checkpoint.reference !== 'director/current.json'
      || typeof value.checkpoint.checkpointId !== 'string'
      || !/^director-[a-f0-9]{64}$/.test(value.checkpoint.checkpointId)) return false;
  }
  if (value.status === 'pending') {
    return value.code === 'director_job_pending' && value.retryable === false && value.checkpoint === undefined;
  }
  if (value.status === 'generating') {
    return value.code === 'director_job_generating' && value.retryable === false && value.checkpoint === undefined;
  }
  if (value.status === 'ready') {
    return value.code === 'director_job_ready' && value.retryable === false && value.checkpoint !== undefined;
  }
  return value.checkpoint === undefined;
}

export interface DesktopFeatureMigration {
  id: DesktopFeatureId;
  desktop: DesktopFeatureImplementation;
  owner: 'editor-ui' | 'project-schema' | 'recording-domain' | 'mac-media-engine' | 'chatcut-contract';
}

/**
 * This list is an executable release gate: a browser capability cannot ship on
 * macOS until it has an explicit shared or native implementation owner.
 */
export const DESKTOP_FEATURE_MIGRATION_MATRIX: readonly DesktopFeatureMigration[] = [
  { id: 'whiteboard.excalidraw-full', desktop: 'shared', owner: 'editor-ui' },
  { id: 'recording.all-sources', desktop: 'desktop-native', owner: 'mac-media-engine' },
  { id: 'recording.camera-layouts', desktop: 'shared', owner: 'recording-domain' },
  { id: 'recording.framing-backgrounds', desktop: 'shared', owner: 'recording-domain' },
  { id: 'project.library-cloud-share', desktop: 'web-adapter', owner: 'project-schema' },
  { id: 'editor.timeline-multirecording', desktop: 'shared', owner: 'editor-ui' },
  { id: 'editor.autozoom-highlight-keypoints', desktop: 'shared', owner: 'editor-ui' },
  { id: 'editor.captions-audio-repair-dubbing', desktop: 'shared', owner: 'editor-ui' },
  { id: 'editor.ratios-export', desktop: 'shared', owner: 'editor-ui' },
  { id: 'teleprompter.smart-readalong', desktop: 'shared', owner: 'editor-ui' },
  { id: 'chatcut.assisted-editing', desktop: 'shared', owner: 'chatcut-contract' },
] as const;

export const DESKTOP_IPC_CHANNELS = {
  capturePreflight: 'capture.preflight.v1',
  captureSources: 'capture.sources.v1',
  captureDevices: 'capture.devices.v1',
  capturePermissions: 'capture.permissions.v1',
  captureRequestPermissions: 'capture.request-permissions.v1',
  captureStart: 'capture.start.v1',
  captureStop: 'capture.stop.v1',
  capturePause: 'capture.pause.v1',
  captureResume: 'capture.resume.v1',
  captureSetMicrophoneMuted: 'capture.microphone-muted.v1',
  captureSetSystemAudioMuted: 'capture.system-audio-muted.v1',
  captureSetCameraVisibility: 'capture.camera-visibility.v1',
  captureSetCameraHardware: 'capture.camera-hardware.v1',
  captureStatus: 'capture.status.v1',
  inkSetMode: 'ink.set-mode.v1',
  inkSetOpacity: 'ink.set-opacity.v1',
  inkGetSettings: 'ink.get-settings.v1',
  inkSettingsChanged: 'ink.settings-changed.v1',
  inkAppendEvents: 'ink.append-events.v1',
  inputTelemetryAppend: 'input-telemetry.append-producer-events.v1',
  inkFlushRequested: 'ink.flush-requested.v1',
  inkFlushComplete: 'ink.flush-complete.v1',
  cameraSetLayout: 'camera.set-layout.v1',
  teleprompterConfigure: 'teleprompter.configure.v1',
  teleprompterSetMode: 'teleprompter.set-mode.v1',
  teleprompterGetState: 'teleprompter.get-state.v1',
  teleprompterStateChanged: 'teleprompter.state-changed.v1',
  projectRecover: 'project.recover.v1',
  projectValidate: 'project.validate.v1',
  projectDirectorStatus: 'project.director-status.v1',
  projectDirectorRetry: 'project.director-retry.v1',
  projectReadMediaSegment: 'project.read-media-segment.v1',
  projectReadInkEvents: 'project.read-ink-events.v1',
  projectReadTeachingCompositionExport: 'project.read-teaching-composition-export.v1',
  renderPreview: 'render.preview.v1',
  renderExport: 'render.export.v1',
} as const;

export interface DesktopInkSettingsInput {
  mode: 'ink' | 'full-board';
  backgroundOpacity: number;
  inkOpacity: number;
  pointerPolicy: 'draw' | 'pass-through';
}

export interface DesktopInkSettings extends DesktopInkSettingsInput {
  engine: 'excalidraw';
  toolSurface: 'full';
}

export interface DesktopInkRuntimeState extends DesktopInkSettings {
  visible: boolean;
  windowID?: number;
  recordingActive: boolean;
  recordingId: string | null;
  paused: boolean;
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export function normalizeDesktopInkSettings(input: DesktopInkSettingsInput): DesktopInkSettings {
  return {
    engine: 'excalidraw',
    toolSurface: 'full',
    mode: input.mode,
    backgroundOpacity: clampOpacity(input.backgroundOpacity),
    inkOpacity: clampOpacity(input.inkOpacity),
    pointerPolicy: input.pointerPolicy,
  };
}

export function mergeDesktopInkSettings(
  current: DesktopInkSettingsInput,
  patch: Partial<DesktopInkSettingsInput>,
): DesktopInkSettings {
  return normalizeDesktopInkSettings({ ...current, ...patch });
}
