declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export interface ElectronAPI {
  // Listeners remain the same (two-way to renderer)
  onGlobalShortcut: (
    callback: (data: { shortcut: string }) => void,
  ) => (() => void) | void;
  onKeyEvent: (callback: (keyEvent: unknown) => void) => (() => void) | void;
  onForceStopMediaRecorder: (callback: () => void) => (() => void) | void;

  // Methods called from renderer to main become async (invoke/handle)
  sendAudioChunk: (chunk: Float32Array, isFinalChunk: boolean) => Promise<void>;

  // Model Management API
  getAvailableModels: () => Promise<import("../constants/models").Model[]>;
  getDownloadedModels: () => Promise<
    Record<string, import("../db/schema").DownloadedModel>
  >;
  isModelDownloaded: (modelId: string) => Promise<boolean>;
  getDownloadProgress: (
    modelId: string,
  ) => Promise<import("../constants/models").DownloadProgress | null>;
  getActiveDownloads: () => Promise<
    import("../constants/models").DownloadProgress[]
  >;
  downloadModel: (modelId: string) => Promise<void>;
  cancelDownload: (modelId: string) => Promise<void>;
  deleteModel: (modelId: string) => Promise<void>;
  getModelsDirectory: () => Promise<string>;

  // Local Whisper API
  isLocalWhisperAvailable: () => Promise<boolean>;
  getLocalWhisperModels: () => Promise<string[]>;
  getSelectedModel: () => Promise<string | null>;
  setSelectedModel: (modelId: string) => Promise<void>;
  setWhisperExecutablePath: (path: string) => Promise<void>;

  // Formatter Configuration API
  getFormatterConfig: () => Promise<
    import("../types/formatter").FormatterConfig | null
  >;
  setFormatterConfig: (
    config: import("../types/formatter").FormatterConfig,
  ) => Promise<void>;

  // Transcription Database API (moved to tRPC)

  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;

  // Logging API for renderer process
  log: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug: (...args: any[]) => void;
    scope: (name: string) => {
      info: (...args: any[]) => void;
      warn: (...args: any[]) => void;
      error: (...args: any[]) => void;
      debug: (...args: any[]) => void;
    };
  };

  // External link handling
  openExternal: (url: string) => Promise<void>;
}
