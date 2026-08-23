import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';
import { DESKTOP_IPC_CHANNELS } from '../../../src/desktop/productContract';

export const exposedDesktopEventChannels = [
  DESKTOP_IPC_CHANNELS.inkSettingsChanged,
  DESKTOP_IPC_CHANNELS.inkFlushRequested,
] as const;
const desktopEventChannelSet = new Set<string>(exposedDesktopEventChannels);
export const exposedDesktopBridgeChannels = Object.values(DESKTOP_IPC_CHANNELS)
  .filter((channel) => !desktopEventChannelSet.has(channel));

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

export function parseDesktopWindowMediaSourceId(mediaSourceId: string): number {
  const match = /^window:(\d+):\d+$/.exec(mediaSourceId);
  const windowID = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(windowID) || windowID <= 0 || windowID > 0xffff_ffff) {
    throw new Error('desktop_window_media_source_invalid');
  }
  return windowID;
}
