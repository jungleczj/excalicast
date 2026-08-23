import { DESKTOP_IPC_CHANNELS } from './productContract';
import {
  DesktopInkReplay,
  parseNativeInkEventSegments,
  type NativeInkEventSegmentInput,
} from './inkReplay';

interface DesktopInvokeBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

export async function loadDesktopInkReplay(
  recordingId: string,
  bridge: DesktopInvokeBridge | undefined = typeof window === 'undefined'
    ? undefined
    : window.excalicastDesktop,
): Promise<DesktopInkReplay | null> {
  if (!bridge) return null;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recordingId)) {
    throw new Error('desktop_ink_replay_recording_invalid');
  }
  const response = await bridge.invoke(DESKTOP_IPC_CHANNELS.projectReadInkEvents, { recordingId });
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('desktop_ink_replay_response_invalid');
  }
  const segments = (response as Record<string, unknown>).segments;
  if (!Array.isArray(segments) || !segments.every(isNativeInkEventSegment)) {
    throw new Error('desktop_ink_replay_response_invalid');
  }
  return new DesktopInkReplay(parseNativeInkEventSegments(segments));
}

function isNativeInkEventSegment(value: unknown): value is NativeInkEventSegmentInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const segment = value as Record<string, unknown>;
  return typeof segment.startUs === 'number' && Number.isFinite(segment.startUs)
    && typeof segment.payload === 'string';
}
