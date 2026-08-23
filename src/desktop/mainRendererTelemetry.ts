import {
  UnifiedEventCaptureAdapter,
  type RendererCapturePayload,
} from './unifiedEventCaptureAdapter';
import {
  createDesktopInputTelemetryWriter,
  type DesktopInputTelemetryBridge,
} from './unifiedEventNativeWriter';

export type MainRendererTeachingMode = 'screen' | 'whiteboard' | 'presentation';

export interface MainRendererTelemetrySession {
  capture(payload: RendererCapturePayload): Promise<void>;
  flushAndPause(): Promise<void>;
  resume(): Promise<void>;
  flushForStop(): Promise<{ ok: true } | { ok: false; error: Error }>;
}

export interface MainRendererTelemetryOptions {
  bridge: DesktopInputTelemetryBridge;
  sessionId: string;
  producerEpoch: string;
  nowHostUs(): number;
  flushTimeoutMs?: number;
}

export function teachingModeForSource(
  sourceKind: string | undefined,
): MainRendererTeachingMode {
  if (!sourceKind || sourceKind === 'whiteboard') return 'whiteboard';
  if (sourceKind === 'current_tab' || sourceKind === 'window') return 'presentation';
  return 'screen';
}

export function cameraLayoutValue(layout: {
  x: number;
  y: number;
  size: number;
  shape: string;
}): string {
  return JSON.stringify(layout);
}

export function createMainRendererTelemetrySession(
  options: MainRendererTelemetryOptions,
): MainRendererTelemetrySession {
  const startedHostUs = options.nowHostUs();
  const adapter = new UnifiedEventCaptureAdapter({
    sessionId: options.sessionId,
    captureStartedHostUs: startedHostUs,
    // These are low-frequency privacy/edit decisions. Checkpoint each one so a
    // crash cannot erase the whole session's camera or teaching-mode history.
    maximumEvents: 1,
    maximumBytes: 64 * 1_024,
    write: createDesktopInputTelemetryWriter({
      bridge: options.bridge,
      sessionId: options.sessionId,
      producerId: 'main-whiteboard',
      producerEpoch: options.producerEpoch,
      surfaceId: 'main-whiteboard',
    }),
  });

  return {
    capture(payload) {
      return adapter.capture({
        sessionId: options.sessionId,
        hostUs: options.nowHostUs(),
        payload,
      });
    },
    async flushAndPause() {
      await adapter.pause(options.nowHostUs());
      try {
        await adapter.flush();
      } catch (error) {
        await adapter.resume(options.nowHostUs());
        throw error;
      }
    },
    resume() {
      return adapter.resume(options.nowHostUs());
    },
    async flushForStop() {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          adapter.flush(),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('desktop_input_telemetry_flush_timeout')),
              options.flushTimeoutMs ?? 2_000,
            );
          }),
        ]);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error : new Error('desktop_input_telemetry_flush_failed'),
        };
      } finally {
        if (timeout !== null) clearTimeout(timeout);
      }
    },
  };
}
