import type { SceneRect, WhiteboardSnapshot } from '@/types/recording';
import type { DesktopInkReplay, DesktopInkReplayFrame } from './inkReplay';

export interface DesktopInkRenderFrame {
  snapshot: WhiteboardSnapshot;
  files: Readonly<Record<string, Record<string, unknown>>>;
  pointer?: DesktopInkReplayFrame['pointer'];
  /** Includes pointer position so frame caches cannot freeze smooth cursor motion. */
  signature: string;
}

export interface DesktopInkRenderSource {
  contentSnapshots: WhiteboardSnapshot[];
  files: Readonly<Record<string, Record<string, unknown>>>;
  hasPointerEvents: boolean;
  frameAt(timeMs: number): DesktopInkRenderFrame;
}

export function createDesktopInkRenderSource(
  replay: DesktopInkReplay,
  durationMs: number,
): DesktopInkRenderSource {
  const finalFrame = replay.frameAt(Math.max(0, durationMs) * 1_000);
  const files = finalFrame.files;
  const contentSnapshots: WhiteboardSnapshot[] = [{
    timestamp: 0,
    elements: [...replay.contentElements()],
    appState: { ...finalFrame.appState },
  }];

  return {
    contentSnapshots,
    files,
    hasPointerEvents: replay.hasPointerEvents,
    frameAt(timeMs) {
      const frame = replay.frameAt(Math.max(0, timeMs) * 1_000);
      return {
        snapshot: {
          timestamp: Math.max(0, frame.revisionUs / 1_000),
          elements: [...frame.elements],
          appState: { ...frame.appState },
        },
        files: frame.files,
        pointer: frame.pointer,
        signature: `${frame.revisionUs}|${pointerSignature(frame.pointer)}`,
      };
    },
  };
}

export function projectDesktopInkPointer(
  pointer: NonNullable<DesktopInkReplayFrame['pointer']>,
  sceneSourceRect: SceneRect,
  destination: SceneRect,
): { x: number; y: number } {
  return {
    x: destination.x + ((pointer.x - sceneSourceRect.x) / sceneSourceRect.width) * destination.width,
    y: destination.y + ((pointer.y - sceneSourceRect.y) / sceneSourceRect.height) * destination.height,
  };
}

export function resolveDesktopInkExportStyle(
  style: { backgroundOpacity?: number; inkOpacity?: number } | undefined,
  defaultBackgroundOpacity: number,
): { backgroundOpacity: number; inkOpacity: number } {
  return {
    backgroundOpacity: clampOpacity(style?.backgroundOpacity ?? defaultBackgroundOpacity),
    inkOpacity: clampOpacity(style?.inkOpacity ?? 1),
  };
}

function pointerSignature(pointer: DesktopInkReplayFrame['pointer']): string {
  if (!pointer) return 'none';
  return `${pointer.tool}:${compactNumber(pointer.x)}:${compactNumber(pointer.y)}:${pointer.phase}`;
}

function compactNumber(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}
