import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { db } from ".";
import {
  activityMaterializationState,
  activityOutbox,
  appSettings,
  dailyStatsBackup,
  dictationStats,
  notes,
  snippets,
  syncClientState,
  syncCollectionState,
  syncItemState,
  syncOutbox,
  syncScopeState,
  transcriptions,
  vocabulary,
} from "./schema";
import type { SyncDatabase } from "./settings-sync/types";

export function getUserDataAccountId(
  database: SyncDatabase = db,
): string | null {
  return (
    database.select().from(appSettings).where(eq(appSettings.id, 1)).get()?.data
      .auth?.userInfo?.sub ?? null
  );
}

export function hasPendingUserData(): boolean {
  if (
    db.select({ id: syncOutbox.syncId }).from(syncOutbox).limit(1).get() ||
    db
      .select({ id: activityOutbox.activityId })
      .from(activityOutbox)
      .limit(1)
      .get() ||
    db
      .select({ id: transcriptions.id })
      .from(transcriptions)
      .where(
        or(
          and(
            eq(transcriptions.disposition, "success"),
            eq(transcriptions.activityPending, true),
          ),
          // A failed commit/repair can leave recoverable audio in custody.
          and(
            isNotNull(transcriptions.sessionId),
            isNull(transcriptions.disposition),
          ),
        ),
      )
      .limit(1)
      .get() ||
    db
      .select({ id: notes.id })
      .from(notes)
      .where(
        or(ne(notes.contentFormat, "markdown-v1"), isNull(notes.accountId)),
      )
      .limit(1)
      .get()
  )
    return true;

  const accountId = getUserDataAccountId() ?? "";
  // Login adoption is asynchronous. Rows created as a guest must also count
  // before the sync supervisor has attached them to the account's queue.
  for (const [table, collection] of [
    [vocabulary, "vocabulary"],
    [snippets, "snippet"],
  ] as const) {
    if (
      db
        .select({ id: table.id })
        .from(table)
        .leftJoin(
          syncItemState,
          and(
            eq(syncItemState.scopeType, "user"),
            eq(syncItemState.scopeId, accountId),
            eq(syncItemState.collection, collection),
            eq(syncItemState.syncId, table.id),
          ),
        )
        .where(
          and(
            eq(table.scopeType, "user"),
            eq(table.scopeId, ""),
            isNull(syncItemState.syncId),
          ),
        )
        .limit(1)
        .get()
    )
      return true;
  }
  return false;
}

// Local deletion only: never enqueue cloud tombstones or reset device settings.
export function clearUserData() {
  return db.transaction((tx) => {
    const audio = tx
      .select({ id: transcriptions.id, audioFile: transcriptions.audioFile })
      .from(transcriptions)
      .all();
    tx.delete(transcriptions).run();
    tx.delete(dictationStats).run();
    tx.delete(dailyStatsBackup).run();
    tx.delete(vocabulary).run();
    tx.delete(snippets).run();
    tx.delete(notes).run();
    tx.delete(syncOutbox).run();
    tx.delete(syncItemState).run();
    tx.delete(syncCollectionState).run();
    tx.delete(syncScopeState).run();
    tx.delete(syncClientState).run();
    tx.delete(activityOutbox).run();
    tx.delete(activityMaterializationState).run();
    return audio;
  });
}
