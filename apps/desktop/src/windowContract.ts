import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';
import { DESKTOP_IPC_CHANNELS } from '../../../src/desktop/productContract';

export type DesktopRendererRole = 'main' | 'ink' | 'teleprompter';
export type DesktopRendererIpcOperation = 'invoke' | 'subscribe';

export const desktopRendererInvokeChannelsByRole = {
  main: [
    DESKTOP_IPC_CHANNELS.capturePreflight,
    DESKTOP_IPC_CHANNELS.captureSources,
    DESKTOP_IPC_CHANNELS.captureDevices,
    DESKTOP_IPC_CHANNELS.capturePermissions,
    DESKTOP_IPC_CHANNELS.captureRequestPermissions,
    DESKTOP_IPC_CHANNELS.captureStart,
    DESKTOP_IPC_CHANNELS.captureStop,
    DESKTOP_IPC_CHANNELS.capturePause,
    DESKTOP_IPC_CHANNELS.captureResume,
    DESKTOP_IPC_CHANNELS.captureSetMicrophoneMuted,
    DESKTOP_IPC_CHANNELS.captureSetSystemAudioMuted,
    DESKTOP_IPC_CHANNELS.captureSetCameraVisibility,
    DESKTOP_IPC_CHANNELS.captureSetCameraHardware,
    DESKTOP_IPC_CHANNELS.captureStatus,
    DESKTOP_IPC_CHANNELS.inkSetMode,
    DESKTOP_IPC_CHANNELS.inkSetOpacity,
    DESKTOP_IPC_CHANNELS.inkGetSettings,
    DESKTOP_IPC_CHANNELS.inputTelemetryAppend,
    DESKTOP_IPC_CHANNELS.cameraSetLayout,
    DESKTOP_IPC_CHANNELS.teleprompterConfigure,
    DESKTOP_IPC_CHANNELS.teleprompterSetMode,
    DESKTOP_IPC_CHANNELS.teleprompterGetState,
    DESKTOP_IPC_CHANNELS.projectRecover,
    DESKTOP_IPC_CHANNELS.projectValidate,
    DESKTOP_IPC_CHANNELS.projectReadMediaSegment,
    DESKTOP_IPC_CHANNELS.projectReadInkEvents,
    DESKTOP_IPC_CHANNELS.renderPreview,
    DESKTOP_IPC_CHANNELS.renderExport,
  ],
  ink: [
    DESKTOP_IPC_CHANNELS.inkSetMode,
    DESKTOP_IPC_CHANNELS.inkSetOpacity,
    DESKTOP_IPC_CHANNELS.inkGetSettings,
    DESKTOP_IPC_CHANNELS.inkAppendEvents,
    DESKTOP_IPC_CHANNELS.inputTelemetryAppend,
    DESKTOP_IPC_CHANNELS.inkFlushComplete,
  ],
  teleprompter: [
    DESKTOP_IPC_CHANNELS.teleprompterConfigure,
    DESKTOP_IPC_CHANNELS.teleprompterSetMode,
    DESKTOP_IPC_CHANNELS.teleprompterGetState,
  ],
} as const satisfies Readonly<Record<DesktopRendererRole, readonly string[]>>;

export const desktopRendererEventChannelsByRole = {
  main: [
    DESKTOP_IPC_CHANNELS.inkSettingsChanged,
    DESKTOP_IPC_CHANNELS.teleprompterStateChanged,
  ],
  ink: [
    DESKTOP_IPC_CHANNELS.inkSettingsChanged,
    DESKTOP_IPC_CHANNELS.inkFlushRequested,
  ],
  teleprompter: [
    DESKTOP_IPC_CHANNELS.teleprompterStateChanged,
  ],
} as const satisfies Readonly<Record<DesktopRendererRole, readonly string[]>>;

const rendererRoles = new Set<string>(['main', 'ink', 'teleprompter']);
const invokeChannelsByRole: Readonly<Record<DesktopRendererRole, ReadonlySet<string>>> = {
  main: new Set<string>(desktopRendererInvokeChannelsByRole.main),
  ink: new Set<string>(desktopRendererInvokeChannelsByRole.ink),
  teleprompter: new Set<string>(desktopRendererInvokeChannelsByRole.teleprompter),
};
const eventChannelsByRole: Readonly<Record<DesktopRendererRole, ReadonlySet<string>>> = {
  main: new Set<string>(desktopRendererEventChannelsByRole.main),
  ink: new Set<string>(desktopRendererEventChannelsByRole.ink),
  teleprompter: new Set<string>(desktopRendererEventChannelsByRole.teleprompter),
};

