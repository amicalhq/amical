import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from ".";
import {
  snippets,
  syncClientState,
  syncCollectionState,
  syncItemState,
  syncOutbox,
  syncScopeState,
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

export function registerLocalSyncMutationHandler(
  handler: () => void,
): () => void {
  localMutationHandler = handler;
  return () => {
    if (localMutationHandler === handler) localMutationHandler = null;
  };
}

export interface SyncFence {
  accountId: string;
  scopeType: SyncScopeType;
  scopeId: string;
  sessionEpoch: number;
  responseEpoch: number;
}

export interface CanonicalSyncItem {
  collection: SyncCollection;
  syncId: string;
  syncVersion: number;
  payload: SyncPayload | null;
}

export interface CapturedSyncHead extends SyncFence {
  collection: SyncCollection;
  syncId: string;
  headPayload: SyncPayload | null;
  headExpectedSyncVersion: number | null;
  headGeneration: number;
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

const scopeWhere = (
  fence: Pick<SyncFence, "accountId" | "scopeType" | "scopeId">,
) =>
  and(
    eq(syncScopeState.accountId, fence.accountId),
    eq(syncScopeState.scopeType, fence.scopeType),
    eq(syncScopeState.scopeId, fence.scopeId),
  );

const collectionWhere = (
  fence: Pick<SyncFence, "accountId" | "scopeType" | "scopeId">,
  collection: SyncCollection,
) =>
  and(
    eq(syncCollectionState.accountId, fence.accountId),
    eq(syncCollectionState.scopeType, fence.scopeType),
    eq(syncCollectionState.scopeId, fence.scopeId),
    eq(syncCollectionState.collection, collection),
  );

const itemWhere = (identity: {
  accountId: string;
  scopeType: SyncScopeType;
  scopeId: string;
  collection: SyncCollection;
  syncId: string;
}) =>
  and(
    eq(syncItemState.accountId, identity.accountId),
    eq(syncItemState.scopeType, identity.scopeType),
    eq(syncItemState.scopeId, identity.scopeId),
    eq(syncItemState.collection, identity.collection),
    eq(syncItemState.syncId, identity.syncId),
  );

const outboxWhere = (identity: {
  accountId: string;
  scopeType: SyncScopeType;
  scopeId: string;
  collection: SyncCollection;
  syncId: string;
}) =>
  and(
    eq(syncOutbox.accountId, identity.accountId),
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

function payloadKey(
  collection: SyncCollection,
  payload: SyncPayload | null,
): string | null {
  if (payload === null) return null;
  return collection === "vocabulary"
    ? (payload as VocabularySyncPayload).word
    : (payload as SnippetSyncPayload).trigger;
}

const localRowKey = (collection: SyncCollection, localRowId: number) =>
  `${collection}:${localRowId}`;

const syncItemKey = (collection: SyncCollection, syncId: string) =>
  `${collection}:${syncId}`;

async function loadVisibleRowIds(
  database: SyncDatabase,
): Promise<Record<SyncCollection, Set<number>>> {
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
  identity: Pick<SyncFence, "accountId" | "scopeType" | "scopeId">,
  visibleRowIds: Record<SyncCollection, Set<number>>,
) {
  const sidecars = await database
    .select()
    .from(syncItemState)
    .where(
      and(
        eq(syncItemState.accountId, identity.accountId),
        eq(syncItemState.scopeType, identity.scopeType),
        eq(syncItemState.scopeId, identity.scopeId),
      ),
    );
  const pendingRows = await database
    .select()
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.accountId, identity.accountId),
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
  const sidecarByLocalRow = new Map<string, SyncItemState>();
  const desiredCandidateByKey: Record<
    SyncCollection,
    Map<string, SyncItemState[]>
  > = {
    vocabulary: new Map(),
    snippet: new Map(),
  };
  const acceptedCandidateByKey: Record<
    SyncCollection,
    Map<string, SyncItemState[]>
  > = {
    vocabulary: new Map(),
    snippet: new Map(),
  };

  for (const sidecar of sidecars) {
    if (
      sidecar.localRowId !== null &&
      visibleRowIds[sidecar.collection].has(sidecar.localRowId)
    ) {
      sidecarByLocalRow.set(
        localRowKey(sidecar.collection, sidecar.localRowId),
        sidecar,
      );
      continue;
    }

    const pending = pendingByItem.get(
      syncItemKey(sidecar.collection, sidecar.syncId),
    );
    const desiredKey = payloadKey(
      sidecar.collection,
      pending?.desiredPayload ?? null,
    );
    const acceptedKey = payloadKey(sidecar.collection, sidecar.acceptedPayload);
    if (desiredKey !== null) {
      const candidates = desiredCandidateByKey[sidecar.collection];
      const matches = candidates.get(desiredKey) ?? [];
      matches.push(sidecar);
      candidates.set(desiredKey, matches);
    }
    if (acceptedKey !== null) {
      const candidates = acceptedCandidateByKey[sidecar.collection];
      const matches = candidates.get(acceptedKey) ?? [];
      matches.push(sidecar);
      candidates.set(acceptedKey, matches);
    }
  }

  return {
    sidecars,
    pendingByItem,
    sidecarByLocalRow,
    desiredCandidateByKey,
    acceptedCandidateByKey,
  };
}

function claimBindingCandidate(
  index: Awaited<ReturnType<typeof loadScopeSyncIndex>>,
  collection: SyncCollection,
  key: string,
): SyncItemState | null {
  const candidate =
    index.desiredCandidateByKey[collection].get(key)?.[0] ??
    index.acceptedCandidateByKey[collection].get(key)?.[0];
  if (!candidate) return null;

  const pending = index.pendingByItem.get(
    syncItemKey(candidate.collection, candidate.syncId),
  );
  const desiredKey = payloadKey(
    candidate.collection,
    pending?.desiredPayload ?? null,
  );
  const acceptedKey = payloadKey(
    candidate.collection,
    candidate.acceptedPayload,
  );
  const removeCandidate = (
    candidatesByKey: Map<string, SyncItemState[]>,
    candidateKey: string | null,
  ) => {
    if (candidateKey === null) return;
    const candidates = candidatesByKey.get(candidateKey);
    if (!candidates) return;
    const candidateIndex = candidates.indexOf(candidate);
    if (candidateIndex === -1) return;
    candidates.splice(candidateIndex, 1);
    if (candidates.length === 0) candidatesByKey.delete(candidateKey);
  };
  removeCandidate(index.desiredCandidateByKey[collection], desiredKey);
  removeCandidate(index.acceptedCandidateByKey[collection], acceptedKey);
  return candidate;
}

export function vocabularySyncPayload(row: {
  word: string;
  replacementWord: string | null;
  isReplacement: boolean | null;
}): VocabularySyncPayload {
  return {
    word: row.word,
    replacement: row.isReplacement ? row.replacementWord : null,
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

async function fenceIsCurrent(
  database: SyncDatabase,
  fence: SyncFence,
): Promise<boolean> {
  const [client] = await database
    .select()
    .from(syncClientState)
    .where(eq(syncClientState.id, 1))
    .limit(1);
  if (
    !client ||
    client.syncUserScopeId !== fence.accountId ||
    client.sessionEpoch !== fence.sessionEpoch
  ) {
    return false;
  }

  const [scope] = await database
    .select()
    .from(syncScopeState)
    .where(scopeWhere(fence))
    .limit(1);
  return scope?.responseEpoch === fence.responseEpoch;
}

async function startUserSyncSession(
  accountId: string,
  resetCursor: boolean,
  database: typeof db = db,
): Promise<SyncFence> {
  return database.transaction(async (tx) => {
    const [client] = await tx
      .select()
      .from(syncClientState)
      .where(eq(syncClientState.id, 1))
      .limit(1);
    const sessionEpoch = (client?.sessionEpoch ?? 0) + 1;

    await tx
      .insert(syncClientState)
      .values({ id: 1, syncUserScopeId: accountId, sessionEpoch })
      .onConflictDoUpdate({
        target: syncClientState.id,
        set: { syncUserScopeId: accountId, sessionEpoch },
      });

    const identity = {
      accountId,
      scopeType: "user" as const,
      scopeId: accountId,
    };
    const [scope] = await tx
      .select()
      .from(syncScopeState)
      .where(scopeWhere(identity))
      .limit(1);
    const responseEpoch = (scope?.responseEpoch ?? 0) + 1;

    await tx
      .insert(syncScopeState)
      .values({ ...identity, responseEpoch })
      .onConflictDoUpdate({
        target: [
          syncScopeState.accountId,
          syncScopeState.scopeType,
          syncScopeState.scopeId,
        ],
        set: { responseEpoch },
      });

    for (const collection of SYNC_COLLECTIONS) {
      const insert = tx
        .insert(syncCollectionState)
        .values({ ...identity, collection, cursor: 0 });
      if (resetCursor) {
        await insert.onConflictDoUpdate({
          target: [
            syncCollectionState.accountId,
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

    return { ...identity, sessionEpoch, responseEpoch };
  });
}

export async function beginUserSyncSession(
  accountId: string,
  database: typeof db = db,
): Promise<SyncFence> {
  return startUserSyncSession(accountId, true, database);
}

export async function resumeUserSyncSession(
  accountId: string,
  database: typeof db = db,
): Promise<SyncFence> {
  return startUserSyncSession(accountId, false, database);
}

async function invalidateSyncSession(
  clearUserScope: boolean,
  database: typeof db = db,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [client] = await tx
      .select()
      .from(syncClientState)
      .where(eq(syncClientState.id, 1))
      .limit(1);
    const syncUserScopeId = client?.syncUserScopeId ?? null;
    const sessionEpoch = (client?.sessionEpoch ?? 0) + 1;
    const nextSyncUserScopeId = clearUserScope ? null : syncUserScopeId;

    await tx
      .insert(syncClientState)
      .values({
        id: 1,
        syncUserScopeId: nextSyncUserScopeId,
        sessionEpoch,
      })
      .onConflictDoUpdate({
        target: syncClientState.id,
        set: { syncUserScopeId: nextSyncUserScopeId, sessionEpoch },
      });

    if (syncUserScopeId) {
      await tx
        .update(syncScopeState)
        .set({
          responseEpoch: sql`${syncScopeState.responseEpoch} + 1`,
        })
        .where(eq(syncScopeState.accountId, syncUserScopeId));
    }
  });
}

export async function fenceSyncSession(
  database: typeof db = db,
): Promise<void> {
  return invalidateSyncSession(true, database);
}

export async function pauseSyncSession(
  database: typeof db = db,
): Promise<void> {
  return invalidateSyncSession(false, database);
}

export async function getActiveSyncFence(
  database: SyncDatabase = db,
): Promise<SyncFence | null> {
  const [client] = await database
    .select()
    .from(syncClientState)
    .where(eq(syncClientState.id, 1))
    .limit(1);
  if (!client?.syncUserScopeId) return null;

  const identity = {
    accountId: client.syncUserScopeId,
    scopeType: "user" as const,
    scopeId: client.syncUserScopeId,
  };
  const [scope] = await database
    .select()
    .from(syncScopeState)
    .where(scopeWhere(identity))
    .limit(1);
  if (!scope) return null;

  return {
    ...identity,
    sessionEpoch: client.sessionEpoch,
    responseEpoch: scope.responseEpoch,
  };
}

async function activeUserIdentity(database: SyncDatabase) {
  const [client] = await database
    .select()
    .from(syncClientState)
    .where(eq(syncClientState.id, 1))
    .limit(1);
  if (!client?.syncUserScopeId) return null;

  return {
    accountId: client.syncUserScopeId,
    scopeType: "user" as const,
    scopeId: client.syncUserScopeId,
  };
}

async function enqueueLocalMutation(
  database: SyncDatabase,
  identity: {
    accountId: string;
    scopeType: "user";
    scopeId: string;
  },
  collection: SyncCollection,
  localRowId: number,
  payload: SyncPayload | null,
  options: {
    unversioned?: boolean;
    skipCandidateSearch?: boolean;
    notify?: boolean;
  } = {},
): Promise<void> {
  const [existingSidecar] = await database
    .select()
    .from(syncItemState)
    .where(
      and(
        eq(syncItemState.accountId, identity.accountId),
        eq(syncItemState.scopeType, identity.scopeType),
        eq(syncItemState.scopeId, identity.scopeId),
        eq(syncItemState.collection, collection),
        eq(syncItemState.localRowId, localRowId),
      ),
    )
    .limit(1);
  let sidecar: SyncItemState | undefined = existingSidecar;

  if (!sidecar && payload !== null && !options.skipCandidateSearch) {
    const key = payloadKey(collection, payload);
    const index = await loadScopeSyncIndex(
      database,
      identity,
      await loadVisibleRowIds(database),
    );
    sidecar =
      (key === null ? null : claimBindingCandidate(index, collection, key)) ??
      undefined;
    if (sidecar) {
      await database
        .update(syncItemState)
        .set({ localRowId })
        .where(itemWhere({ ...sidecar, collection }));
      sidecar = { ...sidecar, localRowId };
    }
  }

  if (!sidecar) {
    const syncId = randomUUID();
    await database.insert(syncItemState).values({
      ...identity,
      collection,
      syncId,
      localRowId,
      acceptedSyncVersion: null,
      acceptedPayload: null,
      lastLocalGeneration: 0,
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
  const generation = sidecar.lastLocalGeneration + 1;

  let desiredBaseSyncVersion = options.unversioned
    ? null
    : sidecar.acceptedSyncVersion;
  let desiredParentHeadGeneration: number | null = null;
  let desiredParentSyncVersion: number | null = null;

  if (pending?.headPresent) {
    // A tail is based on the exact frozen state the head was authored from,
    // never a mutable accepted sidecar version observed while it is in flight.
    desiredBaseSyncVersion = pending.headExpectedSyncVersion;
    desiredParentHeadGeneration = pending.headGeneration;
  } else if (pending) {
    desiredBaseSyncVersion = pending.desiredBaseSyncVersion;
    desiredParentHeadGeneration = pending.desiredParentHeadGeneration;
    desiredParentSyncVersion = pending.desiredParentSyncVersion;
  }

  await database
    .update(syncItemState)
    .set({ lastLocalGeneration: generation })
    .where(itemWhere(identityWithItem));

  await database
    .insert(syncOutbox)
    .values({
      ...identityWithItem,
      desiredPayload: payload,
      desiredBaseSyncVersion,
      desiredGeneration: generation,
      desiredParentHeadGeneration,
      desiredParentSyncVersion,
      headPresent: pending?.headPresent ?? false,
      headPayload: pending?.headPayload ?? null,
      headExpectedSyncVersion: pending?.headExpectedSyncVersion ?? null,
      headGeneration: pending?.headGeneration ?? null,
    })
    .onConflictDoUpdate({
      target: [
        syncOutbox.accountId,
        syncOutbox.scopeType,
        syncOutbox.scopeId,
        syncOutbox.collection,
        syncOutbox.syncId,
      ],
      set: {
        desiredPayload: payload,
        desiredBaseSyncVersion,
        desiredGeneration: generation,
        desiredParentHeadGeneration,
        desiredParentSyncVersion,
      },
    });
  if (options.notify !== false) localMutationHandler?.();
}

export async function recordLocalSyncMutation(
  database: SyncDatabase,
  collection: SyncCollection,
  localRowId: number,
  payload: SyncPayload | null,
): Promise<void> {
  const identity = await activeUserIdentity(database);
  if (!identity) return;
  await enqueueLocalMutation(
    database,
    identity,
    collection,
    localRowId,
    payload,
  );
}

export interface LocalSyncMutation {
  collection: SyncCollection;
  localRowId: number;
  payload: SyncPayload;
}

async function enqueueLocalSyncMutationsBulk(
  database: SyncDatabase,
  identity: {
    accountId: string;
    scopeType: "user";
    scopeId: string;
  },
  mutations: LocalSyncMutation[],
  options: {
    unversioned?: boolean;
    onlyUnbound?: boolean;
    visibleRowIds?: Record<SyncCollection, Set<number>>;
  } = {},
): Promise<void> {
  if (mutations.length === 0) return;

  const visibleRowIds =
    options.visibleRowIds ?? (await loadVisibleRowIds(database));
  const index = await loadScopeSyncIndex(database, identity, visibleRowIds);

  for (const mutation of mutations) {
    const rowKey = localRowKey(mutation.collection, mutation.localRowId);
    if (options.onlyUnbound && index.sidecarByLocalRow.has(rowKey)) {
      continue;
    }

    if (!index.sidecarByLocalRow.has(rowKey)) {
      const key = payloadKey(mutation.collection, mutation.payload);
      const candidate =
        key === null
          ? null
          : claimBindingCandidate(index, mutation.collection, key);
      if (candidate) {
        await database
          .update(syncItemState)
          .set({ localRowId: mutation.localRowId })
          .where(itemWhere({ ...candidate, collection: mutation.collection }));
        index.sidecarByLocalRow.set(rowKey, {
          ...candidate,
          localRowId: mutation.localRowId,
        });
      }
    }

    await enqueueLocalMutation(
      database,
      identity,
      mutation.collection,
      mutation.localRowId,
      mutation.payload,
      {
        unversioned: options.unversioned,
        skipCandidateSearch: true,
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
  const identity = await activeUserIdentity(database);
  if (!identity) return;
  await enqueueLocalSyncMutationsBulk(database, identity, mutations);
}

export async function prepareVisibleRowsForFullSync(
  fence: SyncFence,
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    if (!(await fenceIsCurrent(tx, fence))) return false;
    if (fence.scopeType !== "user") return false;

    const vocabularyRows = await tx.select().from(vocabulary);
    const snippetRows = await tx.select().from(snippets);
    const visibleRowIds = {
      vocabulary: new Set(vocabularyRows.map((row) => row.id)),
      snippet: new Set(snippetRows.map((row) => row.id)),
    } satisfies Record<SyncCollection, Set<number>>;
    const index = await loadScopeSyncIndex(tx, fence, visibleRowIds);
    const identity = {
      accountId: fence.accountId,
      scopeType: "user" as const,
      scopeId: fence.scopeId,
    };
    let enqueuedMutation = false;

    const prepareRow = async (
      collection: SyncCollection,
      localRowId: number,
      payload: SyncPayload,
    ) => {
      const rowKey = localRowKey(collection, localRowId);
      const sidecar = index.sidecarByLocalRow.get(rowKey);
      if (!sidecar) return;
      const pending = index.pendingByItem.get(
        syncItemKey(collection, sidecar.syncId),
      );

      if (pending) {
        if (!payloadsEqual(payload, pending.desiredPayload)) {
          await enqueueLocalMutation(
            tx,
            identity,
            collection,
            localRowId,
            payload,
            { skipCandidateSearch: true, notify: false },
          );
          enqueuedMutation = true;
        }
        return;
      }

      if (
        !payloadsEqual(payload, sidecar.acceptedPayload) &&
        payloadKey(collection, payload) !==
          payloadKey(collection, sidecar.acceptedPayload)
      ) {
        // A changed key is a separate adoption candidate. Same-key differences
        // stay linked so the login pull can apply the canonical server row.
        await tx
          .update(syncItemState)
          .set({ localRowId: null })
          .where(itemWhere({ ...sidecar, collection }));
        sidecar.localRowId = null;
        index.sidecarByLocalRow.delete(rowKey);
      }
    };

    for (const row of vocabularyRows) {
      await prepareRow("vocabulary", row.id, vocabularySyncPayload(row));
    }
    for (const row of snippetRows) {
      await prepareRow("snippet", row.id, snippetSyncPayload(row));
    }

    for (const sidecar of index.sidecars) {
      if (
        sidecar.localRowId === null ||
        visibleRowIds[sidecar.collection].has(sidecar.localRowId)
      ) {
        continue;
      }
      const pending = index.pendingByItem.get(
        syncItemKey(sidecar.collection, sidecar.syncId),
      );
      if (!pending || pending.desiredPayload !== null) {
        await enqueueLocalMutation(
          tx,
          identity,
          sidecar.collection,
          sidecar.localRowId,
          null,
          { skipCandidateSearch: true, notify: false },
        );
        enqueuedMutation = true;
      }
    }

    if (enqueuedMutation) localMutationHandler?.();
    return true;
  });
}

async function findSidecar(
  database: SyncDatabase,
  fence: SyncFence,
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

async function clearLocalRowLinks(
  database: SyncDatabase,
  collection: SyncCollection,
  localRowId: number,
): Promise<void> {
  await database
    .update(syncItemState)
    .set({ localRowId: null })
    .where(
      and(
        eq(syncItemState.collection, collection),
        eq(syncItemState.localRowId, localRowId),
      ),
    );
}

async function discardCurrentAccountCollision(
  database: SyncDatabase,
  fence: SyncFence,
  collection: SyncCollection,
  localRowId: number,
  winningSyncId: string,
  preservePending: boolean,
): Promise<void> {
  const [loser] = await database
    .select()
    .from(syncItemState)
    .where(
      and(
        eq(syncItemState.accountId, fence.accountId),
        eq(syncItemState.scopeType, fence.scopeType),
        eq(syncItemState.scopeId, fence.scopeId),
        eq(syncItemState.collection, collection),
        eq(syncItemState.localRowId, localRowId),
        ne(syncItemState.syncId, winningSyncId),
      ),
    )
    .limit(1);
  if (!loser) return;

  if (!preservePending) {
    await database
      .delete(syncOutbox)
      .where(outboxWhere({ ...loser, collection }));
  }
  await database
    .update(syncItemState)
    .set({ localRowId: null })
    .where(itemWhere({ ...loser, collection }));
}

async function applyDomainPayload(
  database: SyncDatabase,
  fence: SyncFence,
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
  preserveCollidingPending = false,
): Promise<void> {
  const sidecar = await findSidecar(database, fence, collection, syncId);
  if (!sidecar) throw new Error("Sync sidecar missing during canonical apply");

  if (payload === null) {
    if (sidecar.localRowId !== null) {
      if (collection === "vocabulary") {
        await database
          .delete(vocabulary)
          .where(eq(vocabulary.id, sidecar.localRowId));
      } else {
        await database
          .delete(snippets)
          .where(eq(snippets.id, sidecar.localRowId));
      }
      await clearLocalRowLinks(database, collection, sidecar.localRowId);
    }
    return;
  }

  let localRowId = sidecar.localRowId;
  const now = new Date();

  if (collection === "vocabulary") {
    const value = payload as VocabularySyncPayload;
    const [keyRow] = await database
      .select()
      .from(vocabulary)
      .where(eq(vocabulary.word, value.word))
      .limit(1);

    if (keyRow && keyRow.id !== localRowId) {
      await discardCurrentAccountCollision(
        database,
        fence,
        collection,
        keyRow.id,
        syncId,
        preserveCollidingPending,
      );
      if (localRowId !== null) {
        await database.delete(vocabulary).where(eq(vocabulary.id, keyRow.id));
        await clearLocalRowLinks(database, collection, keyRow.id);
      } else {
        localRowId = keyRow.id;
      }
    }

    if (localRowId !== null) {
      const [updated] = await database
        .update(vocabulary)
        .set({
          word: value.word,
          replacementWord: value.replacement,
          isReplacement: value.replacement !== null,
          updatedAt: now,
        })
        .where(eq(vocabulary.id, localRowId))
        .returning({ id: vocabulary.id });
      if (!updated) localRowId = null;
    }

    if (localRowId === null) {
      const [created] = await database
        .insert(vocabulary)
        .values({
          word: value.word,
          replacementWord: value.replacement,
          isReplacement: value.replacement !== null,
          dateAdded: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: vocabulary.id });
      localRowId = created.id;
    }
  } else {
    const value = payload as SnippetSyncPayload;
    const [keyRow] = await database
      .select()
      .from(snippets)
      .where(eq(snippets.trigger, value.trigger))
      .limit(1);

    if (keyRow && keyRow.id !== localRowId) {
      await discardCurrentAccountCollision(
        database,
        fence,
        collection,
        keyRow.id,
        syncId,
        preserveCollidingPending,
      );
      if (localRowId !== null) {
        await database.delete(snippets).where(eq(snippets.id, keyRow.id));
        await clearLocalRowLinks(database, collection, keyRow.id);
      } else {
        localRowId = keyRow.id;
      }
    }

    if (localRowId !== null) {
      const [updated] = await database
        .update(snippets)
        .set({
          trigger: value.trigger,
          content: value.content,
          updatedAt: now,
        })
        .where(eq(snippets.id, localRowId))
        .returning({ id: snippets.id });
      if (!updated) localRowId = null;
    }

    if (localRowId === null) {
      const [created] = await database
        .insert(snippets)
        .values({
          trigger: value.trigger,
          content: value.content,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: snippets.id });
      localRowId = created.id;
    }
  }

  await database
    .update(syncItemState)
    .set({ localRowId })
    .where(itemWhere({ ...fence, collection, syncId }));
}

async function ensureCanonicalSidecar(
  database: SyncDatabase,
  fence: SyncFence,
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
    accountId: fence.accountId,
    scopeType: fence.scopeType,
    scopeId: fence.scopeId,
    collection: item.collection,
    syncId: item.syncId,
    localRowId: null,
    acceptedSyncVersion: null,
    acceptedPayload: null,
    lastLocalGeneration: 0,
  });
  sidecar = await findSidecar(database, fence, item.collection, item.syncId);
  if (!sidecar) throw new Error("Failed to create canonical sync sidecar");
  return sidecar;
}

async function setAcceptedState(
  database: SyncDatabase,
  fence: SyncFence,
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
  fence: SyncFence,
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
    pending.headGeneration !== head.headGeneration
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

  if (pending.desiredGeneration === head.headGeneration) {
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

  if (pending.desiredParentHeadGeneration !== head.headGeneration) {
    throw new Error("Sync tail does not reference its satisfied head");
  }
  await database
    .update(syncOutbox)
    .set({
      desiredParentSyncVersion: syncVersion,
      headPresent: false,
      headPayload: null,
      headExpectedSyncVersion: null,
      headGeneration: null,
    })
    .where(outboxWhere(identity));
}

async function permanentlyFailHead(
  database: SyncDatabase,
  fence: SyncFence,
  head: CapturedSyncHead,
): Promise<void> {
  const identity = { ...fence, ...head };
  const [pending] = await database
    .select()
    .from(syncOutbox)
    .where(outboxWhere(identity))
    .limit(1);
  if (!pending?.headPresent || pending.headGeneration !== head.headGeneration) {
    return;
  }

  if (pending.desiredGeneration !== head.headGeneration) {
    await database
      .update(syncOutbox)
      .set({
        desiredParentHeadGeneration: null,
        desiredParentSyncVersion: null,
        headPresent: false,
        headPayload: null,
        headExpectedSyncVersion: null,
        headGeneration: null,
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
  fence: SyncFence,
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
    pending.headGeneration !== null
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
        headGeneration: pending.headGeneration,
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
  fence: SyncFence,
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
  fence: SyncFence,
  pages: PullCollectionPage[],
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    if (!(await fenceIsCurrent(tx, fence))) return false;

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
  fence: SyncFence,
  collections: readonly SyncCollection[] = SYNC_COLLECTIONS,
  database: SyncDatabase = db,
): Promise<PullCollectionCursor[] | null> {
  if (!(await fenceIsCurrent(database, fence))) return null;
  if (collections.length === 0) return [];

  const rows = await database
    .select({
      collection: syncCollectionState.collection,
      cursor: syncCollectionState.cursor,
    })
    .from(syncCollectionState)
    .where(
      and(
        eq(syncCollectionState.accountId, fence.accountId),
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
  fence: SyncFence,
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    if (!(await fenceIsCurrent(tx, fence))) return false;

    // Only unbound rows are adoption candidates. Existing identities are
    // governed by their accepted state or durable outbox, so a same-key
    // signed-out edit is not promoted before the login pull.
    const vocabularyRows = await tx.select().from(vocabulary);
    const snippetRows = await tx.select().from(snippets);
    await enqueueLocalSyncMutationsBulk(
      tx,
      {
        accountId: fence.accountId,
        scopeType: "user",
        scopeId: fence.scopeId,
      },
      [
        ...vocabularyRows.map((row) => ({
          collection: "vocabulary" as const,
          localRowId: row.id,
          payload: vocabularySyncPayload(row),
        })),
        ...snippetRows.map((row) => ({
          collection: "snippet" as const,
          localRowId: row.id,
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
  fence: SyncFence,
  database: typeof db = db,
  collections: readonly SyncCollection[] = ["vocabulary", "snippet"],
): Promise<CapturedSyncHead[]> {
  if (collections.length === 0) return [];
  return database.transaction(async (tx) => {
    if (!(await fenceIsCurrent(tx, fence))) return [];

    const pendingRows = await tx
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.accountId, fence.accountId),
          eq(syncOutbox.scopeType, fence.scopeType),
          eq(syncOutbox.scopeId, fence.scopeId),
          inArray(syncOutbox.collection, [...collections]),
        ),
      );

    for (const pending of pendingRows) {
      if (pending.headPresent) continue;
      if (
        pending.desiredParentHeadGeneration !== null &&
        pending.desiredParentSyncVersion === null
      ) {
        continue;
      }
      const expectedSyncVersion =
        pending.desiredParentHeadGeneration === null
          ? pending.desiredBaseSyncVersion
          : pending.desiredParentSyncVersion;
      await tx
        .update(syncOutbox)
        .set({
          headPresent: true,
          headPayload: pending.desiredPayload,
          headExpectedSyncVersion: expectedSyncVersion,
          headGeneration: pending.desiredGeneration,
        })
        .where(outboxWhere(pending));
    }

    const heads = await tx
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.accountId, fence.accountId),
          eq(syncOutbox.scopeType, fence.scopeType),
          eq(syncOutbox.scopeId, fence.scopeId),
          inArray(syncOutbox.collection, [...collections]),
          eq(syncOutbox.headPresent, true),
        ),
      );

    return heads.flatMap((head) =>
      head.headGeneration === null
        ? []
        : [
            {
              ...fence,
              collection: head.collection,
              syncId: head.syncId,
              headPayload: head.headPayload,
              headExpectedSyncVersion: head.headExpectedSyncVersion,
              headGeneration: head.headGeneration,
            },
          ],
    );
  });
}

export async function applyPushResults(
  fence: SyncFence,
  heads: CapturedSyncHead[],
  results: PushSyncResult[],
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    if (!(await fenceIsCurrent(tx, fence))) return false;

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
      if (
        !current?.headPresent ||
        current.headGeneration !== head.headGeneration
      ) {
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
  fence: SyncFence,
  database: SyncDatabase = db,
  collections: readonly SyncCollection[] = ["vocabulary", "snippet"],
): Promise<boolean> {
  if (collections.length === 0) return false;
  if (!(await fenceIsCurrent(database, fence))) return false;
  const [pending] = await database
    .select({ syncId: syncOutbox.syncId })
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.accountId, fence.accountId),
        eq(syncOutbox.scopeType, fence.scopeType),
        eq(syncOutbox.scopeId, fence.scopeId),
        inArray(syncOutbox.collection, [...collections]),
      ),
    )
    .limit(1);
  return Boolean(pending);
}
