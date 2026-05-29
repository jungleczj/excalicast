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

/**
 * 摄像头气泡位置随录制时间的变化。坐标以工作区 shell 的当前尺寸为基准
 * 存成 0..1 的比例，避免和窗口像素或导出分辨率耦合。
 *
 * hidden=true 表示这段时间气泡被用户软关闭（mute）—— 回放和导出都不画。
 */
export interface CameraPositionEvent {
  recordingId: string;
  timestamp: number;  // ms relative to recording start
  rx: number;         // bubble top-left X as fraction of shell width
  ry: number;         // bubble top-left Y as fraction of shell height
  rs: number;         // bubble edge length as fraction of shell width
  hidden?: boolean;   // 软关闭标记；缺省视为 false
}

export interface BinaryFileEntry {
  recordingId: string;
  fileId: string;
  data: unknown;
}

/**
 * 激光笔轨迹事件。坐标用 scene 坐标系（不是 viewport / screen），
 * 渲染时按导出的 sceneSourceRect→dest 或回放的 (x+scroll)*zoom 变换。
 * button=='down' 表示用户正在按住绘制；'up' 表示松手。
 * 跨"up→down"的两段不连线，画一段独立 polyline。
 */
export interface LaserEvent {
  recordingId: string;
  timestamp: number;   // ms relative to recording start
  x: number;           // scene X
  y: number;           // scene Y
  button: 'down' | 'up';
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

export interface SceneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
