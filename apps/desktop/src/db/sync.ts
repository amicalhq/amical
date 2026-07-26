import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from ".";
import {
  snippets,
  syncClientState,
  syncCollectionState,
  syncItemState,
  syncOutbox,
  vocabulary,
  type SnippetSyncPayload,
  type SyncCollection,
  type SyncItemState,
  type SyncPayload,
  type SyncScopeType,
  type VocabularySyncPayload,
} from "./schema";

type SyncDatabase = Pick<typeof db, "select" | "insert" | "update" | "delete">;

const SYNC_COLLECTIONS = [
  "vocabulary",
  "snippet",
] as const satisfies readonly SyncCollection[];

let localMutationHandler: (() => void) | null = null;
let activeUserAccountId: string | null = null;

export function registerLocalSyncMutationHandler(
  handler: () => void,
): () => void {
  localMutationHandler = handler;
  return () => {
    if (localMutationHandler === handler) localMutationHandler = null;
  };
}

export interface SyncContext {
  accountId: string;
  scopeType: SyncScopeType;
  scopeId: string;
}

export interface CanonicalSyncItem {
  collection: SyncCollection;
  syncId: string;
  syncVersion: number;
  payload: SyncPayload | null;
}

export interface CapturedSyncHead extends SyncContext {
  collection: SyncCollection;
  syncId: string;
  headPayload: SyncPayload | null;
  headExpectedSyncVersion: number | null;
  headSequence: number;
}

export type PushSyncResult =
  | {
      status: "ok";
      syncId: string;
      syncVersion: number;
      applied: boolean;
    }
  | {
      status: "conflict";
      reason: "version_conflict" | "duplicate_key_conflict";
      syncId: string;
      canonical: CanonicalSyncItem | null;
      conflictingItem?: CanonicalSyncItem;
    }
  | {
      status: "error";
      syncId: string | null;
      reason: "unauthorized_scope" | "invalid_payload" | "invalid_mutation";
      message: string;
    };

const collectionWhere = (
  context: Pick<SyncContext, "scopeType" | "scopeId">,
  collection: SyncCollection,
) =>
  and(
    eq(syncCollectionState.scopeType, context.scopeType),
    eq(syncCollectionState.scopeId, context.scopeId),
    eq(syncCollectionState.collection, collection),
  );

const itemWhere = (identity: {
  scopeType: SyncScopeType;
  scopeId: string;
  collection: SyncCollection;
  syncId: string;
}) =>
  and(
    eq(syncItemState.scopeType, identity.scopeType),
    eq(syncItemState.scopeId, identity.scopeId),
    eq(syncItemState.collection, identity.collection),
    eq(syncItemState.syncId, identity.syncId),
  );

const outboxWhere = (identity: {
  scopeType: SyncScopeType;
  scopeId: string;
  collection: SyncCollection;
  syncId: string;
}) =>
  and(
    eq(syncOutbox.scopeType, identity.scopeType),
    eq(syncOutbox.scopeId, identity.scopeId),
    eq(syncOutbox.collection, identity.collection),
    eq(syncOutbox.syncId, identity.syncId),
  );

function payloadsEqual(
  left: SyncPayload | null,
  right: SyncPayload | null,
): boolean {
  return isDeepStrictEqual(left, right);
}

const syncItemKey = (collection: SyncCollection, syncId: string) =>
  `${collection}:${syncId}`;

async function loadVisibleRowIds(
  database: SyncDatabase,
): Promise<Record<SyncCollection, Set<string>>> {
  const vocabularyRows = await database
    .select({ id: vocabulary.id })
    .from(vocabulary);
  const snippetRows = await database.select({ id: snippets.id }).from(snippets);
  return {
    vocabulary: new Set(vocabularyRows.map((row) => row.id)),
    snippet: new Set(snippetRows.map((row) => row.id)),
  };
}

