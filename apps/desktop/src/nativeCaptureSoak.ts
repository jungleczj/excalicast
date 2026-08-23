import type {
  NativeCapturePressure,
  NativeCaptureRequest,
  NativeHelperClient,
  NativeRecordingValidationReport,
} from './nativeHelperClient';

export interface NativeCaptureSoakSample {
  elapsedMs: number;
  residentBytes: number;
  pendingEncoderFrames: number;
  pendingWriteBytes: number;
  segmentWriteLatencyMs: number;
  state: 'idle' | 'recording' | 'stopping';
}

export interface NativeCaptureSoakSummary {
  passed: boolean;
  failures: string[];
  durationMs: number;
  sampleCount: number;
  baselineResidentBytes: number;
  peakResidentBytes: number;
  residentGrowthBytes: number;
  memorySlopeBytesPerMinute: number;
  maximumPendingEncoderFrames: number;
  maximumPendingWriteBytes: number;
  maximumSegmentWriteLatencyMs: number;
}

export function summarizeNativeCaptureSoak(input: {
  durationMs: number;
  validationPassed: boolean;
  samples: NativeCaptureSoakSample[];
  runtimeError?: string;
}): NativeCaptureSoakSummary {
  const samples = [...input.samples].sort((a, b) => a.elapsedMs - b.elapsedMs);
  const baselineResidentBytes = samples[0]?.residentBytes ?? 0;
  const peakResidentBytes = Math.max(0, ...samples.map((sample) => sample.residentBytes));
  const residentGrowthBytes = Math.max(0, (samples.at(-1)?.residentBytes ?? 0) - baselineResidentBytes);
  const warmupCount = samples.length > 4 ? Math.max(1, Math.floor(samples.length * 0.1)) : 0;
  const memorySlopeBytesPerMinute = linearSlopeBytesPerMinute(samples.slice(warmupCount));
  const maximumPendingEncoderFrames = Math.max(0, ...samples.map((sample) => sample.pendingEncoderFrames));
  const maximumPendingWriteBytes = Math.max(0, ...samples.map((sample) => sample.pendingWriteBytes));
  const maximumSegmentWriteLatencyMs = Math.max(0, ...samples.map((sample) => sample.segmentWriteLatencyMs));
  const failures: string[] = [];
  if (input.runtimeError) failures.push('runtime_error');
  if (samples.length === 0) failures.push('no_pressure_samples');
  if (samples.some((sample) => sample.state !== 'recording')) failures.push('capture_state_changed');
  if (!input.validationPassed) failures.push('media_validation');
  if (memorySlopeBytesPerMinute > 2 * 1024 * 1024
    && residentGrowthBytes > 32 * 1024 * 1024) {
    failures.push('memory_growth_linear');
  }
  if (longestRun(samples, (sample) => sample.pendingEncoderFrames > 2) >= 3) {
    failures.push('encoder_backlog');
  }
  if (maximumPendingWriteBytes >= 64 * 1024 * 1024) failures.push('write_backlog');
  if (maximumSegmentWriteLatencyMs >= 2_000) failures.push('write_latency');
  return {
    passed: failures.length === 0,
    failures,
    durationMs: input.durationMs,
    sampleCount: samples.length,
    baselineResidentBytes,
    peakResidentBytes,
    residentGrowthBytes,
    memorySlopeBytesPerMinute,
    maximumPendingEncoderFrames,
    maximumPendingWriteBytes,
    maximumSegmentWriteLatencyMs,
  };
}

export async function runNativeCaptureSoak(params: {
  client: NativeHelperClient;
  request: NativeCaptureRequest;
  durationMs: number;
  sampleIntervalMs?: number;
  sampleResidentBytes?: () => Promise<number>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<{
  summary: NativeCaptureSoakSummary;
  validation?: NativeRecordingValidationReport;
  samples: NativeCaptureSoakSample[];
  runtimeError?: string;
}> {
  const now = params.now ?? Date.now;
  const sleep = params.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const intervalMs = Math.max(250, params.sampleIntervalMs ?? 2_000);
  const samples: NativeCaptureSoakSample[] = [];
  const startedAt = now();
  let captureStarted = false;
  let runtimeError: string | undefined;
  let validation: NativeRecordingValidationReport | undefined;
  try {
    await params.client.startCapture(params.request);
    captureStarted = true;
    while (now() - startedAt < params.durationMs) {
      await sleep(Math.min(intervalMs, Math.max(0, params.durationMs - (now() - startedAt))));
      const status = await params.client.captureStatus();
      const pressure = status.pressure;
      samples.push(toSoakSample(
        now() - startedAt,
        status.state,
        pressure,
        await params.sampleResidentBytes?.() ?? 0
      ));
      if (status.state !== 'recording') {
        throw new Error(status.error ?? `capture_state_${status.state}`);
      }
    }
    await params.client.stopCapture();
    captureStarted = false;
    validation = await params.client.validateProject(params.request.projectRoot);
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error);
    if (captureStarted) {
      try { await params.client.stopCapture(); } catch { /* preserve the first failure */ }
    }
  }
  const summary = summarizeNativeCaptureSoak({
    durationMs: now() - startedAt,
    validationPassed: validation?.isValid == true,
    samples,
    runtimeError,
  });
  return { summary, validation, samples, runtimeError };
}

function toSoakSample(
  elapsedMs: number,
  state: NativeCaptureSoakSample['state'],
  pressure: NativeCapturePressure | undefined,
  residentBytes: number,
): NativeCaptureSoakSample {
  return {
    elapsedMs,
    residentBytes,
    pendingEncoderFrames: pressure?.pendingEncoderFrames ?? 0,
    pendingWriteBytes: pressure?.pendingWriteBytes ?? 0,
    segmentWriteLatencyMs: pressure?.maximumSegmentWriteLatencyMs ?? 0,
    state,
  };
}

function linearSlopeBytesPerMinute(samples: NativeCaptureSoakSample[]): number {
  if (samples.length < 2) return 0;
  const xMean = samples.reduce((sum, sample) => sum + sample.elapsedMs, 0) / samples.length;
  const yMean = samples.reduce((sum, sample) => sum + sample.residentBytes, 0) / samples.length;
  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    const x = sample.elapsedMs - xMean;
    numerator += x * (sample.residentBytes - yMean);
    denominator += x * x;
  }
  return denominator > 0 ? Math.max(0, numerator / denominator * 60_000) : 0;
}

function longestRun<T>(values: T[], predicate: (value: T) => boolean): number {
  let current = 0;
  let longest = 0;
  for (const value of values) {
    current = predicate(value) ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}
