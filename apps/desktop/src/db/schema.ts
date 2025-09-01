import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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

// Define the shape of our settings JSON
export interface AppSettingsData {
  formatterConfig?: {
    provider: "openrouter";
    model: string;
    apiKey: string;
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
}

// Notes table
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  content: text("content").default(""), // Store the actual text content
  docName: text("doc_name").notNull().unique(), // yjs document name
  transcriptionId: integer("transcription_id").references(
    () => transcriptions.id,
  ),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastAccessedAt: integer("last_accessed_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Yjs updates table for persistence
export const yjsUpdates = sqliteTable("yjs_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  docName: text("doc_name").notNull(),
  updateData: text("update_data").notNull(), // Base64 encoded binary data
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Note metadata table
export const noteMetadata = sqliteTable(
  "note_metadata",
  {
    noteId: integer("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => ({
    pk: {
      primaryKey: {
        columns: [table.noteId, table.key],
      },
    },
  }),
);

// Export types for TypeScript
export type Transcription = typeof transcriptions.$inferSelect;
export type NewTranscription = typeof transcriptions.$inferInsert;
export type Vocabulary = typeof vocabulary.$inferSelect;
export type NewVocabulary = typeof vocabulary.$inferInsert;
export type DownloadedModel = typeof downloadedModels.$inferSelect;
export type NewDownloadedModel = typeof downloadedModels.$inferInsert;
export type AppSettings = typeof appSettings.$inferSelect;
export type NewAppSettings = typeof appSettings.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type YjsUpdate = typeof yjsUpdates.$inferSelect;
export type NewYjsUpdate = typeof yjsUpdates.$inferInsert;
export type NoteMetadata = typeof noteMetadata.$inferSelect;
export type NewNoteMetadata = typeof noteMetadata.$inferInsert;
