import { expect, test } from '@playwright/test';

import { DESKTOP_IPC_CHANNELS } from '@/desktop/productContract';
import {
  authorizeDesktopRendererIpc,
  desktopRendererEventChannelsByRole,
  desktopRendererInvokeChannelsByRole,
  isDesktopRendererIpcAllowed,
  type DesktopRendererRole,
} from '../../apps/desktop/src/windowContract';

const roles = new Map<number, unknown>([
  [101, 'main'],
  [202, 'ink'],
  [303, 'teleprompter'],
]);

test('main renderer owns recording control, project media, render, and configuration commands', () => {
  const allowed = [
    DESKTOP_IPC_CHANNELS.captureStart,
    DESKTOP_IPC_CHANNELS.captureStop,
    DESKTOP_IPC_CHANNELS.captureSetMicrophoneMuted,
    DESKTOP_IPC_CHANNELS.projectReadMediaSegment,
    DESKTOP_IPC_CHANNELS.projectReadInkEvents,
    DESKTOP_IPC_CHANNELS.inkSetOpacity,
    DESKTOP_IPC_CHANNELS.inputTelemetryAppend,
    DESKTOP_IPC_CHANNELS.teleprompterConfigure,
    DESKTOP_IPC_CHANNELS.renderExport,
  ];
  expect(allowed.every((channel) => isDesktopRendererIpcAllowed('main', 'invoke', channel))).toBe(true);
  expect(desktopRendererInvokeChannelsByRole.main).not.toContain(DESKTOP_IPC_CHANNELS.inkAppendEvents);
  expect(desktopRendererInvokeChannelsByRole.main).toContain(DESKTOP_IPC_CHANNELS.inputTelemetryAppend);
});

test('ink renderer can only configure ink, append ink, and produce input telemetry', () => {
  const allowed = [
    DESKTOP_IPC_CHANNELS.inkGetSettings,
    DESKTOP_IPC_CHANNELS.inkSetMode,
    DESKTOP_IPC_CHANNELS.inkSetOpacity,
    DESKTOP_IPC_CHANNELS.inkAppendEvents,
    DESKTOP_IPC_CHANNELS.inkFlushComplete,
    DESKTOP_IPC_CHANNELS.inputTelemetryAppend,
  ];
  expect(allowed.every((channel) => isDesktopRendererIpcAllowed('ink', 'invoke', channel))).toBe(true);

  const sensitive = [
    DESKTOP_IPC_CHANNELS.captureStart,
    DESKTOP_IPC_CHANNELS.captureStop,
    DESKTOP_IPC_CHANNELS.capturePause,
    DESKTOP_IPC_CHANNELS.projectReadMediaSegment,
    DESKTOP_IPC_CHANNELS.projectReadInkEvents,
    DESKTOP_IPC_CHANNELS.teleprompterConfigure,
    DESKTOP_IPC_CHANNELS.cameraSetLayout,
    DESKTOP_IPC_CHANNELS.renderExport,
  ];
  expect(sensitive.every((channel) => !isDesktopRendererIpcAllowed('ink', 'invoke', channel))).toBe(true);
});

test('teleprompter renderer can only read and configure teleprompter state', () => {
  expect(desktopRendererInvokeChannelsByRole.teleprompter).toEqual([
    DESKTOP_IPC_CHANNELS.teleprompterConfigure,
    DESKTOP_IPC_CHANNELS.teleprompterSetMode,
    DESKTOP_IPC_CHANNELS.teleprompterGetState,
  ]);
  for (const channel of [
    DESKTOP_IPC_CHANNELS.captureStart,
    DESKTOP_IPC_CHANNELS.captureStop,
    DESKTOP_IPC_CHANNELS.projectReadMediaSegment,
    DESKTOP_IPC_CHANNELS.inkSetOpacity,
    DESKTOP_IPC_CHANNELS.inkAppendEvents,
    DESKTOP_IPC_CHANNELS.inputTelemetryAppend,
  ]) {
    expect(isDesktopRendererIpcAllowed('teleprompter', 'invoke', channel)).toBe(false);
  }
});

test('event subscriptions are isolated by renderer role', () => {
  expect(desktopRendererEventChannelsByRole.main).toEqual([
    DESKTOP_IPC_CHANNELS.inkSettingsChanged,
    DESKTOP_IPC_CHANNELS.teleprompterStateChanged,
  ]);
  expect(desktopRendererEventChannelsByRole.ink).toEqual([
    DESKTOP_IPC_CHANNELS.inkSettingsChanged,
    DESKTOP_IPC_CHANNELS.inkFlushRequested,
  ]);
  expect(desktopRendererEventChannelsByRole.teleprompter).toEqual([
    DESKTOP_IPC_CHANNELS.teleprompterStateChanged,
  ]);
  expect(isDesktopRendererIpcAllowed('ink', 'subscribe', DESKTOP_IPC_CHANNELS.teleprompterStateChanged)).toBe(false);
  expect(isDesktopRendererIpcAllowed('teleprompter', 'subscribe', DESKTOP_IPC_CHANNELS.inkFlushRequested)).toBe(false);
});

test('sender authorization rejects unknown senders, invalid roles, unknown channels, and forbidden access', () => {
  expect(authorizeDesktopRendererIpc({ senderId: 101, operation: 'invoke', channel: DESKTOP_IPC_CHANNELS.captureStart, roles })).toBe('main');
  expect(authorizeDesktopRendererIpc({ senderId: 202, operation: 'invoke', channel: DESKTOP_IPC_CHANNELS.inkAppendEvents, roles })).toBe('ink');
  expect(authorizeDesktopRendererIpc({ senderId: 303, operation: 'subscribe', channel: DESKTOP_IPC_CHANNELS.teleprompterStateChanged, roles })).toBe('teleprompter');

  expect(() => authorizeDesktopRendererIpc({ senderId: 404, operation: 'invoke', channel: DESKTOP_IPC_CHANNELS.captureStart, roles }))
    .toThrow('desktop_ipc_sender_unknown');
  expect(() => authorizeDesktopRendererIpc({ senderId: 202, operation: 'invoke', channel: DESKTOP_IPC_CHANNELS.captureStop, roles }))
    .toThrow('desktop_ipc_role_forbidden');
  expect(() => authorizeDesktopRendererIpc({ senderId: 101, operation: 'invoke', channel: 'capture.unversioned', roles }))
    .toThrow('desktop_ipc_role_forbidden');

  const invalidRoles = new Map<number, unknown>([[505, 'admin']]);
  expect(() => authorizeDesktopRendererIpc({ senderId: 505, operation: 'invoke', channel: DESKTOP_IPC_CHANNELS.captureStart, roles: invalidRoles }))
    .toThrow('desktop_ipc_role_invalid');
});

test('role predicates fail closed for runtime strings outside the role contract', () => {
  expect(isDesktopRendererIpcAllowed('unknown' as DesktopRendererRole, 'invoke', DESKTOP_IPC_CHANNELS.captureStart)).toBe(false);
  expect(isDesktopRendererIpcAllowed('main', 'invoke', '')).toBe(false);
});
