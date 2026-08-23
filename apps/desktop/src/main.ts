import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DESKTOP_IPC_CHANNELS } from '../../../src/desktop/productContract';
import { spawnNativeHelper, type NativeHelperClient, type NativeHelperHandshake } from './nativeHelperClient';
import { createDesktopWindowOptions } from './windowContract';

let mainWindow: BrowserWindow | null = null;
let nativeHelper: NativeHelperClient | null = null;
let nativeHelperHandshake: NativeHelperHandshake | null = null;

async function initializeNativeHelper(): Promise<void> {
  const executablePath = process.env.EXCALICAST_MEDIA_HELPER_PATH
    ?? (app.isPackaged ? path.join(process.resourcesPath, 'bin', 'mac-media-engine') : '');
  if (!executablePath || !fs.existsSync(executablePath)) return;
  nativeHelper = spawnNativeHelper(executablePath);
  nativeHelperHandshake = await nativeHelper.handshake();
}

function registerDesktopIpc(): void {
  ipcMain.handle(DESKTOP_IPC_CHANNELS.captureStatus, () => ({
    available: nativeHelperHandshake !== null,
    helper: nativeHelperHandshake,
  }));
}

function createMainWindow(): BrowserWindow {
  const preload = path.join(__dirname, 'preload.js');
  const window = new BrowserWindow(createDesktopWindowOptions(preload));
  const rendererUrl = process.env.EXCALICAST_RENDERER_URL ?? 'http://localhost:3001/app';

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  void window.loadURL(rendererUrl);
  return window;
}

void app.whenReady().then(() => {
  registerDesktopIpc();
  void initializeNativeHelper().catch((error: unknown) => {
    nativeHelper?.close();
    nativeHelper = null;
    nativeHelperHandshake = null;
    console.error('[desktop] native helper unavailable', error);
  });
  mainWindow = createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on('before-quit', () => {
  nativeHelper?.close();
  nativeHelper = null;
  nativeHelperHandshake = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
