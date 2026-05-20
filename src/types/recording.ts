export interface PaidRecordingRow {
  recording_id: string;
  paid_at: number;
  amount_cents: number;
  currency: string;
  paddle_transaction_id: string;
  raw_payload: string;
}

export interface IsPaidRequest {
  recordingId: string;
}

export interface IsPaidResponse {
  paid: boolean;
}

export interface WhiteboardSnapshot {
  timestamp: number;
  elements: unknown[];
  appState: Record<string, unknown>;
}

/**
 * RecordingMetadata：与上一版相比，去掉 width/height/fps（这些移到导出阶段决定）。
 * 新增 lastFrameThumbnail（库视图用）。schema v2。
 */
export interface RecordingMetadata {
  id: string;
  startedAt: number;
  durationMs: number;
  hasAudio: boolean;
  hasCamera: boolean;
  status: 'recording' | 'done' | 'error';
  lastFrameThumbnail?: string;
  title?: string;
  subtitleSrt?: string;
}

export interface AudioChunk {
  recordingId: string;
  index: number;
  blob: Blob;
}

export interface CameraChunk {
  recordingId: string;
  index: number;
  blob: Blob;
}

export interface BinaryFileEntry {
  recordingId: string;
  fileId: string;
  data: unknown;
}

// ----- 导出配置 -----

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

export const ASPECT_PRESETS: Record<AspectRatio, { width: number; height: number; label: string }> = {
  '16:9': { width: 1280, height: 720, label: '16:9' },
  '9:16': { width: 720, height: 1280, label: '9:16' },
  '1:1':  { width: 960, height: 960,  label: '1:1' },
  '4:5':  { width: 864, height: 1080, label: '4:5' },
};

export type CroppingMode = 'follow_viewport' | 'fit_all_content';

export interface ExportConfig {
  aspectRatio: AspectRatio;
  croppingMode: CroppingMode;
  fps: number;
  withWatermark: boolean;
  burnSubtitles?: boolean;
  includeWorkspaceShell?: boolean;
}

export interface ShellCanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShellSize {
  width: number;
  height: number;
}

export interface WorkspaceShellRow {
  id?: number;
  recordingId: string;
  timestamp: number;
  png: Blob;
  canvasRect: ShellCanvasRect;
  shellSize: ShellSize;
  hash: string;
}

export interface SubtitleCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

// Screen-capture types — separate file to keep the old scene-replay types isolated.
export type { RecordingKind, RecordingStatus, ScreenRecordingMetadata, ScreenRecordingChunk } from './screenRecording';

export interface SceneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