async function loadScopeSyncIndex(
  database: SyncDatabase,
  identity: Pick<SyncContext, "scopeType" | "scopeId">,
  visibleRowIds: Record<SyncCollection, Set<string>>,
) {
  const sidecars = await database
    .select()
    .from(syncItemState)
    .where(
      and(
        eq(syncItemState.scopeType, identity.scopeType),
        eq(syncItemState.scopeId, identity.scopeId),
      ),
    );
  const pendingRows = await database
    .select()
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.scopeType, identity.scopeType),
        eq(syncOutbox.scopeId, identity.scopeId),
      ),
    );
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

  return {
    sidecars,
    pendingByItem,
    sidecarByItem,
  };
}

export function vocabularySyncPayload(row: {
  word: string;
  replacementWord: string | null;
}): VocabularySyncPayload {
  return {
    word: row.word,
    replacement: row.replacementWord,
  };
}

export function snippetSyncPayload(row: {
  trigger: string;
  content: string;
}): SnippetSyncPayload {
  return {
    trigger: row.trigger,
    content: row.content,
  };
}

const contextIsActive = (context: SyncContext): boolean =>
  context.scopeType === "user" &&
  context.accountId === activeUserAccountId &&
  context.scopeId === activeUserAccountId;

async function startUserSyncSession(
  accountId: string,
  resetCursor: boolean,
  database: typeof db = db,
): Promise<SyncContext> {
  const context = await database.transaction(async (tx) => {
    await tx
      .insert(syncClientState)
      .values({ id: 1, lastOutboxSequence: 0 })
      .onConflictDoNothing();

    const scope = {
      scopeType: "user" as const,
      scopeId: accountId,
    };

    for (const collection of SYNC_COLLECTIONS) {
      const insert = tx
        .insert(syncCollectionState)
        .values({ ...scope, collection, cursor: 0 });
      if (resetCursor) {
        await insert.onConflictDoUpdate({
          target: [
            syncCollectionState.scopeType,
            syncCollectionState.scopeId,
            syncCollectionState.collection,
          ],
          set: { cursor: 0 },
        });
      } else {
        await insert.onConflictDoNothing();
      }
    }

    return { accountId, ...scope };
  });
  activeUserAccountId = accountId;
  return context;
}

export async function beginUserSyncSession(
  accountId: string,
  database: typeof db = db,
): Promise<SyncContext> {
  return startUserSyncSession(accountId, true, database);
}

export async function resumeUserSyncSession(
  accountId: string,
  database: typeof db = db,
): Promise<SyncContext> {
  return startUserSyncSession(accountId, false, database);
}

export function pauseSyncSession(): void {
  activeUserAccountId = null;
}

export async function clearSyncState(database: typeof db = db): Promise<void> {
  activeUserAccountId = null;
  await database.transaction(async (tx) => {
    await tx.delete(syncOutbox);
    await tx.delete(syncItemState);
    await tx.delete(syncCollectionState);
    await tx.delete(syncClientState);
  });
}

export async function hasResumableUserSyncState(
  accountId: string,
  database: SyncDatabase = db,
): Promise<boolean> {
  const [state] = await database
    .select({ collection: syncCollectionState.collection })
    .from(syncCollectionState)
    .where(
      and(
        eq(syncCollectionState.scopeType, "user"),
        eq(syncCollectionState.scopeId, accountId),
      ),
    )
    .limit(1);
  return Boolean(state);
}

function activeUserIdentity() {
  if (!activeUserAccountId) return null;

  return {
    scopeType: "user" as const,
    scopeId: activeUserAccountId,
  };
}

async function allocateOutboxSequence(database: SyncDatabase): Promise<number> {
  const [client] = await database
    .update(syncClientState)
    .set({
      lastOutboxSequence: sql`${syncClientState.lastOutboxSequence} + 1`,
    })
    .where(eq(syncClientState.id, 1))
    .returning({ sequence: syncClientState.lastOutboxSequence });
  if (!client) throw new Error("Sync client state is missing");
  return client.sequence;
}

