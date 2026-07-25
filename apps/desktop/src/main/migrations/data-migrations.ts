import * as Y from "yjs";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { db } from "../../db";
import { getAppSettings, updateAppSettings } from "../../db/app-settings";
import { seedDailyStats } from "../../db/daily-stats";
import {
  getUniqueNoteIds,
  getYjsUpdatesByNoteId,
  replaceYjsUpdates,
} from "../../db/notes";
import { snippets, transcriptions, vocabulary } from "../../db/schema";
import {
  sanitizeLegacySyncText,
  SYNC_KEY_MAX_LENGTH,
  SYNC_TEXT_MAX_LENGTH,
} from "../../db/sync-payload";
import {
  isLexicalEditorStateJsonString,
  serializePlainTextToLexicalEditorStateJson,
} from "../../services/notes/lexical-editor-state";
import { countWords, toLocalStatsDate } from "../../utils/dictation-stats";

const NOTES_LEXICAL_MIGRATION_VERSION = 1;
const DICTATION_DAILY_STATS_MIGRATION_VERSION = 2;
const SETTINGS_SYNC_BOUNDS_MIGRATION_VERSION = 1;

async function persistDataMigrationVersion(
  currentDataMigrations: Record<string, number>,
  migrationKey: string,
  version: number,
): Promise<Record<string, number>> {
  const nextDataMigrations = {
    ...currentDataMigrations,
    [migrationKey]: version,
  };

  await updateAppSettings({
    dataMigrations: nextDataMigrations,
  });

  return nextDataMigrations;
}

async function migrateNotesToLexicalEditorState(): Promise<{
  notesChecked: number;
  notesMigrated: number;
}> {
  const noteIds = await getUniqueNoteIds();
  let notesMigrated = 0;

  for (const noteId of noteIds) {
    const updates = await getYjsUpdatesByNoteId(noteId);
    if (updates.length === 0) continue;

    const ydoc = new Y.Doc();
    for (const update of updates) {
      const updateArray = new Uint8Array(update.updateData as Buffer);
      Y.applyUpdate(ydoc, updateArray);
    }

    const yText = ydoc.getText("content");
    const storedContent = yText.toString();

    if (!storedContent) continue;
    if (isLexicalEditorStateJsonString(storedContent)) continue;

    const migratedJson =
      serializePlainTextToLexicalEditorStateJson(storedContent);

    ydoc.transact(() => {
      yText.delete(0, yText.length);
      yText.insert(0, migratedJson);
    }, "notes-lexical-migration");

    const stateUpdate = Y.encodeStateAsUpdate(ydoc);
    await replaceYjsUpdates(noteId, stateUpdate);
    notesMigrated++;
  }

  return {
    notesChecked: noteIds.length,
    notesMigrated,
  };
}

