import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// Transcriptions table
export const transcriptions = sqliteTable("transcriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  language: text("language").default("en"),
  audioFile: text("audio_file"), // Path to the audio file
  confidence: real("confidence"), // AI confidence score (0-1)
  duration: integer("duration"), // Duration in seconds
  speechModel: text("speech_model"), // Model used for speech recognition
  formattingModel: text("formatting_model"), // Model used for formatting
  meta: text("meta", { mode: "json" }), // Additional metadata as JSON
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Vocabulary table
export const vocabulary = sqliteTable("vocabulary", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  word: text("word").notNull().unique(),
  replacementWord: text("replacement_word"),
  isReplacement: integer("is_replacement", { mode: "boolean" }).default(false),
  dateAdded: integer("date_added", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  usageCount: integer("usage_count").default(0), // How many times this word appeared in transcriptions
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Downloaded models table
export const downloadedModels = sqliteTable("downloaded_models", {
  id: text("id").primaryKey(), // Model ID (e.g., 'whisper-large-v3')
  name: text("name").notNull(),
  type: text("type").notNull(), // 'whisper', 'llama', etc.
  localPath: text("local_path").notNull(),
  downloadedAt: integer("downloaded_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  size: integer("size").notNull(), // File size in bytes
  checksum: text("checksum"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// App settings table with typed JSON
export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  data: text("data", { mode: "json" }).$type<AppSettingsData>().notNull(),
  version: integer("version").notNull().default(1), // For migrations
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const providerModels = sqliteTable(
  "provider_models",
  {
    id: text("id").notNull(), // Model ID (not globally unique)
    name: text("name").notNull(),
    provider: text("provider").notNull(), // "OpenRouter" | "Ollama"
    size: text("size"), // Model size (e.g., "7B", "Large")
    context: text("context").notNull(), // Context length (e.g., "32k", "128k")
    description: text("description"), // Optional description
    originalModel: text("original_model", { mode: "json" }), // Store original API response
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    // Composite primary key on (provider, id)
    primaryKey({ columns: [table.provider, table.id] }),
    // Index on provider for efficient provider-scoped lookups
    index("provider_models_provider_idx").on(table.provider),
  ],
);

// Define the shape of our settings JSON
export interface AppSettingsData {
  formatterConfig?: {
    model: string; // Now stores the model ID from synced models
    enabled: boolean;
  };
  ui?: {
    theme: "light" | "dark" | "system";
    sidebarOpen?: boolean;
    currentView?: string;
    windowBounds?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
  transcription?: {
    language: string;
    autoTranscribe: boolean;
    confidenceThreshold: number;
    enablePunctuation: boolean;
    enableTimestamps: boolean;
    preloadWhisperModel?: boolean;
  };
  recording?: {
    defaultFormat: "wav" | "mp3" | "flac";
    sampleRate: 16000 | 22050 | 44100 | 48000;
    autoStopSilence: boolean;
    silenceThreshold: number;
    maxRecordingDuration: number;
    preferredMicrophoneName?: string;
  };
  shortcuts?: {
    pushToTalk?: string;
    toggleRecording?: string;
    toggleWindow?: string;
  };

  modelProvidersConfig?: {
    openRouter?: {
      apiKey: string;
    };
    ollama?: {
      url: string;
    };
    defaultLanguageModel?: string; // Model ID for default language model
    defaultEmbeddingModel?: string; // Model ID for default embedding model
  };

  dictation?: {
    autoDetectEnabled: boolean;
    selectedLanguage: string; // Required when autoDetectEnabled is false, defaults to "en"
  };
}

// Export types for TypeScript
export type Transcription = typeof transcriptions.$inferSelect;
export type NewTranscription = typeof transcriptions.$inferInsert;
export type Vocabulary = typeof vocabulary.$inferSelect;
export type NewVocabulary = typeof vocabulary.$inferInsert;
export type DownloadedModel = typeof downloadedModels.$inferSelect;
export type NewDownloadedModel = typeof downloadedModels.$inferInsert;
export type ProviderModelDB = typeof providerModels.$inferSelect;
export type NewProviderModelDB = typeof providerModels.$inferInsert;
export type AppSettings = typeof appSettings.$inferSelect;
export type NewAppSettings = typeof appSettings.$inferInsert;
