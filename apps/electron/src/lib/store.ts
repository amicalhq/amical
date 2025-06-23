import Store from 'electron-store';

// Define the store schema for app settings and preferences
interface StoreSchema {
  // App preferences
  preferences: {
    theme: 'light' | 'dark' | 'system';
    language: string;
    autoSave: boolean;
    notifications: boolean;
    minimizeToTray: boolean;
    startMinimized: boolean;
  };
  
  // Recording settings
  recording: {
    defaultFormat: 'wav' | 'mp3' | 'flac';
    sampleRate: 16000 | 22050 | 44100 | 48000;
    bitRate: 128 | 192 | 256 | 320;
    autoStopSilence: boolean;
    silenceThreshold: number; // in seconds
    maxRecordingDuration: number; // in minutes
    audioDevice?: string; // Device ID
  };
  
  // Transcription settings
  transcription: {
    provider: 'openai' | 'local';
    model: string;
    language: string;
    autoTranscribe: boolean;
    confidenceThreshold: number; // 0-1
    enablePunctuation: boolean;
    enableTimestamps: boolean;
    customVocabularyEnabled: boolean;
  };
  
  
  // UI state
  ui: {
    sidebarOpen: boolean;
    currentView: string;
    windowBounds?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    columnWidths?: Record<string, number>;
    lastUsedPaths: {
      exportDirectory?: string;
      importDirectory?: string;
    };
  };
  
  // Recently used items
  recent: {
    searchTerms: string[];
    exportFormats: string[];
    languages: string[];
  };
  
  // App metadata
  app: {
    firstRun: boolean;
    lastVersion: string;
    installDate: string;
    lastUpdateCheck: string;
    telemetryEnabled: boolean;
  };
}

// Create the store instance with schema validation
export const store = new Store<StoreSchema>({
  name: 'amical-settings',
  
  // Default values
  defaults: {
    preferences: {
      theme: 'system',
      language: 'en',
      autoSave: true,
      notifications: true,
      minimizeToTray: true,
      startMinimized: false,
    },
    
    recording: {
      defaultFormat: 'wav',
      sampleRate: 16000,
      bitRate: 192,
      autoStopSilence: true,
      silenceThreshold: 3,
      maxRecordingDuration: 60,
    },
    
    transcription: {
      provider: 'local',
      model: 'whisper-large-v1',
      language: 'en',
      autoTranscribe: true,
      confidenceThreshold: 0.8,
      enablePunctuation: true,
      enableTimestamps: false,
      customVocabularyEnabled: true,
    },
    
    ui: {
      sidebarOpen: false,
      currentView: 'Voice Recording',
      lastUsedPaths: {},
    },
    
    recent: {
      searchTerms: [],
      exportFormats: [],
      languages: [],
    },
    
    app: {
      firstRun: true,
      lastVersion: '1.0.0',
      installDate: new Date().toISOString(),
      lastUpdateCheck: new Date().toISOString(),
      telemetryEnabled: false,
    },
  },
  
  // Encrypt sensitive data
  encryptionKey: 'amical-app-encryption-key', // In production, use a more secure key
  
  // Schema validation
  schema: {
    preferences: {
      type: 'object',
      properties: {
        theme: { type: 'string', enum: ['light', 'dark', 'system'] },
        language: { type: 'string' },
        autoSave: { type: 'boolean' },
        notifications: { type: 'boolean' },
        minimizeToTray: { type: 'boolean' },
        startMinimized: { type: 'boolean' },
      },
    },
    recording: {
      type: 'object',
      properties: {
        defaultFormat: { type: 'string', enum: ['wav', 'mp3', 'flac'] },
        sampleRate: { type: 'number', enum: [16000, 22050, 44100, 48000] },
        bitRate: { type: 'number', enum: [128, 192, 256, 320] },
        autoStopSilence: { type: 'boolean' },
        silenceThreshold: { type: 'number', minimum: 0 },
        maxRecordingDuration: { type: 'number', minimum: 1 },
        audioDevice: { type: 'string' },
      },
    },
    transcription: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['openai', 'local'] },
        model: { type: 'string' },
        language: { type: 'string' },
        autoTranscribe: { type: 'boolean' },
        confidenceThreshold: { type: 'number', minimum: 0, maximum: 1 },
        enablePunctuation: { type: 'boolean' },
        enableTimestamps: { type: 'boolean' },
        customVocabularyEnabled: { type: 'boolean' },
      },
    },
    ui: {
      type: 'object',
      properties: {
        sidebarOpen: { type: 'boolean' },
        currentView: { type: 'string' },
        windowBounds: { type: 'object' },
        columnWidths: { type: 'object' },
        lastUsedPaths: { type: 'object' },
      },
    },
    recent: {
      type: 'object',
      properties: {
        searchTerms: { type: 'array', items: { type: 'string' } },
        exportFormats: { type: 'array', items: { type: 'string' } },
        languages: { type: 'array', items: { type: 'string' } },
      },
    },
    app: {
      type: 'object',
      properties: {
        firstRun: { type: 'boolean' },
        lastVersion: { type: 'string' },
        installDate: { type: 'string' },
        lastUpdateCheck: { type: 'string' },
        telemetryEnabled: { type: 'boolean' },
      },
    },
  },
});

// Helper functions for common operations
export const storeHelpers = {
  // Get a preference value
  getPreference<K extends keyof StoreSchema['preferences']>(key: K): StoreSchema['preferences'][K] {
    return store.get('preferences')[key];
  },
  
  // Set a preference value
  setPreference<K extends keyof StoreSchema['preferences']>(key: K, value: StoreSchema['preferences'][K]) {
    const preferences = store.get('preferences');
    store.set('preferences', { ...preferences, [key]: value });
  },
  
  // Get recording settings
  getRecordingSetting<K extends keyof StoreSchema['recording']>(key: K): StoreSchema['recording'][K] {
    return store.get('recording')[key];
  },
  
  // Set recording settings
  setRecordingSetting<K extends keyof StoreSchema['recording']>(key: K, value: StoreSchema['recording'][K]) {
    const recording = store.get('recording');
    store.set('recording', { ...recording, [key]: value });
  },
  
  // Get transcription settings
  getTranscriptionSetting<K extends keyof StoreSchema['transcription']>(key: K): StoreSchema['transcription'][K] {
    return store.get('transcription')[key];
  },
  
  // Set transcription settings
  setTranscriptionSetting<K extends keyof StoreSchema['transcription']>(key: K, value: StoreSchema['transcription'][K]) {
    const transcription = store.get('transcription');
    store.set('transcription', { ...transcription, [key]: value });
  },
  
  // Window bounds management
  saveWindowBounds(bounds: StoreSchema['ui']['windowBounds']) {
    store.set('ui.windowBounds', bounds);
  },
  
  getWindowBounds(): StoreSchema['ui']['windowBounds'] {
    return store.get('ui.windowBounds');
  },
  
  // Recent items management
  addRecentSearchTerm(term: string) {
    const recent = store.get('recent.searchTerms', []);
    const updated = [term, ...recent.filter(t => t !== term)].slice(0, 10);
    store.set('recent.searchTerms', updated);
  },
  
  
  // Clear all data
  clearAll() {
    store.clear();
  },
  
  // Reset to defaults
  resetToDefaults() {
    store.clear();
  },
};

// Export types for use in other files
export type { StoreSchema }; 