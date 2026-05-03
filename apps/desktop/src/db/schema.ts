import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  blob,
} from "drizzle-orm/sqlite-core";
import type { HistoryRetentionPeriod } from "../constants/history-retention";

// Transcriptions table
export const transcriptions = sqliteTable("transcriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  language: text("language").default("en"),
  detectedLanguage: text("detected_language"),
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
    providerType: text("provider_type").notNull(), // "amical", "local-whisper", "openrouter", "ollama", "openai-compatible"
    providerInstanceId: text("provider_instance_id").notNull(), // Stable configured instance ID
    provider: text("provider").notNull(), // Display label

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
    // Composite primary key on (provider instance, type, id)
    primaryKey({ columns: [table.providerInstanceId, table.type, table.id] }),
    // Indexes for efficient lookups
    index("models_provider_type_idx").on(table.providerType),
    index("models_provider_instance_idx").on(table.providerInstanceId),
    index("models_type_idx").on(table.type),
  ],
);

// Define the shape of our settings JSON
export interface AppSettingsData {
  formatterConfig?: {
    enabled: boolean;
    modelId?: string; // Selection key "<providerInstanceId>::<type>::<id>" or legacy raw model ID
    fallbackModelId?: string; // Last non-cloud formatting selection key or legacy raw model ID
  };
  ui?: {
    theme: "light" | "dark" | "system";
    locale?: string;
    notesWindow?: {
      xRatio: number;
      yRatio: number;
      widthRatio: number;
      heightRatio: number;
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
    pushToTalk?: number[];
    toggleRecording?: number[];
    pasteLastTranscript?: number[];
    newNote?: number[];
  };

  modelProvidersConfig?: {
    openRouter?: {
      apiKey: string;
    };
    ollama?: {
      url: string;
    };
    openAICompatible?: {
      apiKey: string;
      baseURL: string;
    };
    defaultSpeechModel?: string; // Selection key "<providerInstanceId>::speech::<id>" or legacy speech model ID
    defaultLanguageModel?: string; // Selection key "<providerInstanceId>::language::<id>" or legacy language model ID
    defaultEmbeddingModel?: string; // Selection key "<providerInstanceId>::embedding::<id>" or legacy embedding model ID
  };

  dictation?: {
    autoDetectEnabled: boolean;
    selectedLanguage: string; // Concrete language used when auto-detect is disabled
  };
  preferences?: {
    launchAtLogin?: boolean;
    minimizeToTray?: boolean;
    showWidgetWhileInactive?: boolean;
    showInDock?: boolean;
    muteSystemAudio?: boolean;
    muteDictationSounds?: boolean;
    autoDictateOnNewNote?: boolean;
    preserveClipboard?: boolean;
  };
  history?: {
    retentionPeriod: HistoryRetentionPeriod;
  };
  telemetry?: {
    enabled?: boolean;
  };
  auth?: {
    isAuthenticated: boolean;
    idToken: string | null;
    refreshToken: string | null;
    accessToken: string | null;
    expiresAt: number | null;
    userInfo?: {
      sub: string;
      email?: string;
      name?: string;
    };
  };
  onboarding?: {
    completedVersion: number;
    completedAt: string; // ISO 8601 timestamp
    lastVisitedScreen?: string; // Last screen user was on (for resume)
    skippedScreens?: string[]; // Screens skipped via feature flags
    featureInterests?: string[]; // Selected features (max 3)
    discoverySource?: string; // How user found Amical
    selectedModelType: "cloud" | "local"; // User's model choice
    modelRecommendation?: {
      suggested: "cloud" | "local"; // System recommendation
      reason: string; // Human-readable explanation
      followed: boolean; // Whether user followed recommendation
    };
  };
  compute?: {
    /**
     * Compute device preference for local speech models.
     * - "auto" (default): the native loader picks the best available backend.
     * - "cpu": force the CPU-only build even if a GPU binary is shipped.
     * - "gpu": use the GPU backend compiled for the host. `gpuDevice` selects
     *   which adapter inside that backend (0-based; CUDA/Vulkan/Metal index).
     */
    device: "auto" | "cpu" | "gpu";
    gpuDevice?: number;
    /** Optional thread count for CPU inference; undefined = whisper.cpp default. */
    threads?: number;
  };
  updateChannel?: "stable" | "beta";
  featureFlags?: {
    flags?: Record<string, string | boolean>;
    payloads?: Record<string, unknown>;
    lastFetchedAt?: string; // ISO 8601
  };
  dataMigrations?: {
    notesLexical?: number;
    dictationDailyStats?: number;
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

export const dailyStats = sqliteTable(
  "daily_stats",
  {
    id: text("id").notNull().primaryKey(),
    date: text("date").notNull(),
    wordCount: integer("word_count").notNull().default(0),
    transcriptionCount: integer("transcription_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("daily_stats_date_unique_idx").on(table.date)],
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
export type DailyStat = typeof dailyStats.$inferSelect;
export type NewDailyStat = typeof dailyStats.$inferInsert;
