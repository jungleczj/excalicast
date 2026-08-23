import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import {
  cameraLayoutValue,
  createMainRendererTelemetrySession,
  teachingModeForSource,
} from '../../src/desktop/mainRendererTelemetry';

test('main renderer session uses one stable producer epoch and monotonic capture clock', async () => {
  const payloads: Array<Record<string, unknown>> = [];
  let hostUs = 1_000_000;
  const session = createMainRendererTelemetrySession({
    sessionId: 'native-session',
    producerEpoch: 'page-launch-a',
    nowHostUs: () => hostUs += 10_000,
    bridge: {
      async invoke(_channel, payload) {
        const envelope = payload as { events: Array<Record<string, unknown>> };
        payloads.push(...envelope.events);
        return {
          committed: true,
          producerId: 'main-whiteboard',
          producerEpoch: 'page-launch-a',
          acknowledgedSequence: envelope.events.at(-1)?.producerSequence,
          segmentIndex: payloads.length,
          duplicate: false,
          dropped: false,
        };
      },
    },
  });
  await session.capture({ kind: 'mode-change', mode: 'whiteboard' });
  expect(payloads).toHaveLength(1);
  await session.capture({ kind: 'camera-control', action: 'enable' });
  expect(payloads).toHaveLength(2);
  await session.capture({
    kind: 'camera-control', action: 'set-layout',
    value: cameraLayoutValue({ x: 10, y: 20, size: 160, shape: 'circle' }),
  });
  await session.flushAndPause();
  await session.resume();
  await session.capture({ kind: 'camera-control', action: 'mute' });
  expect(await session.flushForStop()).toEqual({ ok: true });

  expect(payloads.map((event) => event.producerSequence)).toEqual([0, 1, 2, 3]);
  expect(new Set(payloads.map((event) => event.producerEpoch))).toEqual(new Set(['page-launch-a']));
  expect(new Set(payloads.map((event) => event.surfaceId))).toEqual(new Set(['main-whiteboard']));
  expect(payloads.map((event) => event.kind)).toEqual([
    'mode-change', 'camera-control', 'camera-control', 'camera-control',
  ]);
});

test('source modes cover whiteboard, presentation and screen recording', () => {
  expect(teachingModeForSource('whiteboard')).toBe('whiteboard');
  expect(teachingModeForSource('current_tab')).toBe('presentation');
  expect(teachingModeForSource('window')).toBe('presentation');
  expect(teachingModeForSource('desktop')).toBe('screen');
  expect(teachingModeForSource('selected_area')).toBe('screen');
});

test('stop flush is bounded and reports backpressure instead of swallowing it', async () => {
  let hostUs = 1_000;
  const session = createMainRendererTelemetrySession({
    sessionId: 'blocked-session',
    producerEpoch: 'blocked-epoch',
    nowHostUs: () => hostUs += 1,
    flushTimeoutMs: 10,
    bridge: { invoke: async () => new Promise(() => undefined) },
  });
  void session.capture({ kind: 'camera-control', action: 'disable' });
  const result = await session.flushForStop();
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.message).toBe('desktop_input_telemetry_flush_timeout');
});

test('native page lifecycle flushes telemetry without changing the browser session branch', () => {
  const source = fs.readFileSync('src/app/[locale]/app/page.tsx', 'utf8');
  const nativeStart = source.slice(
    source.indexOf("if (started.pipeline === 'native')"),
    source.indexOf('const session = started.session;'),
  );
  expect(nativeStart).toContain('createMainRendererTelemetrySession');
  expect(nativeStart).toContain("producerEpoch: crypto.randomUUID()");
  expect(nativeStart).toContain("action: config.camera.enabled ? 'enable' : 'disable'");
  expect(nativeStart.indexOf('await telemetry.capture')).toBeLessThan(
    nativeStart.indexOf('nativeSessionRef.current = started.session'),
  );
  expect(nativeStart).toContain('await started.session.stop().catch');
  expect(nativeStart).toContain('failNativeRecordingMetadata');
  expect(nativeStart).toContain("'desktop_native_telemetry_start_failed'");

  const pause = source.slice(source.indexOf('const handlePause'), source.indexOf('const handleResume'));
  expect(pause.indexOf('flushAndPause()')).toBeLessThan(pause.indexOf('native.pause()'));
  const resume = source.slice(source.indexOf('const handleResume'), source.indexOf('const [audioMuted'));
  expect(resume.indexOf('native.resume()')).toBeLessThan(resume.indexOf('nativeTelemetryRef.current?.resume()'));
  expect(resume).toContain('if (nativeResumed)');
  expect(resume).toContain('await native.pause()');
  const stop = source.slice(source.indexOf('const handleStop'), source.indexOf('const s = sessionRef.current'));
  expect(stop.indexOf('flushForStop()')).toBeLessThan(stop.indexOf('native.stop()'));

  expect(source).toContain('const session = started.session;');
  expect(source).toContain('recordingLifecycle.attach(session);');
});
