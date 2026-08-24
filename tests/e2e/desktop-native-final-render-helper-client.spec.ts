import { expect, test } from '@playwright/test';
import {
  NativeHelperClient,
  type HelperTransport,
} from '../../apps/desktop/src/nativeHelperClient';

function respondingTransport(
  respond: (command: Record<string, unknown>) => Record<string, unknown>,
): { transport: HelperTransport; commands: Record<string, unknown>[] } {
  let onLine: ((line: string) => void) | undefined;
  const commands: Record<string, unknown>[] = [];
  return {
    commands,
    transport: {
      write(line) {
        const command = JSON.parse(line) as Record<string, unknown>;
        commands.push(command);
        queueMicrotask(() => onLine?.(JSON.stringify({
          id: command.id,
          ok: true,
          ...respond(command),
        })));
      },
      onLine(listener) { onLine = listener; },
      close() {},
    },
  };
}

test('final render client uses identity-only async start and status contracts', async () => {
  const { transport, commands } = respondingTransport((command) => ({
    finalRender: command.channel === 'final-render.start.v1'
      ? {
          state: 'rendering',
          requestID: 'render_1',
          requestSHA256: 'a'.repeat(64),
        }
      : {
          state: 'failed',
          requestID: 'render_1',
          requestSHA256: 'a'.repeat(64),
          errorCode: 'production-renderer-unavailable',
        },
  }));
  const client = new NativeHelperClient(transport);
  const callerOwnedRequest = {
    requestID: 'render_1',
    requestSHA256: 'a'.repeat(64),
    projectRoot: '/private/projects/lesson-1',
    outputPath: '/private/exports/lesson-1.mp4',
  };

  await expect(client.startFinalRender(callerOwnedRequest))
    .resolves.toMatchObject({ state: 'rendering', requestID: 'render_1' });
  await expect(client.finalRenderStatus()).resolves.toMatchObject({
    state: 'failed',
    errorCode: 'production-renderer-unavailable',
  });

  expect(commands).toEqual([
    expect.objectContaining({
      channel: 'final-render.start.v1',
      requestID: 'render_1',
      requestSHA256: 'a'.repeat(64),
    }),
    expect.objectContaining({ channel: 'final-render.status.v1' }),
  ]);
  expect(commands[0]).not.toHaveProperty('projectRoot');
  expect(commands[0]).not.toHaveProperty('outputPath');
  expect(Object.keys(commands[0]).sort()).toEqual([
    'channel', 'id', 'requestID', 'requestSHA256',
  ]);
});

test('final render cancel remains request-bound', async () => {
  const { transport, commands } = respondingTransport(() => ({
    finalRender: {
      state: 'cancelled',
      requestID: 'render_cancel',
      requestSHA256: 'b'.repeat(64),
    },
  }));
  const client = new NativeHelperClient(transport);

  const callerOwnedRequest = {
    requestID: 'render_cancel',
    requestSHA256: 'b'.repeat(64),
    projectRoot: '/private/projects/lesson-cancel',
    outputPath: '/private/exports/lesson-cancel.mp4',
  };
  await expect(client.cancelFinalRender(callerOwnedRequest))
    .resolves.toMatchObject({ state: 'cancelled', requestID: 'render_cancel' });

  expect(commands[0]).toMatchObject({
    channel: 'final-render.cancel.v1',
    requestID: 'render_cancel',
    requestSHA256: 'b'.repeat(64),
  });
  expect(Object.keys(commands[0]).sort()).toEqual([
    'channel', 'id', 'requestID', 'requestSHA256',
  ]);
});

test('final render client rejects malformed ready responses without output identity', async () => {
  const { transport } = respondingTransport(() => ({
    finalRender: {
      state: 'ready',
      requestID: 'render_bad',
      requestSHA256: 'c'.repeat(64),
    },
  }));

  await expect(new NativeHelperClient(transport).finalRenderStatus())
    .rejects.toThrow('native_final_render_status_invalid');
});

test('final render client rejects unknown or conflicting fields for every status state', async () => {
  const identity = {
    requestID: 'render_strict',
    requestSHA256: 'd'.repeat(64),
  };
  const malformedStatuses: Array<Record<string, unknown>> = [
    { state: 'idle', requestID: identity.requestID },
    { state: 'idle', unexpected: true },
    { state: 'rendering', ...identity, outputIdentity: 'e'.repeat(64) },
    { state: 'rendering', ...identity, errorCode: 'render-failed' },
    { state: 'cancelled', ...identity, outputIdentity: 'e'.repeat(64) },
    { state: 'ready', ...identity, outputIdentity: 'e'.repeat(64), errorCode: 'render-failed' },
    { state: 'failed', ...identity, errorCode: 'render-failed', outputIdentity: 'e'.repeat(64) },
    { state: 'failed', ...identity, errorCode: 'render-failed', unexpected: true },
  ];

  for (const finalRender of malformedStatuses) {
    const { transport } = respondingTransport(() => ({ finalRender }));
    await expect(new NativeHelperClient(transport).finalRenderStatus())
      .rejects.toThrow('native_final_render_status_invalid');
  }
});
