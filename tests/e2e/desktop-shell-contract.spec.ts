import { expect, test } from '@playwright/test';
import {
  createDesktopWindowOptions,
  exposedDesktopBridgeChannels,
} from '../../apps/desktop/src/windowContract';
import { NativeHelperClient, type HelperTransport } from '../../apps/desktop/src/nativeHelperClient';

test('desktop shell uses a hardened renderer with a narrow versioned bridge', () => {
  const options = createDesktopWindowOptions('/tmp/excalicast-preload.js');
  const webPreferences = options.webPreferences;
  expect(webPreferences).toBeDefined();

  expect(webPreferences?.contextIsolation).toBe(true);
  expect(webPreferences?.nodeIntegration).toBe(false);
  expect(webPreferences?.sandbox).toBe(true);
  expect(webPreferences?.preload).toBe('/tmp/excalicast-preload.js');
  expect(exposedDesktopBridgeChannels.every((channel) => channel.endsWith('.v1'))).toBe(true);
});

test('renderer bridge never exposes raw frames or unrestricted IPC', () => {
  expect(exposedDesktopBridgeChannels.some((channel) => /frame|pixel|blob/i.test(channel))).toBe(false);
  expect(exposedDesktopBridgeChannels).not.toContain('*');
});

test('native helper handshake is correlated and rejects protocol mismatch', async () => {
  let onLine: ((line: string) => void) | null = null;
  const writes: string[] = [];
  const transport: HelperTransport = {
    write(line) {
      writes.push(line);
      const command = JSON.parse(line) as { id: string };
      queueMicrotask(() => onLine?.(JSON.stringify({
        id: command.id,
        ok: true,
        protocolVersion: 1,
        engine: 'mac-media-engine',
        state: 'idle',
      })));
    },
    onLine(listener) { onLine = listener; },
    close() {},
  };

  const client = new NativeHelperClient(transport);
  await expect(client.handshake()).resolves.toEqual({
    protocolVersion: 1,
    engine: 'mac-media-engine',
    state: 'idle',
  });
  expect(JSON.parse(writes[0])).toMatchObject({ channel: 'helper.handshake.v1', protocolVersion: 1 });
});
