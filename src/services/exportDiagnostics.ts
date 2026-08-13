import type {
  ExportDecoderPath,
  ExportDiagnosticReport,
  ExportAudioDiagnostics,
  ExportAudioEncoderPath,
  ExportEncoderPath,
  ExportProgressDetails,
} from '@/types/exportDiagnostics';

interface CreateOptions {
  recordingId: string;
  totalFrames: number;
  now?: () => number;
  wallClock?: () => number;
}

const EMPTY_MEDIA = {
  audio: { chunks: 0, bytes: 0 },
  camera: { chunks: 0, bytes: 0 },
  screen: { chunks: 0, bytes: 0 },
};

function heapBytes(): number | undefined {
  if (typeof performance === 'undefined') return undefined;
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : undefined;
}

export function createExportDiagnostics(options: CreateOptions) {
  const now = options.now ?? (() => performance.now());
  const wallClock = options.wallClock ?? (() => Date.now());
  const startedAt = wallClock();
  const startMono = now();
  let phase = 'preparing';
  let phaseStarted = startMono;
  let ratio = 0;
  let encoderPath: ExportEncoderPath = 'unknown';
  const decoderPaths: ExportProgressDetails['decoderPaths'] = {};
  let processedFrames = 0;
  let decodedSourceFrames = 0;
  let totalFrames = Math.max(0, options.totalFrames);
  let renderingStarted: number | null = null;
  let peakHeapBytes = heapBytes();
  let media = structuredClone(EMPTY_MEDIA);
  const stageDurationsMs: Record<string, number> = {};
  const breakdownMs: Record<string, number> = {};
  let audio: ExportAudioDiagnostics | undefined;

  const sampleHeap = () => {
    const current = heapBytes();
    if (current !== undefined) peakHeapBytes = Math.max(peakHeapBytes ?? 0, current);
  };
  const closePhase = (at: number) => {
    stageDurationsMs[phase] = (stageDurationsMs[phase] ?? 0) + Math.max(0, at - phaseStarted);
  };
  const snapshot = (): ExportProgressDetails => {
    const at = now();
    sampleHeap();
    const elapsedMs = Math.max(0, at - startMono);
    const renderingMs = renderingStarted === null ? 0 : Math.max(1, at - renderingStarted);
    const throughputFps = renderingMs > 0 ? processedFrames / (renderingMs / 1000) : 0;
    const remainingFrames = Math.max(0, totalFrames - processedFrames);
    const estimatedRemainingMs = throughputFps > 0
      ? Math.round((remainingFrames / throughputFps) * 1000)
      : null;
    return {
      phase,
      ratio,
      encoderPath,
      decoderPaths: { ...decoderPaths },
      processedFrames,
      totalFrames,
      decodedSourceFrames,
      throughputFps,
      elapsedMs: Math.round(elapsedMs),
      estimatedRemainingMs,
      ...(peakHeapBytes !== undefined ? { peakHeapBytes } : {}),
    };
  };

  return {
    setPhase(next: string) {
      const at = now();
      closePhase(at);
      phase = next;
      phaseStarted = at;
      if (next === 'rendering_frames' && renderingStarted === null) renderingStarted = at;
      sampleHeap();
    },
    setProgress(next: number) { ratio = Math.max(0, Math.min(1, next)); },
    setEncoderPath(next: ExportEncoderPath) { encoderPath = next; },
    setAudio(next: ExportAudioDiagnostics) { audio = { ...next }; },
    setAudioEncoderPath(next: ExportAudioEncoderPath, fallbackReason?: string) {
      if (!audio) return;
      audio = { ...audio, encoderPath: next, ...(fallbackReason ? { fallbackReason } : {}) };
    },
    setDecoderPath(track: 'screen' | 'camera', path: ExportDecoderPath) {
      if (track === 'screen') {
        decoderPaths.screen = path;
      } else if (path !== 'html-video') {
        decoderPaths.camera = path;
      }
    },
    setProcessedFrames(next: number) { processedFrames = Math.max(processedFrames, next); },
    setTotalFrames(next: number) { totalFrames = Math.max(0, next); },
    setDecodedSourceFrames(next: number) { decodedSourceFrames = Math.max(decodedSourceFrames, next); },
    addBreakdown(name: string, durationMs: number) {
      breakdownMs[name] = (breakdownMs[name] ?? 0) + Math.max(0, durationMs);
    },
    setMedia(next: typeof EMPTY_MEDIA) { media = structuredClone(next); },
    snapshot,
    complete(): ExportDiagnosticReport {
      const at = now();
      closePhase(at);
      const details = snapshot();
      return {
        ...details,
        recordingId: options.recordingId,
        startedAt,
        completedAt: wallClock(),
        stageDurationsMs: { ...stageDurationsMs },
        media,
        breakdownMs: { ...breakdownMs },
        ...(audio ? { audio: { ...audio } } : {}),
      };
    },
  };
}

export type ExportDiagnosticsCollector = ReturnType<typeof createExportDiagnostics>;
