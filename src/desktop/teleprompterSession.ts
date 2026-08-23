export type DesktopTeleprompterRecognitionStatus =
  | 'idle'
  | 'loading'
  | 'listening'
  | 'fallback'
  | 'error';

export interface DesktopTeleprompterConfiguration {
  schemaVersion: 1;
  visible: boolean;
  script: string;
  language: 'auto' | 'zh' | 'en';
  mode: 'smart-readalong' | 'constant-speed';
  dock: 'notch' | 'menu-bar-center' | 'floating';
  microphoneSource: 'recording-session-pcm';
  fallback: 'constant-speed';
  excludeFromCapture: true;
  speed: number;
  fontSize: number;
  opacity: number;
}

export interface DesktopTeleprompterState extends DesktopTeleprompterConfiguration {
  currentWord: number;
  recognitionStatus: DesktopTeleprompterRecognitionStatus;
  heard: string;
}

export type DesktopTeleprompterAudioRole =
  | 'publisher-shared-stream'
  | 'subscriber-display-only'
  | 'browser-own-stream';

export function resolveDesktopTeleprompterAudioRole(input: {
  embedded: boolean;
  desktopBridge: boolean;
  hasRecordingStream: boolean;
}): DesktopTeleprompterAudioRole {
  if (input.desktopBridge && input.embedded) return 'subscriber-display-only';
  if (input.desktopBridge && input.hasRecordingStream) return 'publisher-shared-stream';
  return 'browser-own-stream';
}

export function createDesktopTeleprompterState(): DesktopTeleprompterState {
  return {
    schemaVersion: 1,
    visible: false,
    script: '',
    language: 'auto',
    mode: 'smart-readalong',
    dock: 'notch',
    microphoneSource: 'recording-session-pcm',
    fallback: 'constant-speed',
    excludeFromCapture: true,
    speed: 4,
    fontSize: 28,
    opacity: 0.92,
    currentWord: -1,
    recognitionStatus: 'idle',
    heard: '',
  };
}

export function configureDesktopTeleprompter(
  current: DesktopTeleprompterState,
  input: DesktopTeleprompterConfiguration,
): DesktopTeleprompterState {
  validateConfiguration(input);
  return {
    ...current,
    ...input,
    script: input.script.slice(0, 100_000),
    speed: clamp(input.speed, 1, 10),
    fontSize: clamp(input.fontSize, 20, 48),
    opacity: clamp(input.opacity, 0.3, 1),
    currentWord: input.script === current.script ? current.currentWord : -1,
    recognitionStatus: input.script === current.script ? current.recognitionStatus : 'idle',
    heard: input.script === current.script ? current.heard : '',
  };
}

export function applyDesktopTeleprompterProgress(
  current: DesktopTeleprompterState,
  progress: {
    currentWord: number;
    recognitionStatus: DesktopTeleprompterRecognitionStatus;
    heard?: string;
  },
): DesktopTeleprompterState {
  if (!Number.isSafeInteger(progress.currentWord) || progress.currentWord < -1) {
    throw new Error('desktop_teleprompter_progress_invalid');
  }
  return {
    ...current,
    currentWord: progress.currentWord,
    recognitionStatus: progress.recognitionStatus,
    heard: (progress.heard ?? '').slice(-120),
  };
}

function validateConfiguration(input: DesktopTeleprompterConfiguration): void {
  if (input.schemaVersion !== 1) throw new Error('desktop_teleprompter_schema_invalid');
  if (input.microphoneSource !== 'recording-session-pcm') {
    throw new Error('desktop_teleprompter_microphone_invalid');
  }
  if (input.excludeFromCapture !== true || input.fallback !== 'constant-speed') {
    throw new Error('desktop_teleprompter_capture_policy_invalid');
  }
  if (typeof input.script !== 'string'
    || !['auto', 'zh', 'en'].includes(input.language)
    || !['smart-readalong', 'constant-speed'].includes(input.mode)
    || !['notch', 'menu-bar-center', 'floating'].includes(input.dock)
    || ![input.speed, input.fontSize, input.opacity].every(Number.isFinite)) {
    throw new Error('desktop_teleprompter_configuration_invalid');
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
