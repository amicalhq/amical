import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "..";
import {
  snippets,
  syncClientState,
  syncItemState,
  syncOutbox,
  vocabulary,
  type SyncCollection,
  type SyncItemState,
  type SyncPayload,
  type SyncScopeType,
} from "../schema";
import {
  activeUserIdentity,
  activeWritableOrganizationIdentity,
  contextIsActive,
  notifyLocalSyncMutation,
} from "./active-state";
import {
  acceptHead,
  applyCanonicalAbsence,
  applyCanonicalItem,
  findSidecar,
  permanentlyFailHead,
  setAcceptedState,
} from "./canonical";
import {
  loadScopeSyncIndex,
  loadVisibleRowIds,
  snippetSyncPayload,
  vocabularySyncPayload,
} from "./domain";
import { itemWhere, outboxWhere, payloadsEqual, syncItemKey } from "./query";
import {
  PERSONAL_SCOPE_ID,
  type CapturedSyncHead,
  type LocalSyncMutation,
  type PushSyncResult,
  type SyncContext,
  type SyncDatabase,
} from "./types";

function allocateOutboxSequence(database: SyncDatabase): number {
  const client = database
    .update(syncClientState)
    .set({
      lastOutboxSequence: sql`${syncClientState.lastOutboxSequence} + 1`,
    })
    .where(eq(syncClientState.id, 1))
    .returning({ sequence: syncClientState.lastOutboxSequence })
    .get();
  if (!client) throw new Error("Sync client state is missing");
  return client.sequence;
}

function enqueueLocalMutation(
  database: SyncDatabase,
  identity: { scopeType: SyncScopeType; scopeId: string },
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
  options: { unversioned?: boolean; notify?: boolean } = {},
): void {
  const existingSidecar = database
    .select()
    .from(syncItemState)
    .where(itemWhere({ ...identity, collection, syncId }))
    .limit(1)
    .get();
  let sidecar: SyncItemState | undefined = existingSidecar;

  if (!sidecar) {
    database
      .insert(syncItemState)
      .values({
        ...identity,
        collection,
        syncId,
        acceptedSyncVersion: null,
        acceptedPayload: null,
      })
      .run();
    sidecar = database
      .select()
      .from(syncItemState)
      .where(itemWhere({ ...identity, collection, syncId }))
      .limit(1)
      .get();
  }
  if (!sidecar) throw new Error("Failed to create sync item sidecar");

  const identityWithItem = {
    ...identity,
    collection,
    syncId: sidecar.syncId,
  };
  const pending = database
    .select()
    .from(syncOutbox)
    .where(outboxWhere(identityWithItem))
    .limit(1)
    .get();

  let desiredBaseSyncVersion = options.unversioned
    ? null
    : sidecar.acceptedSyncVersion;
  let desiredSequence =
    pending?.desiredSequence ?? allocateOutboxSequence(database);
  let desiredParentHeadSequence: number | null = null;
  let desiredParentSyncVersion: number | null = null;

  if (pending?.headPresent) {
    if (pending.headSequence === null) {
      throw new Error("Sync outbox head is missing its sequence");
    }
    if (pending.desiredSequence === pending.headSequence) {
      desiredSequence = allocateOutboxSequence(database);
      desiredBaseSyncVersion = pending.headExpectedSyncVersion;
      desiredParentHeadSequence = pending.headSequence;
    } else {
      desiredBaseSyncVersion = pending.desiredBaseSyncVersion;
      desiredParentHeadSequence = pending.desiredParentHeadSequence;
      desiredParentSyncVersion = pending.desiredParentSyncVersion;
    }
  } else if (pending) {
    desiredBaseSyncVersion = pending.desiredBaseSyncVersion;
    desiredParentHeadSequence = pending.desiredParentHeadSequence;
    desiredParentSyncVersion = pending.desiredParentSyncVersion;
  }

  database
    .insert(syncOutbox)
    .values({
      ...identityWithItem,
      desiredPayload: payload,
      desiredBaseSyncVersion,
      desiredSequence,
      desiredParentHeadSequence,
      desiredParentSyncVersion,
      headPresent: pending?.headPresent ?? false,
      headPayload: pending?.headPayload ?? null,
      headExpectedSyncVersion: pending?.headExpectedSyncVersion ?? null,
      headSequence: pending?.headSequence ?? null,
    })
    .onConflictDoUpdate({
      target: [
        syncOutbox.scopeType,
        syncOutbox.scopeId,
        syncOutbox.collection,
        syncOutbox.syncId,
      ],
      set: {
        desiredPayload: payload,
        desiredBaseSyncVersion,
        desiredSequence,
        desiredParentHeadSequence,
        desiredParentSyncVersion,
      },
    })
    .run();
  if (options.notify !== false) notifyLocalSyncMutation();
}

