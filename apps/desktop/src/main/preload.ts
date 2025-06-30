// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import { exposeElectronTRPC } from "electron-trpc-experimental/preload";
import type { ElectronAPI } from "../types/electron-api";
import type { FormatterConfig } from "../types/formatter";

interface ShortcutData {
  shortcut: string;
  // you can add more properties if you send more data from main
}

const api: ElectronAPI = {
  sendAudioChunk: (
    chunk: ArrayBuffer,
    isFinalChunk: boolean = false,
  ): Promise<void> =>
    ipcRenderer.invoke("audio-data-chunk", chunk, isFinalChunk),
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

  // Model Management API
  getAvailableModels: () => ipcRenderer.invoke("get-available-models"),
  getDownloadedModels: () => ipcRenderer.invoke("get-downloaded-models"),
  isModelDownloaded: (modelId: string) =>
    ipcRenderer.invoke("is-model-downloaded", modelId),
  getDownloadProgress: (modelId: string) =>
    ipcRenderer.invoke("get-download-progress", modelId),
  getActiveDownloads: () => ipcRenderer.invoke("get-active-downloads"),
  downloadModel: (modelId: string) =>
    ipcRenderer.invoke("download-model", modelId),
  cancelDownload: (modelId: string) =>
    ipcRenderer.invoke("cancel-download", modelId),
  deleteModel: (modelId: string) => ipcRenderer.invoke("delete-model", modelId),
  getModelsDirectory: () => ipcRenderer.invoke("get-models-directory"),

  // Local Whisper API
  isLocalWhisperAvailable: () =>
    ipcRenderer.invoke("is-local-whisper-available"),
  getLocalWhisperModels: () => ipcRenderer.invoke("get-local-whisper-models"),
  getSelectedModel: () => ipcRenderer.invoke("get-selected-model"),
  setSelectedModel: (modelId: string) =>
    ipcRenderer.invoke("set-selected-model", modelId),
  setWhisperExecutablePath: (path: string) =>
    ipcRenderer.invoke("set-whisper-executable-path", path),

  // Formatter Configuration API
  getFormatterConfig: () => ipcRenderer.invoke("get-formatter-config"),
  setFormatterConfig: (config: FormatterConfig) =>
    ipcRenderer.invoke("set-formatter-config", config),

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
};

contextBridge.exposeInMainWorld("electronAPI", api);

// Expose tRPC for electron-trpc-experimental
process.once("loaded", async () => {
  exposeElectronTRPC();
});
