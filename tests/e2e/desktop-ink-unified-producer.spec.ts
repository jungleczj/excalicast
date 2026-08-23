import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import {
  DesktopInkUnifiedProducer,
  shouldCollectDesktopInk,
} from '../../src/desktop/desktopInkUnifiedProducer';
import { DesktopInkEventCollector } from '../../src/desktop/inkEventJournal';

function pointer(collector: DesktopInkEventCollector, x: number): void {
  collector.recordPointer({ x, y: 20, tool: 'freedraw', phase: 'move' }, 1_700_000_000_000 + x);
}

test('one drained collector batch commits unified telemetry before the raw ink track', async () => {
  const collector = new DesktopInkEventCollector();
  pointer(collector, 10);
  pointer(collector, 11);
  const calls: Array<{ channel: string; payload: unknown }> = [];
  let hostUs = 1_000_000;
  const producer = new DesktopInkUnifiedProducer({
    collector,
    sessionId: 'recording-a',
    producerEpoch: 'overlay-a',
    nowHostUs: () => hostUs += 1_000,
    bridge: {
      async invoke(channel, payload) {
        calls.push({ channel, payload });
        if (channel.startsWith('input-telemetry.')) {
          const events = (payload as { events: Array<Record<string, unknown>> }).events;
          return {
            committed: true, producerId: 'desktop-ink', producerEpoch: 'overlay-a',
            acknowledgedSequence: events.at(-1)?.producerSequence,
            segmentIndex: 0, duplicate: false, dropped: false,
          };
        }
        return { committed: true, index: 0 };
      },
    },
  });
  await producer.flush();
  expect(calls.map((call) => call.channel)).toEqual([
    'input-telemetry.append-producer-events.v1',
    'ink.append-events.v1',
  ]);
  const unified = calls[0].payload as { events: Array<Record<string, unknown>> };
  expect(unified.events.map((event) => event.producerSequence)).toEqual([0, 1]);
  expect((calls[1].payload as { events: unknown[] }).events).toHaveLength(2);
  expect(collector.pendingCount).toBe(0);
});

test('raw retry retains its drained batch without duplicating committed telemetry', async () => {
  const collector = new DesktopInkEventCollector();
  pointer(collector, 30);
  let telemetryCalls = 0;
  let rawCalls = 0;
  const producer = new DesktopInkUnifiedProducer({
    collector, sessionId: 'recording-retry', producerEpoch: 'overlay-retry',
    nowHostUs: () => 2_000_000,
    bridge: {
      async invoke(channel, payload) {
        if (channel.startsWith('input-telemetry.')) {
          telemetryCalls += 1;
          const events = (payload as { events: Array<Record<string, unknown>> }).events;
          return {
            committed: true, producerId: 'desktop-ink', producerEpoch: 'overlay-retry',
            acknowledgedSequence: events.at(-1)?.producerSequence,
            segmentIndex: 0, duplicate: false, dropped: false,
          };
        }
        rawCalls += 1;
        if (rawCalls === 1) return { committed: false, reason: 'capture_paused' };
        return { committed: true, index: 0 };
      },
    },
  });
  await expect(producer.flush()).rejects.toThrow('desktop_ink_event_not_committed');
  expect(producer.hasPending).toBe(true);
  await producer.flush();
  expect(telemetryCalls).toBe(1);
  expect(rawCalls).toBe(2);
  expect(producer.hasPending).toBe(false);
});

test('telemetry failure retries the same tuple before raw ink and session epochs remain isolated', async () => {
  const collector = new DesktopInkEventCollector();
  pointer(collector, 40);
  const telemetryPayloads: unknown[] = [];
  let attempt = 0;
  const producer = new DesktopInkUnifiedProducer({
    collector, sessionId: 'recording-failure', producerEpoch: 'overlay-failure',
    nowHostUs: () => 3_000_000,
    bridge: {
      async invoke(channel, payload) {
        if (channel.startsWith('input-telemetry.')) {
          telemetryPayloads.push(payload);
          attempt += 1;
          if (attempt === 1) return { committed: false };
          const events = (payload as { events: Array<Record<string, unknown>> }).events;
          return {
            committed: true, producerId: 'desktop-ink', producerEpoch: 'overlay-failure',
            acknowledgedSequence: events.at(-1)?.producerSequence,
            segmentIndex: 0, duplicate: false, dropped: false,
          };
        }
        return { committed: true, index: 0 };
      },
    },
  });
  await expect(producer.flush()).rejects.toThrow('desktop_input_telemetry_not_committed');
  await producer.flush();
  expect(telemetryPayloads[1]).toEqual(telemetryPayloads[0]);

  expect(shouldCollectDesktopInk({ recordingActive: true, recordingId: 'a', paused: false })).toBe(true);
  expect(shouldCollectDesktopInk({ recordingActive: true, recordingId: 'a', paused: true })).toBe(false);
  expect(shouldCollectDesktopInk({ recordingActive: false, recordingId: null, paused: false })).toBe(false);
});