async function enqueueLocalMutation(
  database: SyncDatabase,
  identity: {
    scopeType: "user";
    scopeId: string;
  },
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
  options: {
    unversioned?: boolean;
    notify?: boolean;
  } = {},
): Promise<void> {
  const [existingSidecar] = await database
    .select()
    .from(syncItemState)
    .where(itemWhere({ ...identity, collection, syncId }))
    .limit(1);
  let sidecar: SyncItemState | undefined = existingSidecar;

  if (!sidecar) {
    await database.insert(syncItemState).values({
      ...identity,
      collection,
      syncId,
      acceptedSyncVersion: null,
      acceptedPayload: null,
    });
    [sidecar] = await database
      .select()
      .from(syncItemState)
      .where(
        itemWhere({
          ...identity,
          collection,
          syncId,
        }),
      )
      .limit(1);
  }
  if (!sidecar) throw new Error("Failed to create sync item sidecar");

  const identityWithItem = {
    ...identity,
    collection,
    syncId: sidecar.syncId,
  };
  const [pending] = await database
    .select()
    .from(syncOutbox)
    .where(outboxWhere(identityWithItem))
    .limit(1);

  let desiredBaseSyncVersion = options.unversioned
    ? null
    : sidecar.acceptedSyncVersion;
  let desiredSequence =
    pending?.desiredSequence ?? (await allocateOutboxSequence(database));
  let desiredParentHeadSequence: number | null = null;
  let desiredParentSyncVersion: number | null = null;

  if (pending?.headPresent) {
    if (pending.headSequence === null) {
      throw new Error("Sync outbox head is missing its sequence");
    }
    if (pending.desiredSequence === pending.headSequence) {
      desiredSequence = await allocateOutboxSequence(database);
      // A tail is based on the exact frozen state the head was authored from,
      // never a mutable accepted sidecar version observed while it is in flight.
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

  await database
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
    });
  if (options.notify !== false) localMutationHandler?.();
}

export async function recordLocalSyncMutation(
  database: SyncDatabase,
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
): Promise<void> {
  const identity = activeUserIdentity();
  if (!identity) return;
  await enqueueLocalMutation(database, identity, collection, syncId, payload);
}

export interface LocalSyncMutation {
  collection: SyncCollection;
  syncId: string;
  payload: SyncPayload;
}

async function enqueueLocalSyncMutationsBulk(
  database: SyncDatabase,
  identity: {
    scopeType: "user";
    scopeId: string;
  },
  mutations: LocalSyncMutation[],
  options: {
    unversioned?: boolean;
    onlyUnbound?: boolean;
    visibleRowIds?: Record<SyncCollection, Set<string>>;
  } = {},
): Promise<void> {
  if (mutations.length === 0) return;

  const visibleRowIds =
    options.visibleRowIds ?? (await loadVisibleRowIds(database));
  const index = await loadScopeSyncIndex(database, identity, visibleRowIds);

  for (const mutation of mutations) {
    const itemKey = syncItemKey(mutation.collection, mutation.syncId);
    if (options.onlyUnbound && index.sidecarByItem.has(itemKey)) {
      continue;
    }

    await enqueueLocalMutation(
      database,
      identity,
      mutation.collection,
      mutation.syncId,
      mutation.payload,
      {
        unversioned: options.unversioned,
        notify: false,
      },
    );
  }

  localMutationHandler?.();
}

export async function recordLocalSyncMutations(
  database: SyncDatabase,
  mutations: LocalSyncMutation[],
): Promise<void> {
  const identity = activeUserIdentity();
  if (!identity) return;
  await enqueueLocalSyncMutationsBulk(database, identity, mutations);
}

