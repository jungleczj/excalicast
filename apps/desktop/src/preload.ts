import { contextBridge, ipcRenderer } from 'electron';
import {
  exposedDesktopBridgeChannels,
  exposedDesktopEventChannels,
} from './windowContract';

const allowed = new Set<string>(exposedDesktopBridgeChannels);
const allowedEvents = new Set<string>(exposedDesktopEventChannels);

contextBridge.exposeInMainWorld('excalicastDesktop', {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!allowed.has(channel)) return Promise.reject(new Error('desktop_ipc_channel_not_allowed'));
    return ipcRenderer.invoke(channel, payload);
  },
  subscribe(channel: string, listener: (payload: unknown) => void): () => void {
    if (!allowedEvents.has(channel)) throw new Error('desktop_ipc_event_not_allowed');
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
