import * as Y from "yjs";
import { logger } from "../logger";
import { db } from "../../db";
import { getAppSettings, updateAppSettings } from "../../db/app-settings";
import { seedDailyStats } from "../../db/daily-stats";
import {
  getUniqueNoteIds,
  getYjsUpdatesByNoteId,
  replaceYjsUpdates,
} from "../../db/notes";
import { transcriptions } from "../../db/schema";
import {
  isLexicalEditorStateJsonString,
  serializePlainTextToLexicalEditorStateJson,
} from "../../services/notes/lexical-editor-state";
import { countWords, toLocalStatsDate } from "../../utils/dictation-stats";

const NOTES_LEXICAL_MIGRATION_VERSION = 1;
const DICTATION_DAILY_STATS_MIGRATION_VERSION = 2;

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

export async function runDataMigrations(): Promise<void> {
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
