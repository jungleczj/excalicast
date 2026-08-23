import type { BrowserWindowConstructorOptions } from 'electron';
import { DESKTOP_IPC_CHANNELS } from '../../../src/desktop/productContract';

export const exposedDesktopBridgeChannels = Object.values(DESKTOP_IPC_CHANNELS);

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