export async function prepareVisibleRowsForFullSync(
  fence: SyncContext,
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    if (!contextIsActive(fence)) return false;
    if (fence.scopeType !== "user") return false;

    const vocabularyRows = await tx.select().from(vocabulary);
    const snippetRows = await tx.select().from(snippets);
    const visibleRowIds = {
      vocabulary: new Set(vocabularyRows.map((row) => row.id)),
      snippet: new Set(snippetRows.map((row) => row.id)),
    } satisfies Record<SyncCollection, Set<string>>;
    const index = await loadScopeSyncIndex(tx, fence, visibleRowIds);
    const identity = {
      scopeType: "user" as const,
      scopeId: fence.scopeId,
    };
    let enqueuedMutation = false;

    const prepareRow = async (
      collection: SyncCollection,
      syncId: string,
      payload: SyncPayload,
    ) => {
      const itemKey = syncItemKey(collection, syncId);
      const sidecar = index.sidecarByItem.get(itemKey);
      if (!sidecar) return;
      const pending = index.pendingByItem.get(itemKey);

      if (pending) {
        if (!payloadsEqual(payload, pending.desiredPayload)) {
          await enqueueLocalMutation(
            tx,
            identity,
            collection,
            syncId,
            payload,
            { notify: false },
          );
          enqueuedMutation = true;
        }
      }
    };

    for (const row of vocabularyRows) {
      await prepareRow("vocabulary", row.id, vocabularySyncPayload(row));
    }
    for (const row of snippetRows) {
      await prepareRow("snippet", row.id, snippetSyncPayload(row));
    }

    for (const sidecar of index.sidecars) {
      if (visibleRowIds[sidecar.collection].has(sidecar.syncId)) {
        continue;
      }
      const pending = index.pendingByItem.get(
        syncItemKey(sidecar.collection, sidecar.syncId),
      );
      if (pending?.desiredPayload === null) continue;
      if (!pending && sidecar.acceptedPayload === null) continue;
      await enqueueLocalMutation(
        tx,
        identity,
        sidecar.collection,
        sidecar.syncId,
        null,
        { notify: false },
      );
      enqueuedMutation = true;
    }

    if (enqueuedMutation) localMutationHandler?.();
    return true;
  });
}

async function findSidecar(
  database: SyncDatabase,
  fence: SyncContext,
  collection: SyncCollection,
  syncId: string,
): Promise<SyncItemState | null> {
  const [sidecar] = await database
    .select()
    .from(syncItemState)
    .where(itemWhere({ ...fence, collection, syncId }))
    .limit(1);
  return sidecar ?? null;
}

async function discardCurrentAccountCollision(
  database: SyncDatabase,
  fence: SyncContext,
  collection: SyncCollection,
  losingSyncId: string,
  preservePending: boolean,
): Promise<void> {
  if (preservePending) return;
  await database
    .delete(syncOutbox)
    .where(outboxWhere({ ...fence, collection, syncId: losingSyncId }));
}

