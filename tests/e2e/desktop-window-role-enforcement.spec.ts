import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { DESKTOP_IPC_CHANNELS } from '@/desktop/productContract';
import {
  bindDesktopRendererRole,
  registerAuthorizedDesktopIpcHandler,
  type DesktopIpcInvokeEventLike,
  type DesktopIpcInvokeHandler,
} from '../../apps/desktop/src/windowContract';

class FakeIpcMain {
  readonly handlers = new Map<string, DesktopIpcInvokeHandler>();

  handle(channel: string, handler: DesktopIpcInvokeHandler): void {
    this.handlers.set(channel, handler);
  }

  invoke(channel: string, senderId: number, payload?: unknown): unknown {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error('handler_missing');
    const event: DesktopIpcInvokeEventLike = { sender: { id: senderId } };
    return handler(event, payload);
  }
}

test('registered IPC handlers authorize sender role before invoking sensitive business logic', async () => {
  const ipcMain = new FakeIpcMain();
  const roles = new Map<number, unknown>([[1, 'main'], [2, 'ink'], [3, 'teleprompter']]);
  let startCalls = 0;
  let appendCalls = 0;
  registerAuthorizedDesktopIpcHandler({
    ipcMain,
    roles,
    channel: DESKTOP_IPC_CHANNELS.captureStart,
    handler: async () => { startCalls += 1; return { state: 'recording' }; },
  });
  registerAuthorizedDesktopIpcHandler({
    ipcMain,
    roles,
    channel: DESKTOP_IPC_CHANNELS.inkAppendEvents,
    handler: async () => { appendCalls += 1; return { committed: true }; },
  });

  await expect(ipcMain.invoke(DESKTOP_IPC_CHANNELS.captureStart, 1)).resolves.toEqual({ state: 'recording' });
  expect(startCalls).toBe(1);
  expect(() => ipcMain.invoke(DESKTOP_IPC_CHANNELS.captureStart, 2)).toThrow('desktop_ipc_role_forbidden');
  expect(() => ipcMain.invoke(DESKTOP_IPC_CHANNELS.captureStart, 999)).toThrow('desktop_ipc_sender_unknown');
  expect(startCalls).toBe(1);

  await expect(ipcMain.invoke(DESKTOP_IPC_CHANNELS.inkAppendEvents, 2)).resolves.toEqual({ committed: true });
  expect(() => ipcMain.invoke(DESKTOP_IPC_CHANNELS.inkAppendEvents, 3)).toThrow('desktop_ipc_role_forbidden');
  expect(appendCalls).toBe(1);
});

test('renderer role binding registers a trusted role and cleans it on destroyed or explicit window close', () => {
  const roles = new Map<number, unknown>();
  let destroyed: (() => void) | null = null;
  const webContents = {
    id: 42,
    once(event: 'destroyed', listener: () => void) {
      expect(event).toBe('destroyed');
      destroyed = listener;
    },
  };
  const closeCleanup = bindDesktopRendererRole(roles, webContents, 'ink');
  expect(roles.get(42)).toBe('ink');
  (destroyed as (() => void) | null)?.();
  expect(roles.has(42)).toBe(false);

  const secondCleanup = bindDesktopRendererRole(roles, { ...webContents, id: 43 }, 'teleprompter');
  expect(roles.get(43)).toBe('teleprompter');
  secondCleanup();
  expect(roles.has(43)).toBe(false);
  closeCleanup();
});

test('main registers every invoke handler through the authorized wrapper', async () => {
  const source = await readFile(resolve(process.cwd(), 'apps/desktop/src/main.ts'), 'utf8');
  expect(source).not.toMatch(/ipcMain\.handle\s*\(/);
  for (const sensitive of [
    'captureStart',
    'captureStop',
    'capturePause',
    'captureResume',
    'projectReadMediaSegment',
    'projectReadInkEvents',
    'inkAppendEvents',
    'inputTelemetryAppend',
    'teleprompterConfigure',
  ]) {
    expect(source).toContain(`handleDesktopIpc(DESKTOP_IPC_CHANNELS.${sensitive}`);
  }
});