async function migrateDictationDailyStats(): Promise<{
  transcriptionsChecked: number;
  statsDaysWritten: number;
}> {
  const existingTranscriptions = await db
    .select({
      text: transcriptions.text,
      timestamp: transcriptions.timestamp,
      language: transcriptions.language,
    })
    .from(transcriptions);

  const statsByDate = new Map<
    string,
    {
      wordCount: number;
      transcriptionCount: number;
      createdAt: Date;
      updatedAt: Date;
    }
  >();

  for (const transcription of existingTranscriptions) {
    const wordCount = countWords(transcription.text, transcription.language);

    const timestamp =
      transcription.timestamp instanceof Date
        ? transcription.timestamp
        : new Date(transcription.timestamp);
    const date = toLocalStatsDate(timestamp);
    const existingBucket = statsByDate.get(date);

    if (existingBucket) {
      existingBucket.wordCount += wordCount;
      existingBucket.transcriptionCount += 1;
      if (timestamp < existingBucket.createdAt) {
        existingBucket.createdAt = timestamp;
      }
      if (timestamp > existingBucket.updatedAt) {
        existingBucket.updatedAt = timestamp;
      }
      continue;
    }

    statsByDate.set(date, {
      wordCount,
      transcriptionCount: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await seedDailyStats(
    Array.from(statsByDate.entries()).map(([date, bucket]) => ({
      date,
      wordCount: bucket.wordCount,
      transcriptionCount: bucket.transcriptionCount,
      createdAt: bucket.createdAt,
      updatedAt: bucket.updatedAt,
    })),
  );

  return {
    transcriptionsChecked: existingTranscriptions.length,
    statsDaysWritten: statsByDate.size,
  };
}

async function migrateSettingsSyncBounds(): Promise<{
  vocabularyDeleted: number;
  snippetsDeleted: number;
}> {
  return await db.transaction(async (tx) => {
    const vocabularyRows = await tx.select().from(vocabulary);
    const snippetRows = await tx.select().from(snippets);

    const sanitizedVocabulary = vocabularyRows.map((row) => ({
      ...row,
      word: sanitizeLegacySyncText(row.word, SYNC_KEY_MAX_LENGTH),
      replacementWord:
        row.replacementWord === null
          ? null
          : sanitizeLegacySyncText(row.replacementWord, SYNC_TEXT_MAX_LENGTH),
    }));
    const sanitizedSnippets = snippetRows.map((row) => ({
      ...row,
      trigger: sanitizeLegacySyncText(row.trigger, SYNC_KEY_MAX_LENGTH),
      content: sanitizeLegacySyncText(row.content, SYNC_TEXT_MAX_LENGTH),
    }));

    const vocabularyIdsToDelete: string[] = [];
    const keptVocabulary: typeof sanitizedVocabulary = [];
    const seenWords = new Set<string>();
    for (const row of sanitizedVocabulary.sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (row.word.trim().length === 0 || seenWords.has(row.word)) {
        vocabularyIdsToDelete.push(row.id);
        continue;
      }
      seenWords.add(row.word);
      keptVocabulary.push(row);
    }

    const snippetIdsToDelete: string[] = [];
    const keptSnippets: typeof sanitizedSnippets = [];
    const seenTriggers = new Set<string>();
    for (const row of sanitizedSnippets.sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (
        row.trigger.trim().length === 0 ||
        row.content.length === 0 ||
        seenTriggers.has(row.trigger)
      ) {
        snippetIdsToDelete.push(row.id);
        continue;
      }
      seenTriggers.add(row.trigger);
      keptSnippets.push(row);
    }

    if (vocabularyIdsToDelete.length > 0) {
      await tx
        .delete(vocabulary)
        .where(inArray(vocabulary.id, vocabularyIdsToDelete));
    }
    if (snippetIdsToDelete.length > 0) {
      await tx.delete(snippets).where(inArray(snippets.id, snippetIdsToDelete));
    }

    // Move retained keys through unique temporary values so clipping can safely
    // handle swaps and collisions with another row's original key.
    for (const row of keptVocabulary) {
      await tx
        .update(vocabulary)
        .set({ word: `\0sync-vocabulary-${row.id}-${randomUUID()}` })
        .where(eq(vocabulary.id, row.id));
    }
    for (const row of keptSnippets) {
      await tx
        .update(snippets)
        .set({ trigger: `\0sync-snippet-${row.id}-${randomUUID()}` })
        .where(eq(snippets.id, row.id));
    }

    for (const row of keptVocabulary) {
      await tx
        .update(vocabulary)
        .set({
          word: row.word,
          replacementWord: row.replacementWord,
        })
        .where(eq(vocabulary.id, row.id));
    }
    for (const row of keptSnippets) {
      await tx
        .update(snippets)
        .set({
          trigger: row.trigger,
          content: row.content,
        })
        .where(eq(snippets.id, row.id));
    }

    return {
      vocabularyDeleted: vocabularyIdsToDelete.length,
      snippetsDeleted: snippetIdsToDelete.length,
    };
  });
}

async function runSettingsSyncBoundsMigration(): Promise<void> {
  const settings = await getAppSettings();
  const currentDataMigrations = settings.dataMigrations ?? {};

  if (
    (currentDataMigrations.settingsSyncBounds ?? 0) >=
    SETTINGS_SYNC_BOUNDS_MIGRATION_VERSION
  ) {
    return;
  }

  const startTime = Date.now();
  logger.db.info("Running settings sync bounds data migration", {
    settingsSyncBoundsFrom: currentDataMigrations.settingsSyncBounds ?? 0,
    settingsSyncBoundsTo: SETTINGS_SYNC_BOUNDS_MIGRATION_VERSION,
  });

  const { vocabularyDeleted, snippetsDeleted } =
    await migrateSettingsSyncBounds();

  await persistDataMigrationVersion(
    currentDataMigrations,
    "settingsSyncBounds",
    SETTINGS_SYNC_BOUNDS_MIGRATION_VERSION,
  );

  logger.db.info("Settings sync bounds data migration complete", {
    vocabularyDeleted,
    snippetsDeleted,
    durationMs: Date.now() - startTime,
  });
}

export async function runDataMigrations(): Promise<void> {
  try {
    await runSettingsSyncBoundsMigration();
  } catch (error) {
    logger.db.error("Settings sync bounds data migration failed", error);
    throw error;
  }

  try {
    const settings = await getAppSettings();
    let currentDataMigrations = settings.dataMigrations ?? {};

    if (
      (currentDataMigrations.notesLexical ?? 0) <
      NOTES_LEXICAL_MIGRATION_VERSION
    ) {
      const startTime = Date.now();
      logger.db.info("Running notes lexical data migration", {
        notesLexicalFrom: currentDataMigrations.notesLexical ?? 0,
        notesLexicalTo: NOTES_LEXICAL_MIGRATION_VERSION,
      });

      const { notesChecked, notesMigrated } =
        await migrateNotesToLexicalEditorState();

      currentDataMigrations = await persistDataMigrationVersion(
        currentDataMigrations,
        "notesLexical",
        NOTES_LEXICAL_MIGRATION_VERSION,
      );

      logger.db.info("Notes lexical migration complete", {
        notesChecked,
        notesMigrated,
        durationMs: Date.now() - startTime,
      });
    }

    if (
      (currentDataMigrations.dictationDailyStats ?? 0) <
      DICTATION_DAILY_STATS_MIGRATION_VERSION
    ) {
      const startTime = Date.now();
      logger.db.info("Running dictation daily stats migration", {
        dictationDailyStatsFrom: currentDataMigrations.dictationDailyStats ?? 0,
        dictationDailyStatsTo: DICTATION_DAILY_STATS_MIGRATION_VERSION,
      });

      const { transcriptionsChecked, statsDaysWritten } =
        await migrateDictationDailyStats();

      currentDataMigrations = await persistDataMigrationVersion(
        currentDataMigrations,
        "dictationDailyStats",
        DICTATION_DAILY_STATS_MIGRATION_VERSION,
      );

      logger.db.info("Dictation daily stats migration complete", {
        transcriptionsChecked,
        statsDaysWritten,
        durationMs: Date.now() - startTime,
      });
    }
  } catch (error) {
    logger.db.error("Data migrations failed", error);
  }
}
