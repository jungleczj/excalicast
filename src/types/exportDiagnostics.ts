export type ExportEncoderPath =
  | 'unknown'
  | 'webcodecs-h264'
  | 'webcodecs-vp9'
  | 'ffmpeg-h264'
  | 'ffmpeg-vp9'
  | 'ffmpeg-gif';

export type ExportDecoderPath =
  | 'mediabunny-stream'
  | 'legacy-array-buffer'
  | 'html-video';

export interface ExportProgressDetails {
  phase: string;
  ratio: number;
  encoderPath: ExportEncoderPath;
  decoderPaths: {
    screen?: ExportDecoderPath;
    camera?: Exclude<ExportDecoderPath, 'html-video'>;
  };
  processedFrames: number;
  totalFrames: number;
  decodedSourceFrames: number;
  throughputFps: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  peakHeapBytes?: number;
}

export interface ExportDiagnosticReport extends ExportProgressDetails {
  recordingId: string;
  startedAt: number;
  completedAt: number;
  stageDurationsMs: Record<string, number>;
  media: {
    audio: { chunks: number; bytes: number };
    camera: { chunks: number; bytes: number };
    screen: { chunks: number; bytes: number };
  };
  breakdownMs: Record<string, number>;
}