export function recordLocalSyncMutation(
  database: SyncDatabase,
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
): void {
  const identity = activeUserIdentity();
  if (!identity) return;
  enqueueLocalMutation(database, identity, collection, syncId, payload);
}

export function recordOrganizationSyncMutation(
  database: SyncDatabase,
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
): void {
  const identity = activeWritableOrganizationIdentity();
  if (!identity) {
    throw new Error("Organization language assets are read-only");
  }
  enqueueLocalMutation(database, identity, collection, syncId, payload);
}

export function getWritableOrganizationIdentity(): {
  scopeType: "org";
  scopeId: string;
} | null {
  return activeWritableOrganizationIdentity();
}

function enqueueLocalSyncMutationsBulk(
  database: SyncDatabase,
  identity: { scopeType: SyncScopeType; scopeId: string },
  mutations: LocalSyncMutation[],
  options: {
    unversioned?: boolean;
    onlyUnbound?: boolean;
    visibleRowIds?: Record<SyncCollection, Set<string>>;
  } = {},
): void {
  if (mutations.length === 0) return;

  const visibleRowIds =
    options.visibleRowIds ?? loadVisibleRowIds(database, identity);
  const index = loadScopeSyncIndex(database, identity, visibleRowIds);

  for (const mutation of mutations) {
    const itemKey = syncItemKey(mutation.collection, mutation.syncId);
    if (options.onlyUnbound && index.sidecarByItem.has(itemKey)) continue;
    enqueueLocalMutation(
      database,
      identity,
      mutation.collection,
      mutation.syncId,
      mutation.payload,
      { unversioned: options.unversioned, notify: false },
    );
  }

  notifyLocalSyncMutation();
}

export function recordLocalSyncMutations(
  database: SyncDatabase,
  mutations: LocalSyncMutation[],
): void {
  const identity = activeUserIdentity();
  if (!identity) return;
  enqueueLocalSyncMutationsBulk(database, identity, mutations);
}

