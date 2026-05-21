export type RecordingKind = 'scene_replay' | 'screen_capture';

export type RecordingStatus = 'recording' | 'done' | 'error';

/**
 * Where the camera bubble appears in the final video:
 *  - `'in_screen'`: PiP浮窗在录制时被 screen capture 抓进了 screen.webm。
 *     Export skips ffmpeg overlay — bubble is already baked in screen.webm.
 *     Position cannot be changed after recording. Used when displaySurface === 'monitor'.
 *  - `'overlay'`: PiP浮窗不在 screen.webm 里（recording 'browser'/'window' 时
 *     PiP 是 OS-level 浮窗，capture 抓不到）。Export 用 ffmpeg overlay 把
 *     camera.webm 叠到 screen.webm 上。Position 可在 process page 改。
 *  - `'none'`: 用户没开摄像头。
 */
export type BubbleSource = 'in_screen' | 'overlay' | 'none';

/** 仅 `bubbleSource === 'overlay'` 时生效 */
export type CameraOverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** getDisplayMedia 用户选了什么源（来自 video track settings.displaySurface） */
export type DisplaySurface = 'monitor' | 'window' | 'browser' | 'unknown';

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
  // SRT text bound to this recording. Generated via DashScope ASR (Pro feature).
  // Burned in at download time when the user opts in.
  subtitleSrt?: string;
  // ---- v7 (Pattern B dual-stream) ----
  /** What surface the user picked. Used by export to know whether the PiP
   *  bubble is in screen.webm or needs overlay from camera.webm. */
  displaySurface?: DisplaySurface;
  /** Where to look for the bubble in the final video — derived from
   *  displaySurface + whether the camera/PiP was actually open at start. */
  bubbleSource?: BubbleSource;
  /** Where the ffmpeg overlay should place the bubble. Only meaningful when
   *  bubbleSource === 'overlay'. Mutable: user can change in process page. */
  cameraOverlayPosition?: CameraOverlayPosition;
  // The recorded webm is the union of all `screenChunks` rows ordered by `index`.
  // We do NOT store the watermark state here — watermark is decided at download.
}

export interface ScreenRecordingChunk {
  id?: number;              // dexie auto-pk
  recordingId: string;
  index: number;            // ordering
  blob: Blob;               // ~1s webm slice
}
