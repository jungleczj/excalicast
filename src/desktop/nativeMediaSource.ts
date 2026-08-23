import type { NativeRecordingProjectReference } from '@/types/recording';

export type NativeMediaTrack = 'screen' | 'camera' | 'microphone' | 'system-audio';

export interface NativeMediaSources {
  screen: string | null;
  camera: string | null;
  microphone: string | null;
  systemAudio: string | null;
}

export function nativeRecordingMediaUrl(recordingId: string, track: NativeMediaTrack): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recordingId)) throw new Error('native_media_recording_id_invalid');
  return `excalicast-media://project/${recordingId}/${track}`;
}

export function nativeMediaSources(
  project: NativeRecordingProjectReference | undefined,
  adapterAvailable = true,
): NativeMediaSources | null {
  if (!adapterAvailable || !project || project.exportStatus !== 'ready') return null;
  const has = (track: NativeMediaTrack) => (project.tracks?.[track]?.length ?? 0) > 0;
  return {
    screen: has('screen') ? nativeRecordingMediaUrl(project.recordingId, 'screen') : null,
    camera: has('camera') ? nativeRecordingMediaUrl(project.recordingId, 'camera') : null,
    microphone: has('microphone') ? nativeRecordingMediaUrl(project.recordingId, 'microphone') : null,
    systemAudio: has('system-audio') ? nativeRecordingMediaUrl(project.recordingId, 'system-audio') : null,
  };
}
