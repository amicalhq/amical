import { and, eq } from "drizzle-orm";

import {
  snippets,
  syncItemState,
  syncOutbox,
  vocabulary,
  type SnippetSyncPayload,
  type SyncCollection,
  type SyncItemState,
  type VocabularySyncPayload,
} from "../schema";
import { syncItemKey } from "./query";
import {
  PERSONAL_SCOPE_ID,
  type SyncContext,
  type SyncDatabase,
} from "./types";

export function vocabularySyncPayload(row: {
  word: string;
  replacementWord: string | null;
}): VocabularySyncPayload {
  return { word: row.word, replacement: row.replacementWord };
}

export function snippetSyncPayload(row: {
  trigger: string;
  content: string;
}): SnippetSyncPayload {
  return { trigger: row.trigger, content: row.content };
}

export function loadVisibleRowIds(
  database: SyncDatabase,
  identity: Pick<SyncContext, "scopeType" | "scopeId">,
): Record<SyncCollection, Set<string>> {
  const domainScopeId =
    identity.scopeType === "user" ? PERSONAL_SCOPE_ID : identity.scopeId;
  const vocabularyRows = database
    .select({ id: vocabulary.id })
    .from(vocabulary)
    .where(
      and(
        eq(vocabulary.scopeType, identity.scopeType),
        eq(vocabulary.scopeId, domainScopeId),
      ),
    )
    .all();
  const snippetRows = database
    .select({ id: snippets.id })
    .from(snippets)
    .where(
      and(
        eq(snippets.scopeType, identity.scopeType),
        eq(snippets.scopeId, domainScopeId),
      ),
    )
    .all();
  return {
    vocabulary: new Set(vocabularyRows.map((row) => row.id)),
    snippet: new Set(snippetRows.map((row) => row.id)),
  };
}

export function loadScopeSyncIndex(
  database: SyncDatabase,
  identity: Pick<SyncContext, "scopeType" | "scopeId">,
  visibleRowIds: Record<SyncCollection, Set<string>>,
) {
  const sidecars = database
    .select()
    .from(syncItemState)
    .where(
      and(
        eq(syncItemState.scopeType, identity.scopeType),
        eq(syncItemState.scopeId, identity.scopeId),
      ),
    )
    .all();
  const pendingRows = database
    .select()
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.scopeType, identity.scopeType),
        eq(syncOutbox.scopeId, identity.scopeId),
      ),
    )
    .all();
  const pendingByItem = new Map(
    pendingRows.map((pending) => [
      syncItemKey(pending.collection, pending.syncId),
      pending,
    ]),
  );
  const sidecarByItem = new Map<string, SyncItemState>();

  for (const sidecar of sidecars) {
    if (visibleRowIds[sidecar.collection].has(sidecar.syncId)) {
      sidecarByItem.set(
        syncItemKey(sidecar.collection, sidecar.syncId),
        sidecar,
      );
    }
  }

  return { sidecars, pendingByItem, sidecarByItem };
}
