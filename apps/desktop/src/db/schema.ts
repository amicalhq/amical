import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
  blob,
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

// Unified models table for all model types (Whisper, Language, Embedding)
export const models = sqliteTable(
  "models",
  {
    // Identity
    id: text("id").notNull(),
    provider: text("provider").notNull(), // "local-whisper", "openrouter", "ollama"

    // Common fields
    name: text("name").notNull(),
    type: text("type").notNull(), // "speech", "language", "embedding"
    size: text("size"), // Model size string (e.g., "7B", "Large", "~78 MB")
    context: text("context"), // Context window (e.g., "32k", "128k")
    description: text("description"),

    // Local model fields (only for downloaded Whisper models)
    localPath: text("local_path"), // Where file is stored on disk
    sizeBytes: integer("size_bytes"), // Actual file size in bytes
    checksum: text("checksum"), // SHA-1 hash for verification
    downloadedAt: integer("downloaded_at", { mode: "timestamp" }),

    // Remote model fields (OpenRouter/Ollama)
    originalModel: text("original_model", { mode: "json" }), // Original API response

    // Model characteristics (for UI display)
    speed: real("speed"), // 1-5 rating
    accuracy: real("accuracy"), // 1-5 rating

    // Timestamps
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
    // Indexes for efficient lookups
    index("models_provider_idx").on(table.provider),
    index("models_type_idx").on(table.type),
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
    defaultSpeechModel?: string; // Model ID for default speech model (Whisper)
    defaultLanguageModel?: string; // Model ID for default language model
    defaultEmbeddingModel?: string; // Model ID for default embedding model
  };

  dictation?: {
    autoDetectEnabled: boolean;
    selectedLanguage: string; // Required when autoDetectEnabled is false, defaults to "en"
  };
  preferences?: {
    launchAtLogin?: boolean;
    minimizeToTray?: boolean;
  };
}

// Notes table
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  content: text("content").default(""), // Store the actual text content
  icon: text("icon"), // Store the icon (emoji) associated with the note
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Yjs updates table for persistence
export const yjsUpdates = sqliteTable(
  "yjs_updates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    noteId: integer("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    updateData: blob("update_data", { mode: "buffer" }).notNull(), // Binary data stored as Buffer
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    // Index for efficient foreign key lookups
    index("yjs_updates_note_id_idx").on(table.noteId),
  ],
);

// Export types for TypeScript
export type Transcription = typeof transcriptions.$inferSelect;
export type NewTranscription = typeof transcriptions.$inferInsert;
export type Vocabulary = typeof vocabulary.$inferSelect;
export type NewVocabulary = typeof vocabulary.$inferInsert;
export type Model = typeof models.$inferSelect;
export type NewModel = typeof models.$inferInsert;
export type AppSettings = typeof appSettings.$inferSelect;
export type NewAppSettings = typeof appSettings.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type YjsUpdate = typeof yjsUpdates.$inferSelect;
export type NewYjsUpdate = typeof yjsUpdates.$inferInsert;
