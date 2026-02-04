declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export interface ElectronAPI {
  // Platform information
  platform: NodeJS.Platform;

  // Listeners remain the same (two-way to renderer)
  onGlobalShortcut: (
    callback: (data: { shortcut: string }) => void,
  ) => (() => void) | void;
  onKeyEvent: (callback: (keyEvent: unknown) => void) => (() => void) | void;
  onForceStopMediaRecorder: (callback: () => void) => (() => void) | void;

  // Methods called from renderer to main become async (invoke/handle)
  sendAudioChunk: (chunk: Float32Array, isFinalChunk: boolean) => Promise<void>;

  // Model Management API (moved to tRPC)
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
