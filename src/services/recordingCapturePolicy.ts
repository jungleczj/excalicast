import type {
  CapturePipeline,
  CapturePressureSnapshot,
  CaptureProfile,
  CaptureProfileSettings,
  RecordingSourceKind,
} from '@/types/recording';

export interface BrowserCaptureCapabilities {
  videoEncoder: boolean;
  trackProcessor: boolean;
  opfs: boolean;
  worker: boolean;
}

export function selectCapturePipeline(capabilities: BrowserCaptureCapabilities): CapturePipeline {
  return capabilities.videoEncoder
    && capabilities.trackProcessor
    && capabilities.opfs
    && capabilities.worker
    ? 'webcodecs-opfs'
    : 'mediarecorder-fallback';
}

export function detectBrowserCaptureCapabilities(): BrowserCaptureCapabilities {
  return {
    videoEncoder: typeof VideoEncoder !== 'undefined',
    trackProcessor: typeof globalThis !== 'undefined' && 'MediaStreamTrackProcessor' in globalThis,
    opfs: typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function',
    worker: typeof Worker !== 'undefined',
  };
}

export type CapturePressureLevel = 'A' | 'B' | 'C' | 'D';
export type CapturePressureDecision = {
  action: 'none' | 'degrade' | 'stop';
  level: CapturePressureLevel;
};

const LEVELS: CapturePressureLevel[] = ['A', 'B', 'C', 'D'];

function isUnderPressure(snapshot: CapturePressureSnapshot): boolean {
  return snapshot.encoderQueueSize > 2
    || snapshot.pendingWriteBytes >= 16 * 1024 * 1024
    || snapshot.oldestWriteAgeMs >= 500
    || snapshot.mainThreadLagMs >= 50;
}

export class CapturePressureController {
  private level: CapturePressureLevel;
  private pressureStartedAt: number | null = null;

  constructor(initialLevel: CapturePressureLevel = 'A') {
    this.level = initialLevel;
  }

  observe(snapshot: CapturePressureSnapshot, now = performance.now()): CapturePressureDecision {
    if (!isUnderPressure(snapshot)) {
      this.pressureStartedAt = null;
      return { action: 'none', level: this.level };
    }
    this.pressureStartedAt ??= now;
    const pressureDuration = now - this.pressureStartedAt;
    if (this.level === 'D') {
      if (pressureDuration > 10_000) return { action: 'stop', level: this.level };
      return { action: 'none', level: this.level };
    }
    if (pressureDuration <= 1_000) return { action: 'none', level: this.level };

    this.level = LEVELS[Math.min(LEVELS.indexOf(this.level) + 1, LEVELS.length - 1)];
    this.pressureStartedAt = null;
    return { action: 'degrade', level: this.level };
  }
}

const ADAPTIVE_MAX_WIDTH = 2560;
const ADAPTIVE_MAX_HEIGHT = 1440;
const MOTION_MAX_WIDTH = 1920;
const MOTION_MAX_HEIGHT = 1080;

function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: even(width * scale),
    height: even(height * scale),
  };
}

function bitrateFor(width: number, height: number, frameRate: number): number {
  if (frameRate >= 60) return 16_000_000;
  if (width > 1920 || height > 1080) return 14_000_000;
  if (width >= 1920 || height >= 1080) return 8_000_000;
  return 5_000_000;
}

export function captureProfileFor(
  source: { width: number; height: number; frameRate?: number },
  profile: CaptureProfile,
): CaptureProfileSettings {
  const motion = profile === 'motion-60';
  const size = fitWithin(
    Math.max(2, source.width),
    Math.max(2, source.height),
    motion ? MOTION_MAX_WIDTH : ADAPTIVE_MAX_WIDTH,
    motion ? MOTION_MAX_HEIGHT : ADAPTIVE_MAX_HEIGHT,
  );
  const frameRate = motion ? Math.min(60, Math.max(24, source.frameRate ?? 60)) : 30;
  return {
    ...size,
    frameRate,
    videoBitsPerSecond: bitrateFor(size.width, size.height, frameRate),
  };
}

export function fallbackCaptureProfile(
  source: { width: number; height: number },
): CaptureProfileSettings {
  const size = fitWithin(Math.max(2, source.width), Math.max(2, source.height), 1920, 1080);
  return { ...size, frameRate: 24, videoBitsPerSecond: 8_000_000 };
}

export function preferredVideoEncoderConfigs(
  profile: CaptureProfileSettings,
): VideoEncoderConfig[] {
  const common = {
    width: profile.width,
    height: profile.height,
    bitrate: profile.videoBitsPerSecond,
    framerate: profile.frameRate,
    hardwareAcceleration: 'prefer-hardware' as const,
    latencyMode: 'realtime' as const,
    bitrateMode: 'variable' as const,
    alpha: 'discard' as const,
  };
  return [
    { ...common, codec: 'avc1.640033', avc: { format: 'avc' } },
    { ...common, codec: 'avc1.4d0033', avc: { format: 'avc' } },
    { ...common, codec: 'vp09.00.50.08' },
    { ...common, codec: 'vp8' },
  ];
}

export function shouldUseDisplayCapture(kind: RecordingSourceKind): boolean {
  return kind !== 'whiteboard';
}
