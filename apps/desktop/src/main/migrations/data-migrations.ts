import * as Y from "yjs";
import { logger } from "../logger";
import { getAppSettings, updateAppSettings } from "../../db/app-settings";
import {
  getUniqueNoteIds,
  getYjsUpdatesByNoteId,
  replaceYjsUpdates,
} from "../../db/notes";
import {
  isLexicalEditorStateJsonString,
  serializePlainTextToLexicalEditorStateJson,
} from "../../services/notes/lexical-editor-state";

const NOTES_LEXICAL_MIGRATION_VERSION = 1;

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

export async function runDataMigrations(): Promise<void> {
  try {
    const settings = await getAppSettings();
    const currentVersion = settings.dataMigrations?.notesLexical ?? 0;

    if (currentVersion >= NOTES_LEXICAL_MIGRATION_VERSION) {
      return;
    }

    const startTime = Date.now();
    logger.db.info("Running data migrations", {
      notesLexicalFrom: currentVersion,
      notesLexicalTo: NOTES_LEXICAL_MIGRATION_VERSION,
    });

    const { notesChecked, notesMigrated } =
      await migrateNotesToLexicalEditorState();

    await updateAppSettings({
      dataMigrations: {
        ...(settings.dataMigrations ?? {}),
        notesLexical: NOTES_LEXICAL_MIGRATION_VERSION,
      },
    });

    logger.db.info("Data migrations complete", {
      notesChecked,
      notesMigrated,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.db.error("Data migrations failed", error);
  }
}
