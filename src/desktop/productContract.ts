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
  projectReadMediaSegment: 'project.read-media-segment.v1',
  projectReadInkEvents: 'project.read-ink-events.v1',
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
