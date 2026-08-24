'use client';

import type { RecordingSetupConfig, RecordingSourceConfig } from '@/types/recording';
import {
  startDesktopAiCameraSession,
  type DesktopAiCameraSession,
  type DesktopAiCameraSource,
  type DesktopCaptureBridge,
} from './aiCameraSession';
import { DESKTOP_IPC_CHANNELS } from './productContract';

export interface DesktopCaptureSources {
  displays: Array<{ displayID: number; width: number; height: number }>;
  windows: Array<{
    windowID: number;
    title: string;
    applicationName: string;
    width: number;
    height: number;
  }>;
}

export type DesktopRecordingStartResult<TBrowserSession> =
  | { pipeline: 'native'; session: DesktopAiCameraSession }
  | { pipeline: 'browser'; session: TBrowserSession };

interface StartDesktopRecordingFromSetupInput<TBrowserSession> {
  bridge?: DesktopCaptureBridge;
  recordingId: string;
  setup: RecordingSetupConfig;
  displayStream: MediaStream | null;
  microphoneStream: MediaStream | null;
  cameraStream: MediaStream | null;
  startBrowser(): Promise<TBrowserSession>;
}

function captureSources(value: unknown): DesktopCaptureSources {
  if (!value || typeof value !== 'object') throw new Error('desktop_capture_sources_invalid');
  const sources = value as DesktopCaptureSources;
  if (!Array.isArray(sources.displays) || !Array.isArray(sources.windows)) {
    throw new Error('desktop_capture_sources_invalid');
  }
  return sources;
}

function mediaSourceID(label: string, kind: 'screen' | 'window'): number | undefined {
  const match = new RegExp(`^${kind}:(\\d+):\\d+$`).exec(label);
  if (!match) return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id >= 0 ? id : undefined;
}

function exactDimensions(
  stream: MediaStream,
): { width: number; height: number } | undefined {
  const settings = stream.getVideoTracks()[0]?.getSettings?.();
  if (!settings || typeof settings.width !== 'number' || typeof settings.height !== 'number') return undefined;
  return { width: settings.width, height: settings.height };
}

function oneOrExplicitError<T>(matches: readonly T[]): T {
  if (matches.length === 1) return matches[0];
  throw new Error(matches.length === 0
    ? 'desktop_native_source_not_found'
    : 'desktop_native_source_ambiguous');
}

export function isDesktopNativeCaptureSetup(setup: RecordingSetupConfig): boolean {
  return setup.source?.kind === 'desktop' || setup.source?.kind === 'window';
}

export function resolveDesktopAiCameraSource(
  source: RecordingSourceConfig,
  stream: MediaStream,
  sources: DesktopCaptureSources,
): DesktopAiCameraSource {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('desktop_native_display_preview_required');
  const dimensions = exactDimensions(stream);

  if (source.kind === 'desktop') {
    const labelID = mediaSourceID(track.label, 'screen');
    if (labelID !== undefined) {
      const display = sources.displays.find((candidate) => candidate.displayID === labelID);
      if (!display) throw new Error('desktop_native_source_not_found');
      return { kind: 'display', id: display.displayID, width: display.width, height: display.height };
    }
    const dimensionMatches = dimensions
      ? sources.displays.filter((candidate) => candidate.width === dimensions.width && candidate.height === dimensions.height)
      : [];
    const display = dimensionMatches.length > 0
      ? oneOrExplicitError(dimensionMatches)
      : oneOrExplicitError(sources.displays);
    return { kind: 'display', id: display.displayID, width: display.width, height: display.height };
  }

  if (source.kind === 'window') {
    const labelID = mediaSourceID(track.label, 'window');
    if (labelID !== undefined) {
      const window = sources.windows.find((candidate) => candidate.windowID === labelID);
      if (!window) throw new Error('desktop_native_source_not_found');
      return { kind: 'window', id: window.windowID, width: window.width, height: window.height };
    }
    const titleMatches = track.label
      ? sources.windows.filter((candidate) => candidate.title === track.label)
      : [];
    const dimensionMatches = dimensions
      ? sources.windows.filter((candidate) => candidate.width === dimensions.width && candidate.height === dimensions.height)
      : [];
    const window = titleMatches.length > 0
      ? oneOrExplicitError(titleMatches)
      : dimensionMatches.length > 0
        ? oneOrExplicitError(dimensionMatches)
        : oneOrExplicitError(sources.windows);
    return { kind: 'window', id: window.windowID, width: window.width, height: window.height };
  }

  throw new Error('desktop_native_source_unsupported');
}

function stopPreviewStreams(streams: Array<MediaStream | null>): void {
  const stopped = new Set<MediaStreamTrack>();
  for (const stream of streams) {
    for (const track of stream?.getTracks() ?? []) {
      if (stopped.has(track)) continue;
      stopped.add(track);
      track.stop();
    }
  }
}

/**
 * Selects exactly one renderer recording pipeline.
 *
 * Browser and browser-only source behavior stays delegated to the existing
 * callback. Eligible Electron display/window captures stop their browser
 * preview tracks before native capture starts, so a native failure can never
 * leave a hidden MediaRecorder running or silently start a second recorder.
 */
export async function startDesktopRecordingFromSetup<TBrowserSession>(
  input: StartDesktopRecordingFromSetupInput<TBrowserSession>,
): Promise<DesktopRecordingStartResult<TBrowserSession>> {
  if (!input.bridge || !isDesktopNativeCaptureSetup(input.setup)) {
    return { pipeline: 'browser', session: await input.startBrowser() };
  }

  const source = input.setup.source;
  if (!source || !input.displayStream) throw new Error('desktop_native_display_preview_required');
  const available = captureSources(await input.bridge.invoke(DESKTOP_IPC_CHANNELS.captureSources));
  const nativeSource = resolveDesktopAiCameraSource(source, input.displayStream, available);
  const cameraSettings = input.cameraStream?.getVideoTracks()[0]?.getSettings?.() ?? {};

  stopPreviewStreams([input.displayStream, input.microphoneStream, input.cameraStream]);

  const session = await startDesktopAiCameraSession({
    bridge: input.bridge,
    recordingId: input.recordingId,
    source: nativeSource,
    captureSystemAudio: source.captureSystemAudio === true,
    // RecordingSetup currently has an always-on microphone row. Preserve that
    // product configuration even if the browser preview could not acquire it;
    // native permission/device checks remain authoritative.
    captureMicrophone: true,
    camera: {
      enabled: input.setup.camera.enabled,
      ...(typeof cameraSettings.width === 'number' ? { width: cameraSettings.width } : {}),
      ...(typeof cameraSettings.height === 'number' ? { height: cameraSettings.height } : {}),
      ...(typeof cameraSettings.frameRate === 'number' ? { framesPerSecond: cameraSettings.frameRate } : {}),
    },
    screenFramesPerSecond: Math.min(30, source.sourceSize?.frameRate ?? 30),
    teachingRecipe: input.setup.teachingRecipe,
  });
  return { pipeline: 'native', session };
}
