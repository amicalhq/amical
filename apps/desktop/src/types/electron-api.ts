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

  // Notes API
  notes: {
    create: (options: {
      title: string;
      transcriptionId?: number;
      initialContent?: string;
    }) => Promise<import("../db/schema").Note>;

    get: (id: number) => Promise<import("../db/schema").Note | null>;

    getByDocName: (
      docName: string,
    ) => Promise<import("../db/schema").Note | null>;

    list: (options?: {
      limit?: number;
      offset?: number;
      sortBy?: "title" | "updatedAt" | "createdAt" | "lastAccessedAt";
      sortOrder?: "asc" | "desc";
      search?: string;
      transcriptionId?: number | null;
    }) => Promise<import("../db/schema").Note[]>;

    update: (
      id: number,
      options: {
        title?: string;
        transcriptionId?: number | null;
      },
    ) => Promise<import("../db/schema").Note | null>;

    delete: (id: number) => Promise<import("../db/schema").Note | null>;

    getByTranscription: (
      transcriptionId: number,
    ) => Promise<import("../db/schema").Note[]>;

    getPersistence: (
      docName: string,
    ) => Promise<{ success: boolean; docName: string }>;

    saveYjsUpdate: (docName: string, update: ArrayBuffer) => Promise<void>;

    loadYjsUpdates: (docName: string) => Promise<ArrayBuffer[]>;
  };
}