export function isDesktopRendererRole(value: unknown): value is DesktopRendererRole {
  return typeof value === 'string' && rendererRoles.has(value);
}

export function isDesktopRendererIpcAllowed(
  role: DesktopRendererRole,
  operation: DesktopRendererIpcOperation,
  channel: string,
): boolean {
  if (!isDesktopRendererRole(role) || typeof channel !== 'string' || channel.length === 0) return false;
  if (operation === 'invoke') return invokeChannelsByRole[role].has(channel);
  if (operation === 'subscribe') return eventChannelsByRole[role].has(channel);
  return false;
}

/**
 * Pure sender-role authorization for future ipcMain wiring. The caller owns
 * registration and lifecycle of sender IDs; this contract only fails closed.
 */
export function authorizeDesktopRendererIpc(params: {
  senderId: number;
  operation: DesktopRendererIpcOperation;
  channel: string;
  roles: ReadonlyMap<number, unknown>;
}): DesktopRendererRole {
  if (!Number.isSafeInteger(params.senderId) || !params.roles.has(params.senderId)) {
    throw new Error('desktop_ipc_sender_unknown');
  }
  const role = params.roles.get(params.senderId);
  if (!isDesktopRendererRole(role)) throw new Error('desktop_ipc_role_invalid');
  if (!isDesktopRendererIpcAllowed(role, params.operation, params.channel)) {
    throw new Error('desktop_ipc_role_forbidden');
  }
  return role;
}

export const exposedDesktopEventChannels = [
  DESKTOP_IPC_CHANNELS.inkSettingsChanged,
  DESKTOP_IPC_CHANNELS.inkFlushRequested,
  DESKTOP_IPC_CHANNELS.teleprompterStateChanged,
] as const;
const desktopEventChannelSet = new Set<string>(exposedDesktopEventChannels);
export const exposedDesktopBridgeChannels = Object.values(DESKTOP_IPC_CHANNELS)
  .filter((channel) => !desktopEventChannelSet.has(channel));

export function isTrustedDesktopRendererUrl(candidate: string, rendererBaseUrl: string): boolean {
  try {
    const candidateUrl = new URL(candidate);
    const baseUrl = new URL(rendererBaseUrl);
    if (candidateUrl.origin !== baseUrl.origin) return false;
    if (baseUrl.protocol === 'https:') return candidateUrl.protocol === 'https:';
    return baseUrl.protocol === 'http:'
      && candidateUrl.protocol === 'http:'
      && (baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export function createDesktopWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#151515',
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}

export function createDesktopInkWindowOptions(
  preload: string,
  bounds: Rectangle,
): BrowserWindowConstructorOptions {
  return {
    ...bounds,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    movable: false,
    resizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}

interface DesktopDisplayGeometry {
  bounds: Rectangle;
  workArea: Rectangle;
}

export type DesktopTeleprompterWindowMode = 'compact' | 'expanded';

export function resolveDesktopTeleprompterBounds(
  display: DesktopDisplayGeometry,
  mode: DesktopTeleprompterWindowMode,
): Rectangle {
  const width = mode === 'compact'
    ? Math.min(820, Math.max(320, display.bounds.width - 32))
    : Math.min(520, Math.max(360, display.workArea.width - 32));
  const height = mode === 'compact' ? 44 : Math.min(380, display.workArea.height);
  const area = mode === 'compact' ? display.bounds : display.workArea;
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: area.y,
    width,
    height,
  };
}

export function createDesktopTeleprompterWindowOptions(
  preload: string,
  display: DesktopDisplayGeometry,
): BrowserWindowConstructorOptions {
  return {
    ...resolveDesktopTeleprompterBounds(display, 'compact'),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}

export function parseDesktopWindowMediaSourceId(mediaSourceId: string): number {
  const match = /^window:(\d+):\d+$/.exec(mediaSourceId);
  const windowID = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(windowID) || windowID <= 0 || windowID > 0xffff_ffff) {
    throw new Error('desktop_window_media_source_invalid');
  }
  return windowID;
}
