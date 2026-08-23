import { contextBridge, ipcRenderer } from 'electron';
import { exposedDesktopBridgeChannels } from './windowContract';

const allowed = new Set<string>(exposedDesktopBridgeChannels);

contextBridge.exposeInMainWorld('excalicastDesktop', {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!allowed.has(channel)) return Promise.reject(new Error('desktop_ipc_channel_not_allowed'));
    return ipcRenderer.invoke(channel, payload);
  },
});
