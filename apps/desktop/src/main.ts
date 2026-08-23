import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DESKTOP_IPC_CHANNELS } from '../../../src/desktop/productContract';
import {
  spawnNativeHelper,
  type NativeHelperClient,
  type NativeHelperHandshake,
} from './nativeHelperClient';
import { parseDesktopCapturePayload } from './captureRequest';
import { createDesktopWindowOptions } from './windowContract';

let mainWindow: BrowserWindow | null = null;
let nativeHelper: NativeHelperClient | null = null;
let nativeHelperHandshake: NativeHelperHandshake | null = null;
let nativeHelperInitialization: Promise<void> | null = null;

async function initializeNativeHelper(): Promise<void> {
  const packagedPath = path.join(process.resourcesPath, 'bin', 'mac-media-engine');
  const developmentPath = path.join(
    app.getAppPath(),
    'native/mac-media-engine/.build-local/arm64-apple-macosx/debug/mac-media-engine',
  );
  const executablePath = process.env.EXCALICAST_MEDIA_HELPER_PATH
    ?? (app.isPackaged ? packagedPath : developmentPath);
  if (!executablePath || !fs.existsSync(executablePath)) return;
  nativeHelper = spawnNativeHelper(executablePath);
  nativeHelperHandshake = await nativeHelper.handshake();
}

function registerDesktopIpc(): void {
  ipcMain.handle(DESKTOP_IPC_CHANNELS.capturePermissions, async () => {
    const helper = await requireNativeHelper();
    return helper.capturePermissions();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.captureRequestPermissions, async (_event, payload: unknown) => {
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const helper = await requireNativeHelper();
    return helper.requestCapturePermissions({
      captureMicrophone: value.captureMicrophone === true,
      captureCamera: value.captureCamera === true,
    });
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.captureSources, async () => {
    const helper = await requireNativeHelper();
    return helper.captureSources();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.captureDevices, async () => {
    const helper = await requireNativeHelper();
    return helper.captureDevices();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.capturePreflight, async (_event, payload: unknown) => {
    const helper = await requireNativeHelper();
    return helper.preflightCapture(toNativeCaptureRequest(payload));
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.captureStart, async (_event, payload: unknown) => {
    const helper = await requireNativeHelper();
    return helper.startCapture(toNativeCaptureRequest(payload));
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.captureStop, async () => {
    const helper = await requireNativeHelper();
    return helper.stopCapture();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.captureStatus, async () => {
    if (nativeHelperInitialization) await nativeHelperInitialization;
    if (!nativeHelper) return { available: false, state: 'idle', helper: null };
    const status = await nativeHelper.captureStatus();
    return {
      available: true,
      ...status,
      helper: nativeHelperHandshake,
    };
  });
}

async function requireNativeHelper(): Promise<NativeHelperClient> {
  if (nativeHelperInitialization) await nativeHelperInitialization;
  if (!nativeHelper) throw new Error('native_media_helper_unavailable');
  return nativeHelper;
}

function toNativeCaptureRequest(payload: unknown) {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const recordingId = typeof value.recordingId === 'string' ? value.recordingId : '';
  return parseDesktopCapturePayload(
    payload,
    path.join(app.getPath('videos'), 'Excalicast Projects', recordingId),
  );
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
  nativeHelperInitialization = initializeNativeHelper().catch((error: unknown) => {
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