export async function prepareVisibleRowsForFullSync(
  fence: SyncContext,
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction((tx) => {
    if (!contextIsActive(fence)) return false;
    if (fence.scopeType !== "user") return false;

    const vocabularyRows = tx
      .select()
      .from(vocabulary)
      .where(
        and(
          eq(vocabulary.scopeType, "user"),
          eq(vocabulary.scopeId, PERSONAL_SCOPE_ID),
        ),
      )
      .all();
    const snippetRows = tx
      .select()
      .from(snippets)
      .where(
        and(
          eq(snippets.scopeType, "user"),
          eq(snippets.scopeId, PERSONAL_SCOPE_ID),
        ),
      )
      .all();
    const visibleRowIds = {
      vocabulary: new Set(vocabularyRows.map((row) => row.id)),
      snippet: new Set(snippetRows.map((row) => row.id)),
    } satisfies Record<SyncCollection, Set<string>>;
    const index = loadScopeSyncIndex(tx, fence, visibleRowIds);
    const identity = { scopeType: "user" as const, scopeId: fence.scopeId };
    let enqueuedMutation = false;

    const prepareRow = (
      collection: SyncCollection,
      syncId: string,
      payload: SyncPayload,
    ) => {
      const itemKey = syncItemKey(collection, syncId);
      const sidecar = index.sidecarByItem.get(itemKey);
      if (!sidecar) return;
      const pending = index.pendingByItem.get(itemKey);

      if (pending && !payloadsEqual(payload, pending.desiredPayload)) {
        enqueueLocalMutation(tx, identity, collection, syncId, payload, {
          notify: false,
        });
        enqueuedMutation = true;
      }
    };

    for (const row of vocabularyRows) {
      prepareRow("vocabulary", row.id, vocabularySyncPayload(row));
    }
    for (const row of snippetRows) {
      prepareRow("snippet", row.id, snippetSyncPayload(row));
    }

    for (const sidecar of index.sidecars) {
      if (visibleRowIds[sidecar.collection].has(sidecar.syncId)) continue;
      const pending = index.pendingByItem.get(
        syncItemKey(sidecar.collection, sidecar.syncId),
      );
      if (pending?.desiredPayload === null) continue;
      if (!pending && sidecar.acceptedPayload === null) continue;
      enqueueLocalMutation(
        tx,
        identity,
        sidecar.collection,
        sidecar.syncId,
        null,
        { notify: false },
      );
      enqueuedMutation = true;
    }

    if (enqueuedMutation) notifyLocalSyncMutation();
    return true;
  });
}

export async function adoptVisibleRows(
  fence: SyncContext,
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction((tx) => {
    if (!contextIsActive(fence)) return false;
    if (fence.scopeType !== "user") return false;

    const vocabularyRows = tx
      .select()
      .from(vocabulary)
      .where(
        and(
          eq(vocabulary.scopeType, "user"),
          eq(vocabulary.scopeId, PERSONAL_SCOPE_ID),
        ),
      )
      .all();
    const snippetRows = tx
      .select()
      .from(snippets)
      .where(
        and(
          eq(snippets.scopeType, "user"),
          eq(snippets.scopeId, PERSONAL_SCOPE_ID),
        ),
      )
      .all();
    enqueueLocalSyncMutationsBulk(
      tx,
      { scopeType: "user", scopeId: fence.scopeId },
      [
        ...vocabularyRows.map((row) => ({
          collection: "vocabulary" as const,
          syncId: row.id,
          payload: vocabularySyncPayload(row),
        })),
        ...snippetRows.map((row) => ({
          collection: "snippet" as const,
          syncId: row.id,
          payload: snippetSyncPayload(row),
        })),
      ],
      {
        unversioned: true,
        onlyUnbound: true,
        visibleRowIds: {
          vocabulary: new Set(vocabularyRows.map((row) => row.id)),
          snippet: new Set(snippetRows.map((row) => row.id)),
        },
      },
    );

    return true;
  });
}

