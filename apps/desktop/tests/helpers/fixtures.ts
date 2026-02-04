import type { TestDatabase } from "./test-db";
import * as schema from "@db/schema";
import type {
  NewTranscription,
  NewVocabulary,
  NewModel,
  AppSettingsData,
} from "@db/schema";

/**
 * Default app settings for testing
 */
export const defaultAppSettings: AppSettingsData = {
  formatterConfig: {
    model: "gpt-4o-mini",
    enabled: false,
  },
  ui: {
    theme: "system",
  },
  transcription: {
    language: "en",
    autoTranscribe: true,
    confidenceThreshold: 0.7,
    enablePunctuation: true,
    enableTimestamps: false,
    preloadWhisperModel: false,
  },
  recording: {
    defaultFormat: "wav",
    sampleRate: 16000,
    autoStopSilence: true,
    silenceThreshold: -45,
    maxRecordingDuration: 600,
  },
  shortcuts: {
    pushToTalk: "CommandOrControl+Shift+Space",
    toggleRecording: "CommandOrControl+Shift+R",
    toggleWindow: "CommandOrControl+Shift+W",
  },
  modelProvidersConfig: {
    defaultSpeechModel: "local-whisper:ggml-base.en",
  },
  dictation: {
    autoDetectEnabled: true,
    selectedLanguage: "en",
  },
  preferences: {
    launchAtLogin: false,
    minimizeToTray: true,
    showWidgetWhileInactive: true,
  },
  telemetry: {
    enabled: false,
  },
  auth: {
    isAuthenticated: false,
    idToken: null,
    refreshToken: null,
    expiresAt: null,
  },
};

/**
 * Sample transcriptions for testing
 */
export const sampleTranscriptions: NewTranscription[] = [
  {
    text: "This is a test transcription",
    language: "en",
    confidence: 0.95,
    duration: 5,
    speechModel: "whisper-base",
    formattingModel: null,
  },
  {
    text: "Another test transcription with more content",
    language: "en",
    confidence: 0.88,
    duration: 8,
    speechModel: "whisper-base",
    formattingModel: "gpt-4o-mini",
  },
  {
    text: "A third transcription for comprehensive testing",
    language: "en",
    confidence: 0.92,
    duration: 6,
    speechModel: "whisper-large",
    formattingModel: null,
  },
];

/**
 * Sample vocabulary items for testing
 */
export const sampleVocabulary: NewVocabulary[] = [
  {
    word: "Amical",
    replacementWord: null,
    isReplacement: false,
    usageCount: 5,
  },
  {
    word: "API",
    replacementWord: null,
    isReplacement: false,
    usageCount: 3,
  },
  {
    word: "teh",
    replacementWord: "the",
    isReplacement: true,
    usageCount: 2,
  },
];

/**
 * Sample models for testing
 */
export const sampleModels: NewModel[] = [
  {
    id: "ggml-base.en",
    provider: "local-whisper",
    name: "Whisper Base English",
    type: "speech",
    size: "~147 MB",
    description: "Optimized for English transcription",
    localPath: "/test/models/ggml-base.en.bin",
    sizeBytes: 147964211,
    checksum: "test-checksum-base",
    downloadedAt: new Date(),
    speed: 4,
    accuracy: 3,
  },
  {
    id: "gpt-4o-mini",
    provider: "openrouter",
    name: "GPT-4o Mini",
    type: "language",
    context: "128k",
    description: "Fast and efficient language model",
    speed: 5,
    accuracy: 4,
  },
];

/**
 * Fixture presets
 */
export const fixtures = {
  /**
   * Empty database with only default settings
   */
  empty: async (testDb: TestDatabase) => {
    // Clear existing settings first
    await testDb.db.delete(schema.appSettings);
    // Insert default settings
    await testDb.db.insert(schema.appSettings).values({
      id: 1,
      data: defaultAppSettings,
      version: 1,
    });
  },

  /**
   * Database with existing transcriptions
   */
  withTranscriptions: async (testDb: TestDatabase) => {
    await fixtures.empty(testDb);
    await testDb.db.insert(schema.transcriptions).values(sampleTranscriptions);
  },

  /**
   * Database with vocabulary items
   */
  withVocabulary: async (testDb: TestDatabase) => {
    await fixtures.empty(testDb);
    await testDb.db.insert(schema.vocabulary).values(sampleVocabulary);
  },

  /**
   * Database with downloaded models
   */
  withModels: async (testDb: TestDatabase) => {
    await fixtures.empty(testDb);
    await testDb.db.insert(schema.models).values(sampleModels);
  },

  /**
   * Full database with all types of data
   */
  full: async (testDb: TestDatabase) => {
    await fixtures.empty(testDb);
    await testDb.db.insert(schema.transcriptions).values(sampleTranscriptions);
    await testDb.db.insert(schema.vocabulary).values(sampleVocabulary);
    await testDb.db.insert(schema.models).values(sampleModels);
  },

  /**
   * Database with custom settings
   */
  withCustomSettings: async (
    testDb: TestDatabase,
    settings: Partial<AppSettingsData>,
  ) => {
    // Clear existing settings first
    await testDb.db.delete(schema.appSettings);
    // Insert custom settings
    await testDb.db.insert(schema.appSettings).values({
      id: 1,
      data: { ...defaultAppSettings, ...settings },
      version: 1,
    });
  },

  /**
   * Database with authenticated user
   */
  withAuth: async (testDb: TestDatabase) => {
    await fixtures.withCustomSettings(testDb, {
      auth: {
        isAuthenticated: true,
        idToken: "test-id-token",
        refreshToken: "test-refresh-token",
        expiresAt: Date.now() + 3600000, // 1 hour from now
        userInfo: {
          sub: "test-user-123",
          email: "test@example.com",
          name: "Test User",
        },
      },
    });
  },
};

/**
 * Helper to seed specific data
 */
export async function seedDatabase(
  testDb: TestDatabase,
  fixture: keyof typeof fixtures | ((testDb: TestDatabase) => Promise<void>),
): Promise<void> {
  if (typeof fixture === "function") {
    await fixture(testDb);
  } else {
    await fixtures[fixture](testDb);
  }
}