async function applyDomainPayload(
  database: SyncDatabase,
  fence: SyncContext,
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
  preserveCollidingPending = false,
): Promise<void> {
  const sidecar = await findSidecar(database, fence, collection, syncId);
  if (!sidecar) throw new Error("Sync sidecar missing during canonical apply");

  if (payload === null) {
    if (collection === "vocabulary") {
      await database.delete(vocabulary).where(eq(vocabulary.id, syncId));
    } else {
      await database.delete(snippets).where(eq(snippets.id, syncId));
    }
    return;
  }

  const now = new Date();

  if (collection === "vocabulary") {
    const value = payload as VocabularySyncPayload;
    const [keyRow] = await database
      .select()
      .from(vocabulary)
      .where(eq(vocabulary.word, value.word))
      .limit(1);

    if (keyRow && keyRow.id !== syncId) {
      await discardCurrentAccountCollision(
        database,
        fence,
        collection,
        keyRow.id,
        preserveCollidingPending,
      );
      await database.delete(vocabulary).where(eq(vocabulary.id, keyRow.id));
    }

    const [updated] = await database
      .update(vocabulary)
      .set({
        word: value.word,
        replacementWord: value.replacement,
        updatedAt: now,
      })
      .where(eq(vocabulary.id, syncId))
      .returning({ id: vocabulary.id });
    if (!updated) {
      await database.insert(vocabulary).values({
        id: syncId,
        word: value.word,
        replacementWord: value.replacement,
        dateAdded: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  } else {
    const value = payload as SnippetSyncPayload;
    const [keyRow] = await database
      .select()
      .from(snippets)
      .where(eq(snippets.trigger, value.trigger))
      .limit(1);

    if (keyRow && keyRow.id !== syncId) {
      await discardCurrentAccountCollision(
        database,
        fence,
        collection,
        keyRow.id,
        preserveCollidingPending,
      );
      await database.delete(snippets).where(eq(snippets.id, keyRow.id));
    }

    const [updated] = await database
      .update(snippets)
      .set({
        trigger: value.trigger,
        content: value.content,
        updatedAt: now,
      })
      .where(eq(snippets.id, syncId))
      .returning({ id: snippets.id });
    if (!updated) {
      await database.insert(snippets).values({
        id: syncId,
        trigger: value.trigger,
        content: value.content,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

async function ensureCanonicalSidecar(
  database: SyncDatabase,
  fence: SyncContext,
  item: CanonicalSyncItem,
): Promise<SyncItemState> {
  let sidecar = await findSidecar(
    database,
    fence,
    item.collection,
    item.syncId,
  );
  if (sidecar) return sidecar;

  await database.insert(syncItemState).values({
    scopeType: fence.scopeType,
    scopeId: fence.scopeId,
    collection: item.collection,
    syncId: item.syncId,
    acceptedSyncVersion: null,
    acceptedPayload: null,
  });
  sidecar = await findSidecar(database, fence, item.collection, item.syncId);
  if (!sidecar) throw new Error("Failed to create canonical sync sidecar");
  return sidecar;
}

async function setAcceptedState(
  database: SyncDatabase,
  fence: SyncContext,
  item: CanonicalSyncItem,
): Promise<boolean> {
  const sidecar = await ensureCanonicalSidecar(database, fence, item);
  if (
    sidecar.acceptedSyncVersion !== null &&
    sidecar.acceptedSyncVersion > item.syncVersion
  ) {
    return false;
  }
  await database
    .update(syncItemState)
    .set({
      acceptedSyncVersion: item.syncVersion,
      acceptedPayload: item.payload,
    })
    .where(itemWhere({ ...fence, ...item }));
  return true;
}

async function acceptHead(
  database: SyncDatabase,
  fence: SyncContext,
  head: CapturedSyncHead,
  syncVersion: number,
): Promise<void> {
  const identity = { ...fence, ...head };
  const sidecar = await findSidecar(
    database,
    fence,
    head.collection,
    head.syncId,
  );
  const [pending] = await database
    .select()
    .from(syncOutbox)
    .where(outboxWhere(identity))
    .limit(1);
  if (
    !sidecar ||
    !pending?.headPresent ||
    pending.headSequence !== head.headSequence
  ) {
    return;
  }
  if (
    sidecar.acceptedSyncVersion !== null &&
    sidecar.acceptedSyncVersion > syncVersion
  ) {
    return;
  }
  await database
    .update(syncItemState)
    .set({
      acceptedSyncVersion: syncVersion,
      acceptedPayload: head.headPayload,
    })
    .where(itemWhere(identity));

  if (pending.desiredSequence === head.headSequence) {
    await database.delete(syncOutbox).where(outboxWhere(identity));
    await applyDomainPayload(
      database,
      fence,
      head.collection,
      head.syncId,
      head.headPayload,
    );
    return;
  }

  if (pending.desiredParentHeadSequence !== head.headSequence) {
    throw new Error("Sync tail does not reference its satisfied head");
  }
  await database
    .update(syncOutbox)
    .set({
      desiredParentSyncVersion: syncVersion,
      headPresent: false,
      headPayload: null,
      headExpectedSyncVersion: null,
      headSequence: null,
    })
    .where(outboxWhere(identity));
}

async function permanentlyFailHead(
  database: SyncDatabase,
  fence: SyncContext,
  head: CapturedSyncHead,
): Promise<void> {
  const identity = { ...fence, ...head };
  const [pending] = await database
    .select()
    .from(syncOutbox)
    .where(outboxWhere(identity))
    .limit(1);
  if (!pending?.headPresent || pending.headSequence !== head.headSequence) {
    return;
  }

  if (pending.desiredSequence !== head.headSequence) {
    await database
      .update(syncOutbox)
      .set({
        desiredParentHeadSequence: null,
        desiredParentSyncVersion: null,
        headPresent: false,
        headPayload: null,
        headExpectedSyncVersion: null,
        headSequence: null,
      })
      .where(outboxWhere(identity));
    return;
  }

  await database.delete(syncOutbox).where(outboxWhere(identity));
  const sidecar = await findSidecar(
    database,
    fence,
    head.collection,
    head.syncId,
  );
  await applyDomainPayload(
    database,
    fence,
    head.collection,
    head.syncId,
    sidecar?.acceptedPayload ?? null,
  );
}

async function applyCanonicalItem(
  database: SyncDatabase,
  fence: SyncContext,
  item: CanonicalSyncItem,
  preservePending = false,
  discardPendingOnEqual = false,
): Promise<void> {
  const sidecar = await ensureCanonicalSidecar(database, fence, item);
  const identity = { ...fence, ...item };
  const [pending] = await database
    .select()
    .from(syncOutbox)
    .where(outboxWhere(identity))
    .limit(1);

  if (
    sidecar.acceptedSyncVersion !== null &&
    item.syncVersion < sidecar.acceptedSyncVersion
  ) {
    return;
  }
  if (item.syncVersion === sidecar.acceptedSyncVersion) {
    await setAcceptedState(database, fence, item);
    if (discardPendingOnEqual && pending) {
      await database.delete(syncOutbox).where(outboxWhere(identity));
      await applyDomainPayload(
        database,
        fence,
        item.collection,
        item.syncId,
        item.payload,
      );
      return;
    }
    await applyDomainPayload(
      database,
      fence,
      item.collection,
      item.syncId,
      pending ? pending.desiredPayload : item.payload,
    );
    return;
  }

  if (preservePending) {
    const accepted = await setAcceptedState(database, fence, item);
    if (!accepted) return;
    await applyDomainPayload(
      database,
      fence,
      item.collection,
      item.syncId,
      pending ? pending.desiredPayload : item.payload,
      true,
    );
    return;
  }

  if (pending && payloadsEqual(pending.desiredPayload, item.payload)) {
    await setAcceptedState(database, fence, item);
    await database.delete(syncOutbox).where(outboxWhere(identity));
    await applyDomainPayload(
      database,
      fence,
      item.collection,
      item.syncId,
      item.payload,
    );
    return;
  }

  if (
    pending?.headPresent &&
    payloadsEqual(pending.headPayload, item.payload) &&
    pending.headSequence !== null
  ) {
    await acceptHead(
      database,
      fence,
      {
        ...fence,
        collection: item.collection,
        syncId: item.syncId,
        headPayload: pending.headPayload,
        headExpectedSyncVersion: pending.headExpectedSyncVersion,
        headSequence: pending.headSequence,
      },
      item.syncVersion,
    );
    return;
  }

  await setAcceptedState(database, fence, item);
  if (pending) {
    await database.delete(syncOutbox).where(outboxWhere(identity));
  }
  await applyDomainPayload(
    database,
    fence,
    item.collection,
    item.syncId,
    item.payload,
  );
}

async function applyCanonicalAbsence(
  database: SyncDatabase,
  fence: SyncContext,
  head: CapturedSyncHead,
): Promise<void> {
  const sidecar = await findSidecar(
    database,
    fence,
    head.collection,
    head.syncId,
  );
  if (!sidecar) return;

  await database
    .update(syncItemState)
    .set({ acceptedSyncVersion: null, acceptedPayload: null })
    .where(itemWhere({ ...fence, ...head }));
  await database.delete(syncOutbox).where(outboxWhere({ ...fence, ...head }));
  await applyDomainPayload(database, fence, head.collection, head.syncId, null);
}

export interface PullCollectionPage {
  collection: SyncCollection;
  items: CanonicalSyncItem[];
  cursor: number;
}

export interface PullCollectionCursor {
  collection: SyncCollection;
  cursor: number;
}

export async function applyPullPages(
  fence: SyncContext,
  pages: PullCollectionPage[],
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    if (!contextIsActive(fence)) return false;

    for (const page of pages) {
      for (const item of page.items) {
        await applyCanonicalItem(tx, fence, item);
      }
      await tx
        .update(syncCollectionState)
        .set({ cursor: page.cursor })
        .where(collectionWhere(fence, page.collection));
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

  const rows = await database
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
    );
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

export async function adoptVisibleRows(
  fence: SyncContext,
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    if (!contextIsActive(fence)) return false;

    // Only unbound rows are adoption candidates. Existing identities are
    // governed by their accepted state or durable outbox, so a same-key
    // signed-out edit is not promoted before the login pull.
    const vocabularyRows = await tx.select().from(vocabulary);
    const snippetRows = await tx.select().from(snippets);
    await enqueueLocalSyncMutationsBulk(
      tx,
      {
        scopeType: "user",
        scopeId: fence.scopeId,
      },
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
  return database.transaction(async (tx) => {
    if (!contextIsActive(fence)) return [];

    const pendingRows = await tx
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.scopeType, fence.scopeType),
          eq(syncOutbox.scopeId, fence.scopeId),
          inArray(syncOutbox.collection, [...collections]),
        ),
      );

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
      await tx
        .update(syncOutbox)
        .set({
          headPresent: true,
          headPayload: pending.desiredPayload,
          headExpectedSyncVersion: expectedSyncVersion,
          headSequence: pending.desiredSequence,
        })
        .where(outboxWhere(pending));
    }

    const heads = await tx
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.scopeType, fence.scopeType),
          eq(syncOutbox.scopeId, fence.scopeId),
          inArray(syncOutbox.collection, [...collections]),
          eq(syncOutbox.headPresent, true),
        ),
      );

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
  return database.transaction(async (tx) => {
    if (!contextIsActive(fence)) return false;

    for (const [index, result] of results.entries()) {
      const head = heads[index];
      if (!head || result.syncId !== head.syncId) {
        throw new Error("Push result does not match captured head");
      }

      const [current] = await tx
        .select()
        .from(syncOutbox)
        .where(outboxWhere(head))
        .limit(1);
      if (!current?.headPresent || current.headSequence !== head.headSequence) {
        continue;
      }

      if (result.status === "ok") {
        await acceptHead(tx, fence, head, result.syncVersion);
        continue;
      }

      if (result.status === "error") {
        if (result.reason === "unauthorized_scope") continue;
        await permanentlyFailHead(tx, fence, head);
        continue;
      }

      if (result.reason === "version_conflict") {
        if (result.canonical) {
          await applyCanonicalItem(tx, fence, result.canonical, false, true);
        } else {
          await applyCanonicalAbsence(tx, fence, head);
        }
        continue;
      }

      if (result.canonical) {
        await setAcceptedState(tx, fence, result.canonical);
      } else {
        const sidecar = await findSidecar(
          tx,
          fence,
          head.collection,
          head.syncId,
        );
        if (sidecar) {
          await tx
            .update(syncItemState)
            .set({ acceptedSyncVersion: null, acceptedPayload: null })
            .where(itemWhere(head));
        }
      }
      await permanentlyFailHead(tx, fence, head);

      if (result.conflictingItem) {
        await applyCanonicalItem(tx, fence, result.conflictingItem, true);
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
  const [pending] = await database
    .select({ syncId: syncOutbox.syncId })
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.scopeType, fence.scopeType),
        eq(syncOutbox.scopeId, fence.scopeId),
        inArray(syncOutbox.collection, [...collections]),
      ),
    )
    .limit(1);
  return Boolean(pending);
}
