import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { logger } from "../logger";
import { db } from "../../db";
import { getAppSettings, updateAppSettings } from "../../db/app-settings";
import { migrateLegacyNotes } from "../../db/note-body";
import { snippets, vocabulary } from "../../db/schema";
import {
  cloudSyncKeySchema,
  cloudSyncOptionalTextSchema,
  cloudSyncRequiredTextSchema,
} from "../../db/sync-payload";

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

async function migrateSettingsSyncBounds(): Promise<{
  vocabularyDeleted: number;
  snippetsDeleted: number;
}> {
  return db.transaction((tx) => {
    const vocabularyRows = tx.select().from(vocabulary).all();
    const snippetRows = tx.select().from(snippets).all();

    const normalizedVocabulary = vocabularyRows.map((row) => ({
      ...row,
      word: row.word.trim(),
    }));
    const normalizedSnippets = snippetRows.map((row) => ({
      ...row,
      trigger: row.trigger.trim(),
    }));

    const vocabularyRowsToDelete: typeof normalizedVocabulary = [];
    const keptVocabulary: typeof normalizedVocabulary = [];
    const seenWords = new Set<string>();
    for (const row of normalizedVocabulary.sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const scopedWord = `${row.scopeType}\0${row.scopeId}\0${row.word}`;
      if (
        !cloudSyncKeySchema.safeParse(row.word).success ||
        (row.replacementWord !== null &&
          !cloudSyncOptionalTextSchema.safeParse(row.replacementWord)
            .success) ||
        seenWords.has(scopedWord)
      ) {
        vocabularyRowsToDelete.push(row);
        continue;
      }
      seenWords.add(scopedWord);
      keptVocabulary.push(row);
    }

    const snippetRowsToDelete: typeof normalizedSnippets = [];
    const keptSnippets: typeof normalizedSnippets = [];
    const seenTriggers = new Set<string>();
    for (const row of normalizedSnippets.sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const scopedTrigger = `${row.scopeType}\0${row.scopeId}\0${row.trigger}`;
      if (
        !cloudSyncKeySchema.safeParse(row.trigger).success ||
        !cloudSyncRequiredTextSchema.safeParse(row.content).success ||
        seenTriggers.has(scopedTrigger)
      ) {
        snippetRowsToDelete.push(row);
        continue;
      }
      seenTriggers.add(scopedTrigger);
      keptSnippets.push(row);
    }

    for (const row of vocabularyRowsToDelete) {
      tx.delete(vocabulary)
        .where(
          and(
            eq(vocabulary.id, row.id),
            eq(vocabulary.scopeType, row.scopeType),
            eq(vocabulary.scopeId, row.scopeId),
          ),
        )
        .run();
    }
    for (const row of snippetRowsToDelete) {
      tx.delete(snippets)
        .where(
          and(
            eq(snippets.id, row.id),
            eq(snippets.scopeType, row.scopeType),
            eq(snippets.scopeId, row.scopeId),
          ),
        )
        .run();
    }

    // Move retained keys through unique temporary values so trimming can safely
    // handle swaps and collisions with another row's original key.
    for (const row of keptVocabulary) {
      tx.update(vocabulary)
        .set({ word: randomUUID() })
        .where(
          and(
            eq(vocabulary.id, row.id),
            eq(vocabulary.scopeType, row.scopeType),
            eq(vocabulary.scopeId, row.scopeId),
          ),
        )
        .run();
    }
    for (const row of keptSnippets) {
      tx.update(snippets)
        .set({ trigger: randomUUID() })
        .where(
          and(
            eq(snippets.id, row.id),
            eq(snippets.scopeType, row.scopeType),
            eq(snippets.scopeId, row.scopeId),
          ),
        )
        .run();
    }

    for (const row of keptVocabulary) {
      tx.update(vocabulary)
        .set({
          word: row.word,
          replacementWord: row.replacementWord,
        })
        .where(
          and(
            eq(vocabulary.id, row.id),
            eq(vocabulary.scopeType, row.scopeType),
            eq(vocabulary.scopeId, row.scopeId),
          ),
        )
        .run();
    }
    for (const row of keptSnippets) {
      tx.update(snippets)
        .set({
          trigger: row.trigger,
          content: row.content,
        })
        .where(
          and(
            eq(snippets.id, row.id),
            eq(snippets.scopeType, row.scopeType),
            eq(snippets.scopeId, row.scopeId),
          ),
        )
        .run();
    }

    return {
      vocabularyDeleted: vocabularyRowsToDelete.length,
      snippetsDeleted: snippetRowsToDelete.length,
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
    const currentDataMigrations = settings.dataMigrations ?? {};

    // Markdown migration has per-note state and never rewrites legacy blobs.
    migrateLegacyNotes((currentDataMigrations.notesLexical ?? 0) < 1);
  } catch (error) {
    logger.db.error("Data migrations failed", error);
  }
}
