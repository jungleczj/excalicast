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
  /** 归属键：登录用户=user.id，匿名=每浏览器 guestId。用于本地录制库按用户隔离。
   *  v9 之前的旧录制无此字段（legacy），首次被当前用户列出时认领。 */
  ownerKey?: string;
  /** 录制前 Setup 面板锁定的画幅/摄像头/工作区配置；导出默认沿用。旧录制无此字段。 */
  setup?: RecordingSetupConfig;
  /** 录制来源。旧录制缺省为白板。 */
  source?: RecordingSourceConfig;
  /** 用户给录制打的类别标签（录制库卡片展示 + 可编辑）。 */
  tags?: string[];
  /** 时间轴保留段（ms，相对录制开始）。缺省=整段 [0,durationMs]。导出按段裁剪输出。 */
  segments?: TimeSegment[];
  /** 自动放大段（ms，相对录制开始）。 */
  autoZooms?: AutoZoomSegment[];
}

/** 保留段：导出时只输出 [start,end]（ms）内的内容，多段按序拼接。 */
export interface TimeSegment {
  start: number;
  end: number;
}

/** Auto zoom 段：在指定源时间窗口内把画面按中心点放大。 */
export interface AutoZoomSegment {
  id: string;
  start: number;
  end: number;
  scale: number;
  cx?: number;
  cy?: number;
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

export interface ScreenChunk {
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

export type AspectRatio =
  // 横屏
  | '16:9' | '4:3' | '21:9' | '16:10' | '3:2'
  // 竖屏
  | '9:16' | '4:5' | '3:4' | '2:3'
  // 方形
  | '1:1';

export type AspectGroup = 'landscape' | 'portrait' | 'square';

export const ASPECT_PRESETS: Record<
  AspectRatio,
  { width: number; height: number; label: string; group: AspectGroup; platforms: string }
> = {
  // 横屏
  '16:9':  { width: 1920, height: 1080, label: '16:9',  group: 'landscape', platforms: 'YouTube · Bilibili · Zoom' },
  '4:3':   { width: 1440, height: 1080, label: '4:3',   group: 'landscape', platforms: 'Classrooms · PPT' },
  '21:9':  { width: 2560, height: 1080, label: '21:9',  group: 'landscape', platforms: 'Ultrawide · Cinema' },
  '16:10': { width: 1920, height: 1200, label: '16:10', group: 'landscape', platforms: 'MacBook · iPad' },
  '3:2':   { width: 1620, height: 1080, label: '3:2',   group: 'landscape', platforms: 'Surface · Mirrorless' },
  // 竖屏
  '9:16':  { width: 1080, height: 1920, label: '9:16',  group: 'portrait',  platforms: 'TikTok · Shorts · Reels' },
  '4:5':   { width: 1080, height: 1350, label: '4:5',   group: 'portrait',  platforms: 'Instagram feed' },
  '3:4':   { width: 1080, height: 1440, label: '3:4',   group: 'portrait',  platforms: 'Xiaohongshu' },
  '2:3':   { width: 1080, height: 1620, label: '2:3',   group: 'portrait',  platforms: 'Pinterest · Print' },
  // 方形
  '1:1':   { width: 1080, height: 1080, label: '1:1',   group: 'square',    platforms: 'Instagram · WeChat' },
};

export type CroppingMode = 'follow_viewport' | 'fit_all_content';

export type VideoBackgroundKind = 'none' | 'preset' | 'color';

export type VideoBackgroundTone = 'all' | 'fresh' | 'soft' | 'dark' | 'natural';

export interface VideoBackgroundConfig {
  kind: VideoBackgroundKind;
  presetId?: string;
  tone?: VideoBackgroundTone;
  /** 自定义纯色背景。kind='color' 时使用。 */
  color?: string;
  /** 背景模糊像素。 */
  blurPx?: number;
  /** 0..1 柔化/压暗强度，用于降低高饱和背景干扰。 */
  dim?: number;
}

export type ExportResolution = 'sd' | 'hd' | 'fhd' | 'qhd' | 'uhd';
export type ExportFormat = 'mp4' | 'webm' | 'gif';
export type ExportQuality = 'auto' | 'high' | 'medium' | 'low';

/** 清晰度档 → 相对 1080 预设的缩放系数。 */
export const RESOLUTION_SCALE: Record<ExportResolution, number> = {
  sd: 0.444,   // 480p
  hd: 0.667,   // 720p
  fhd: 1,      // 1080p（默认 = 预设原生）
  qhd: 1.333,  // 1440p / 2K
  uhd: 2,      // 2160p / 4K
};

export interface ExportConfig {
  aspectRatio: AspectRatio;
  croppingMode: CroppingMode;
  fps: number;
  withWatermark: boolean;
  /** 多选导出比例（缺省=[aspectRatio]）；导出逐个生成下载。aspectRatio 仍为预览/主比例。 */
  exportRatios?: AspectRatio[];
  /** 清晰度档（缺省 fhd=预设原生）；缩放白板渲染与最终输出尺寸。 */
  resolution?: ExportResolution;
  /** 容器/编码格式（缺省 mp4）。 */
  format?: ExportFormat;
  /** 码率档（缺省 auto）。 */
  quality?: ExportQuality;
  burnSubtitles?: boolean;
  includeWorkspaceShell?: boolean;
  /** 录制前框定的裁切框（follow_viewport 下覆盖默认居中 cover-crop）。 */
  cropWindow?: CropWindow;
  /** Custom framing 的输出像素尺寸（优先于 ASPECT_PRESETS）。 */
  customOutput?: { width: number; height: number };
  /** 时间轴裁剪保留段（ms）；缺省=整段。导出只输出这些段、按序拼接。 */
  segments?: TimeSegment[];
  /** 指定时间窗口内自动放大画面。 */
  autoZooms?: AutoZoomSegment[];
  /** 视频背景。旧录制缺省为 none。 */
  videoBackground?: VideoBackgroundConfig;
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

// ----- 录制前 Setup 配置 -----

export type CameraShape = 'circle' | 'rounded';
export type CameraCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface CameraSetupConfig {
  enabled: boolean;
  sizePx: number;            // 80..480
  shape: CameraShape;
  position: CameraCorner;
  backgroundRemoval: boolean; // 仅存开关；实时分割本轮不接
}

/**
 * 裁切框（viewfinder）的位置/大小，存为「画布区」的比例矩形（0..1），与像素/分辨率解耦。
 * 录制中用户拖拽/缩放裁切框即更新它；导出时对每帧取该时刻视口 scene 矩形的对应子矩形输出。
 */
export interface CropWindow {
  rx: number;  // 左上角 X 占画布区宽的比例
  ry: number;  // 左上角 Y 占画布区高的比例
  rw: number;  // 宽占画布区宽的比例
  rh: number;  // 高占画布区高的比例
}

export type RecordingSourceKind =
  | 'whiteboard'
  | 'current_tab'
  | 'window'
  | 'desktop'
  | 'selected_area';

export interface SourceCropWindow {
  rx: number;
  ry: number;
  rw: number;
  rh: number;
}

export interface RecordingSourceConfig {
  kind: RecordingSourceKind;
  /** Browser display surface hint; not a guarantee. */
  displaySurface?: 'browser' | 'window' | 'monitor';
  /** 授权后拿到的源画面原始像素尺寸，用于像素级默认导出。 */
  sourceSize?: { width: number; height: number; frameRate?: number };
  /** selected_area 模式：浏览器授权后的源画面内部裁切区域。 */
  sourceCropWindow?: SourceCropWindow;
  /** Tab/system audio is only available when the browser grants it. */
  captureSystemAudio?: boolean;
}

/**
 * 录制前 Setup 面板选定并锁定的配置，随录制存进 RecordingMetadata.setup，
 * 录制中据此画裁切框，导出页据此设默认 ExportConfig。
 *
 * framing='default' 表示「整个画板」：croppingMode 走 fit_all_content、不画固定比例裁切框。
 * framing='custom' 表示自定义 W×H 固定比例（customWidth/customHeight 必填）。
 * 否则为预设固定比例，croppingMode 默认 follow_viewport。
 */
export interface RecordingSetupConfig {
  framing: AspectRatio | 'default' | 'custom';
  croppingMode: CroppingMode;
  includeWorkspaceShell: boolean;  // 是否把工作区界面一起录进/导出
  /** 裁切框位置/大小（固定比例 + Custom 用；default 不裁不存）。 */
  cropWindow?: CropWindow;
  /** framing='custom' 的输出像素尺寸（由框选区域换算或用户手输；预设比例用 ASPECT_PRESETS）。 */
  customOutput?: { width: number; height: number };
  camera: CameraSetupConfig;
  /** 视频背景，进入导出默认配置并参与最终视频绘制。 */
  videoBackground?: VideoBackgroundConfig;
  /** 录制来源。缺省 whiteboard。 */
  source?: RecordingSourceConfig;
}
