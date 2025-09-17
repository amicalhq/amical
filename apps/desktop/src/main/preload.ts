// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import { exposeElectronTRPC } from "electron-trpc-experimental/preload";
import type { ElectronAPI } from "../types/electron-api";

interface ShortcutData {
  shortcut: string;
  // you can add more properties if you send more data from main
}

const api: ElectronAPI = {
  // Platform information
  platform: process.platform,

  sendAudioChunk: (
    chunk: Float32Array,
    isFinalChunk: boolean = false,
  ): Promise<void> => {
    // Convert Float32Array to ArrayBuffer for IPC transfer
    const buffer = chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength,
    );
    return ipcRenderer.invoke("audio-data-chunk", buffer, isFinalChunk);
  },
  // Switched to invoke/handle for request-response
  onGlobalShortcut: (callback: (data: ShortcutData) => void) => {
    const handler = (_event: IpcRendererEvent, data: ShortcutData) =>
      callback(data);
    ipcRenderer.on("global-shortcut-event", handler);
    // Optional: Return a cleanup function to remove the listener
    return () => {
      ipcRenderer.removeListener("global-shortcut-event", handler);
    };
  },
  onKeyEvent: (callback: (keyEvent: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, keyEvent: unknown) =>
      callback(keyEvent);
    ipcRenderer.on("key-event", handler);
    return () => {
      ipcRenderer.removeListener("key-event", handler);
    };
  },
  onForceStopMediaRecorder: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("force-stop-mediarecorder", handler);
    return () => {
      ipcRenderer.removeListener("force-stop-mediarecorder", handler);
    };
  },
  // If you want a way to remove all listeners for this event from renderer:
  // removeAllGlobalShortcutListeners: () => {
  //   ipcRenderer.removeAllListeners('global-shortcut-event');
  // }

  // Model Management API (moved to tRPC)
  // Transcription Database API (moved to tRPC)

  on: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_event: IpcRendererEvent, ...args: any[]) =>
      callback(...args);
    ipcRenderer.on(channel, handler);
    // Store the handler mapping for proper cleanup
    if (!(window as any).__electronEventHandlers) {
      (window as any).__electronEventHandlers = new Map();
    }
    if (!(window as any).__electronEventHandlers.has(channel)) {
      (window as any).__electronEventHandlers.set(channel, []);
    }
    (window as any).__electronEventHandlers
      .get(channel)
      .push({ original: callback, handler });
  },
  off: (channel: string, callback: (...args: any[]) => void) => {
    if (
      (window as any).__electronEventHandlers &&
      (window as any).__electronEventHandlers.has(channel)
    ) {
      const handlers = (window as any).__electronEventHandlers.get(channel);
      const handlerInfo = handlers.find((h: any) => h.original === callback);
      if (handlerInfo) {
        ipcRenderer.removeListener(channel, handlerInfo.handler);
        const index = handlers.indexOf(handlerInfo);
        handlers.splice(index, 1);
      }
    }
  },

  // Logging API for renderer process - sends to main process via IPC
  log: {
    info: (...args: any[]) =>
      ipcRenderer.invoke("log-message", "info", "renderer", ...args),
    warn: (...args: any[]) =>
      ipcRenderer.invoke("log-message", "warn", "renderer", ...args),
    error: (...args: any[]) =>
      ipcRenderer.invoke("log-message", "error", "renderer", ...args),
    debug: (...args: any[]) =>
      ipcRenderer.invoke("log-message", "debug", "renderer", ...args),
    scope: (name: string) => ({
      info: (...args: any[]) =>
        ipcRenderer.invoke("log-message", "info", name, ...args),
      warn: (...args: any[]) =>
        ipcRenderer.invoke("log-message", "warn", name, ...args),
      error: (...args: any[]) =>
        ipcRenderer.invoke("log-message", "error", name, ...args),
      debug: (...args: any[]) =>
        ipcRenderer.invoke("log-message", "debug", name, ...args),
    }),
  },

  // External link handling
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),

  // Notes API - Yjs synchronization only
  notes: {
    saveYjsUpdate: (noteId: number, update: ArrayBuffer) =>
      ipcRenderer.invoke("notes:saveYjsUpdate", noteId, update),

    loadYjsUpdates: (noteId: number) =>
      ipcRenderer.invoke("notes:loadYjsUpdates", noteId),
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);

// Expose tRPC for electron-trpc-experimental
process.once("loaded", async () => {
  exposeElectronTRPC();
});
