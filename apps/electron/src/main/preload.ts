// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { ElectronAPI } from '../types/electron-api';

interface ShortcutData {
  shortcut: string;
  // you can add more properties if you send more data from main
}

const api: ElectronAPI = {
  onRecordingStarting: async () => await ipcRenderer.invoke('recording-starting'),
  onRecordingStopping: async () => await ipcRenderer.invoke('recording-stopping'),
  sendAudioChunk: (chunk: ArrayBuffer, isFinalChunk: boolean = false): Promise<void> =>
    ipcRenderer.invoke('audio-data-chunk', chunk, isFinalChunk),

  onRecordingStateChanged: (callback: (newState: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, newState: boolean) => callback(newState);
    ipcRenderer.on('recording-state-changed', handler);
    return () => {
      ipcRenderer.removeListener('recording-state-changed', handler);
    };
  },
  // Switched to invoke/handle for request-response
  onGlobalShortcut: (callback: (data: ShortcutData) => void) => {
    const handler = (_event: IpcRendererEvent, data: ShortcutData) => callback(data);
    ipcRenderer.on('global-shortcut-event', handler);
    // Optional: Return a cleanup function to remove the listener
    return () => {
      ipcRenderer.removeListener('global-shortcut-event', handler);
    };
  },
  onKeyEvent: (callback: (keyEvent: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, keyEvent: unknown) => callback(keyEvent);
    ipcRenderer.on('key-event', handler);
    return () => {
      ipcRenderer.removeListener('key-event', handler);
    };
  },
  onForceStopMediaRecorder: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('force-stop-mediarecorder', handler);
    return () => {
      ipcRenderer.removeListener('force-stop-mediarecorder', handler);
    };
  },
  // If you want a way to remove all listeners for this event from renderer:
  // removeAllGlobalShortcutListeners: () => {
  //   ipcRenderer.removeAllListeners('global-shortcut-event');
  // }
  setApiKey: (apiKey: string) => ipcRenderer.invoke('set-api-key', apiKey),

  /* ----------------------- OAuth ------------------------- */
  oauthLogin: (): Promise<void> => ipcRenderer.invoke('oauth-login'),
  onOauthSuccess: (callback: (token: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, token: unknown) => callback(token);
    ipcRenderer.on('oauth-success', handler);
    return () => ipcRenderer.removeListener('oauth-success', handler);
  },
  onOauthError: (callback: (msg: string) => void) => {
    const handler = (_event: IpcRendererEvent, msg: string) => callback(msg);
    ipcRenderer.on('oauth-error', handler);
    return () => ipcRenderer.removeListener('oauth-error', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