export async function capturePushHeads(
  fence: SyncContext,
  database: typeof db = db,
  collections: readonly SyncCollection[] = ["vocabulary", "snippet"],
): Promise<CapturedSyncHead[]> {
  if (collections.length === 0) return [];
  return database.transaction((tx) => {
    if (!contextIsActive(fence)) return [];

    const pendingRows = tx
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.scopeType, fence.scopeType),
          eq(syncOutbox.scopeId, fence.scopeId),
          inArray(syncOutbox.collection, [...collections]),
        ),
      )
      .all();

    const blockedTailSequence = pendingRows.reduce<number | null>(
      (earliest, pending) => {
        if (
          !pending.headPresent ||
          pending.headSequence === null ||
          pending.desiredSequence === pending.headSequence
        ) {
          return earliest;
        }
        return earliest === null
          ? pending.desiredSequence
          : Math.min(earliest, pending.desiredSequence);
      },
      null,
    );
    const orderedPendingRows = [...pendingRows].sort((left, right) => {
      const leftSequence = left.headPresent
        ? (left.headSequence ?? left.desiredSequence)
        : left.desiredSequence;
      const rightSequence = right.headPresent
        ? (right.headSequence ?? right.desiredSequence)
        : right.desiredSequence;
      return leftSequence - rightSequence;
    });

    for (const pending of orderedPendingRows) {
      const queueSequence = pending.headPresent
        ? (pending.headSequence ?? pending.desiredSequence)
        : pending.desiredSequence;
      if (
        blockedTailSequence !== null &&
        queueSequence >= blockedTailSequence
      ) {
        break;
      }
      if (pending.headPresent) continue;
      if (
        pending.desiredParentHeadSequence !== null &&
        pending.desiredParentSyncVersion === null
      ) {
        break;
      }
      const expectedSyncVersion =
        pending.desiredParentHeadSequence === null
          ? pending.desiredBaseSyncVersion
          : pending.desiredParentSyncVersion;
      tx.update(syncOutbox)
        .set({
          headPresent: true,
          headPayload: pending.desiredPayload,
          headExpectedSyncVersion: expectedSyncVersion,
          headSequence: pending.desiredSequence,
        })
        .where(outboxWhere(pending))
        .run();
    }

    const heads = tx
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.scopeType, fence.scopeType),
          eq(syncOutbox.scopeId, fence.scopeId),
          inArray(syncOutbox.collection, [...collections]),
          eq(syncOutbox.headPresent, true),
        ),
      )
      .all();

    return heads
      .flatMap((head) =>
        head.headSequence === null ||
        (blockedTailSequence !== null &&
          head.headSequence >= blockedTailSequence)
          ? []
          : [
              {
                ...fence,
                collection: head.collection,
                syncId: head.syncId,
                headPayload: head.headPayload,
                headExpectedSyncVersion: head.headExpectedSyncVersion,
                headSequence: head.headSequence,
              },
            ],
      )
      .sort((left, right) => left.headSequence - right.headSequence);
  });
}

export async function applyPushResults(
  fence: SyncContext,
  heads: CapturedSyncHead[],
  results: PushSyncResult[],
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction((tx) => {
    if (!contextIsActive(fence)) return false;

    for (const [index, result] of results.entries()) {
      const head = heads[index];
      if (!head || result.syncId !== head.syncId) {
        throw new Error("Push result does not match captured head");
      }

      const current = tx
        .select()
        .from(syncOutbox)
        .where(outboxWhere(head))
        .limit(1)
        .get();
      if (!current?.headPresent || current.headSequence !== head.headSequence) {
        continue;
      }

      if (result.status === "ok") {
        acceptHead(tx, fence, head, result.syncVersion);
        continue;
      }
      if (result.status === "error") {
        if (result.reason === "unauthorized_scope") continue;
        permanentlyFailHead(tx, fence, head);
        continue;
      }
      if (result.reason === "version_conflict") {
        if (result.canonical) {
          applyCanonicalItem(tx, fence, result.canonical, false, true);
        } else {
          applyCanonicalAbsence(tx, fence, head);
        }
        continue;
      }

      if (result.canonical) {
        setAcceptedState(tx, fence, result.canonical);
      } else {
        const sidecar = findSidecar(tx, fence, head.collection, head.syncId);
        if (sidecar) {
          tx.update(syncItemState)
            .set({ acceptedSyncVersion: null, acceptedPayload: null })
            .where(itemWhere(head))
            .run();
        }
      }
      permanentlyFailHead(tx, fence, head);
      if (result.conflictingItem) {
        applyCanonicalItem(tx, fence, result.conflictingItem, true);
      }
    }
    return true;
  });
}

export async function hasPendingSyncWork(
  fence: SyncContext,
  database: SyncDatabase = db,
  collections: readonly SyncCollection[] = ["vocabulary", "snippet"],
): Promise<boolean> {
  if (collections.length === 0) return false;
  if (!contextIsActive(fence)) return false;
  const pending = database
    .select({ syncId: syncOutbox.syncId })
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.scopeType, fence.scopeType),
        eq(syncOutbox.scopeId, fence.scopeId),
        inArray(syncOutbox.collection, [...collections]),
      ),
    )
    .limit(1)
    .get();
  return Boolean(pending);
}
