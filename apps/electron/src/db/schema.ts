import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// Transcriptions table
export const transcriptions = sqliteTable('transcriptions', {
  id: text('id').primaryKey(),
  text: text('text').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  language: text('language').default('en'),
  audioFile: text('audio_file'), // Path to the audio file
  confidence: real('confidence'), // AI confidence score (0-1)
  duration: integer('duration'), // Duration in seconds
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Vocabulary table
export const vocabulary = sqliteTable('vocabulary', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  word: text('word').notNull().unique(),
  pronunciation: text('pronunciation'), // Optional phonetic pronunciation
  definition: text('definition'), // Optional definition
  category: text('category'), // Optional category (e.g., "technical", "medical", etc.)
  priority: integer('priority').default(1), // Priority level for transcription (1-5)
  dateAdded: integer('date_added', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastUsed: integer('last_used', { mode: 'timestamp' }), // Track when word was last encountered
  usageCount: integer('usage_count').default(0), // How many times this word appeared in transcriptions
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Audio recordings metadata table (optional, for linking with transcriptions)
export const recordings = sqliteTable('recordings', {
  id: text('id').primaryKey(),
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(),
  fileSize: integer('file_size'), // File size in bytes
  duration: integer('duration'), // Duration in seconds
  sampleRate: integer('sample_rate'), // Audio sample rate
  format: text('format').default('wav'), // Audio format (wav, mp3, etc.)
  transcriptionId: text('transcription_id').references(() => transcriptions.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Settings table for app configuration
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  type: text('type').notNull().default('string'), // 'string', 'number', 'boolean', 'json'
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Export types for TypeScript
export type Transcription = typeof transcriptions.$inferSelect;
export type NewTranscription = typeof transcriptions.$inferInsert;
export type Vocabulary = typeof vocabulary.$inferSelect;
export type NewVocabulary = typeof vocabulary.$inferInsert;
export type Recording = typeof recordings.$inferSelect;
export type NewRecording = typeof recordings.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
