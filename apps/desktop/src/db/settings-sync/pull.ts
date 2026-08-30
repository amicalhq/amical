import { and, eq, inArray } from "drizzle-orm";

import { db } from "..";
import { syncCollectionState, type SyncCollection } from "../schema";
import { contextIsActive } from "./active-state";
import { applyCanonicalItem } from "./canonical";
import { collectionWhere } from "./query";
import {
  SYNC_COLLECTIONS,
  type PullCollectionCursor,
  type PullCollectionPage,
  type SyncContext,
  type SyncDatabase,
} from "./types";

export async function applyPullPages(
  fence: SyncContext,
  pages: PullCollectionPage[],
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction((tx) => {
    if (!contextIsActive(fence)) return false;

    for (const page of pages) {
      for (const item of page.items) {
        applyCanonicalItem(tx, fence, item);
      }
      tx.update(syncCollectionState)
        .set({ cursor: page.cursor })
        .where(collectionWhere(fence, page.collection))
        .run();
    }
    return true;
  });
}

export async function getPullCursors(
  fence: SyncContext,
  collections: readonly SyncCollection[] = SYNC_COLLECTIONS,
  database: SyncDatabase = db,
): Promise<PullCollectionCursor[] | null> {
  if (!contextIsActive(fence)) return null;
  if (collections.length === 0) return [];

  const rows = database
    .select({
      collection: syncCollectionState.collection,
      cursor: syncCollectionState.cursor,
    })
    .from(syncCollectionState)
    .where(
      and(
        eq(syncCollectionState.scopeType, fence.scopeType),
        eq(syncCollectionState.scopeId, fence.scopeId),
        inArray(syncCollectionState.collection, [...collections]),
      ),
    )
    .all();
  const cursorByCollection = new Map(
    rows.map((row) => [row.collection, row.cursor]),
  );
  if (collections.some((collection) => !cursorByCollection.has(collection))) {
    return null;
  }
  return collections.map((collection) => ({
    collection,
    cursor: cursorByCollection.get(collection)!,
  }));
}
