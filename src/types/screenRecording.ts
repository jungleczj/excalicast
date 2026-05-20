export type RecordingKind = 'scene_replay' | 'screen_capture';

export type RecordingStatus = 'recording' | 'done' | 'error';

export interface ScreenRecordingMetadata {
  id: string;
  kind: 'screen_capture';
  startedAt: number;        // Unix ms
  durationMs: number;
  output: { width: number; height: number };
  hasMic: boolean;
  hasSystemAudio: boolean;
  hasCamera: boolean;
  thumbnail?: string;       // base64 data URL, generated at stop
  status: RecordingStatus;
  title?: string;
  // The recorded webm is the union of all `screenChunks` rows ordered by `index`.
  // We do NOT store the watermark state here — watermark is decided at download.
}

export interface ScreenRecordingChunk {
  id?: number;              // dexie auto-pk
  recordingId: string;
  index: number;            // ordering
  blob: Blob;               // ~1s webm slice
}
