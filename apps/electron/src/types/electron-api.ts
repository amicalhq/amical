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

  // Model Management API
  getAvailableModels: () => Promise<import('../constants/models').Model[]>;
  getDownloadedModels: () => Promise<Record<string, import('../constants/models').DownloadedModel>>;
  isModelDownloaded: (modelId: string) => Promise<boolean>;
  getDownloadProgress: (
    modelId: string
  ) => Promise<import('../constants/models').DownloadProgress | null>;
  getActiveDownloads: () => Promise<import('../constants/models').DownloadProgress[]>;
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
  getFormatterConfig: () => Promise<import('../modules/formatter').FormatterConfig | null>;
  setFormatterConfig: (config: import('../modules/formatter').FormatterConfig) => Promise<void>;

  // Transcription Database API
  getTranscriptions: (options?: {
    limit?: number;
    offset?: number;
    sortBy?: 'timestamp' | 'createdAt';
    sortOrder?: 'asc' | 'desc';
    search?: string;
  }) => Promise<import('../db/schema').Transcription[]>;
  getTranscriptionById: (id: number) => Promise<import('../db/schema').Transcription | null>;
  createTranscription: (
    data: Omit<import('../db/schema').NewTranscription, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<import('../db/schema').Transcription>;
  updateTranscription: (
    id: number,
    data: Partial<Omit<import('../db/schema').Transcription, 'id' | 'createdAt'>>
  ) => Promise<import('../db/schema').Transcription | null>;
  deleteTranscription: (id: number) => Promise<import('../db/schema').Transcription | null>;
  getTranscriptionsCount: (search?: string) => Promise<number>;
  searchTranscriptions: (
    searchTerm: string,
    limit?: number
  ) => Promise<import('../db/schema').Transcription[]>;

  // Vocabulary Database API
  getVocabulary: (options?: {
    limit?: number;
    offset?: number;
    sortBy?: 'word' | 'dateAdded' | 'usageCount';
    sortOrder?: 'asc' | 'desc';
    search?: string;
  }) => Promise<import('../db/schema').Vocabulary[]>;
  getVocabularyById: (id: number) => Promise<import('../db/schema').Vocabulary | null>;
  getVocabularyByWord: (word: string) => Promise<import('../db/schema').Vocabulary | null>;
  createVocabularyWord: (
    data: Omit<import('../db/schema').NewVocabulary, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<import('../db/schema').Vocabulary>;
  updateVocabulary: (
    id: number,
    data: Partial<Omit<import('../db/schema').Vocabulary, 'id' | 'createdAt'>>
  ) => Promise<import('../db/schema').Vocabulary | null>;
  deleteVocabulary: (id: number) => Promise<import('../db/schema').Vocabulary | null>;
  getVocabularyCount: (search?: string) => Promise<number>;
  searchVocabulary: (
    searchTerm: string,
    limit?: number
  ) => Promise<import('../db/schema').Vocabulary[]>;
  bulkImportVocabulary: (
    words: Omit<import('../db/schema').NewVocabulary, 'id' | 'createdAt' | 'updatedAt'>[]
  ) => Promise<import('../db/schema').Vocabulary[]>;
  trackWordUsage: (word: string) => Promise<import('../db/schema').Vocabulary | null>;
  getMostUsedWords: (limit?: number) => Promise<import('../db/schema').Vocabulary[]>; // Model management event listeners
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
}
