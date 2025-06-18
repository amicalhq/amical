declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export interface ElectronAPI {
  // Listeners remain the same (two-way to renderer)
  onRecordingStateChanged: (callback: (newState: boolean) => void) => (() => void) | void;
  onGlobalShortcut: (callback: (data: { shortcut: string }) => void) => (() => void) | void;
  onKeyEvent: (callback: (keyEvent: unknown) => void) => (() => void) | void;
  onForceStopMediaRecorder: (callback: () => void) => (() => void) | void;

  // Methods called from renderer to main become async (invoke/handle)
  sendAudioChunk: (chunk: ArrayBuffer, isFinalChunk: boolean) => Promise<void>;
  onRecordingStarting: () => Promise<void>;
  onRecordingStopping: () => Promise<void>;

  // New method for setting the API key
  setApiKey: (apiKey: string) => Promise<void>;

  // OAuth PKCE
  oauthLogin: () => Promise<void>;
  onOauthSuccess: (callback: (token: unknown) => void) => (() => void) | void;
  onOauthError: (callback: (msg: string) => void) => (() => void) | void;
}