test('a new recording gets an isolated epoch and restarts its local sequence', async () => {
  const sequences: Array<{ epoch: unknown; sequence: unknown }> = [];
  const bridge = {
    async invoke(channel: string, payload?: unknown) {
      if (channel.startsWith('input-telemetry.')) {
        const events = (payload as { events: Array<Record<string, unknown>> }).events;
        sequences.push(...events.map((event) => ({
          epoch: event.producerEpoch,
          sequence: event.producerSequence,
        })));
        return {
          committed: true, producerId: 'desktop-ink',
          producerEpoch: events[0].producerEpoch,
          acknowledgedSequence: events.at(-1)?.producerSequence,
          segmentIndex: sequences.length, duplicate: false, dropped: false,
        };
      }
      return { committed: true, index: 0 };
    },
  };
  for (const [sessionId, epoch] of [['recording-a', 'epoch-a'], ['recording-b', 'epoch-b']] as const) {
    const collector = new DesktopInkEventCollector();
    pointer(collector, 50);
    await new DesktopInkUnifiedProducer({
      bridge, collector, sessionId, producerEpoch: epoch, nowHostUs: () => 4_000_000,
    }).flush();
  }
  expect(sequences).toEqual([
    { epoch: 'epoch-a', sequence: 0 },
    { epoch: 'epoch-b', sequence: 0 },
  ]);
});

test('main broadcasts strict session pause lifecycle and overlay flush ack waits for both tracks', () => {
  const main = fs.readFileSync('apps/desktop/src/main.ts', 'utf8');
  const pause = main.slice(
    main.indexOf('DESKTOP_IPC_CHANNELS.capturePause'),
    main.indexOf('DESKTOP_IPC_CHANNELS.captureResume'),
  );
  expect(pause.indexOf('pausePending = true')).toBeLessThan(pause.indexOf('requestInkWindowFlush()'));
  expect(pause.indexOf('broadcastInkSettings()')).toBeLessThan(pause.indexOf('requestInkWindowFlush()'));
  expect(pause.indexOf('requestInkWindowFlush()')).toBeLessThan(pause.indexOf('pauseCapture()'));
  expect(pause).toContain('pausePending = false');

  const resume = main.slice(
    main.indexOf('DESKTOP_IPC_CHANNELS.captureResume'),
    main.indexOf('DESKTOP_IPC_CHANNELS.captureSetMicrophoneMuted'),
  );
  expect(resume.indexOf('resumeCapture()')).toBeLessThan(resume.indexOf('broadcastInkSettings()'));
  expect(resume).toContain('pauseStartedUnixMs = null');
  expect(main).toContain('recordingId: activeNativeCapture?.recordingId ?? null');
  expect(main).toContain('paused: activeNativeCapture !== null');

  const overlay = fs.readFileSync('src/app/[locale]/desktop-ink/page.tsx', 'utf8');
  const flushRequest = overlay.slice(
    overlay.indexOf('DESKTOP_IPC_CHANNELS.inkFlushRequested'),
    overlay.indexOf('useEffect(() => {', overlay.indexOf('DESKTOP_IPC_CHANNELS.inkFlushRequested')),
  );
  expect(flushRequest.indexOf('flushEvents().then')).toBeLessThan(
    flushRequest.indexOf('DESKTOP_IPC_CHANNELS.inkFlushComplete'),
  );
  expect(overlay).toContain('producerEpoch: crypto.randomUUID()');
  expect(overlay).toContain('}, 100);');
});
