import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";

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
let activeUserAccountId: string | null = null;
const activeSyncScopes = new Map<
  string,
  { canWrite: boolean; role: string | null }
>();

const PERSONAL_SCOPE_ID = "";
const activeScopeKey = (scopeType: SyncScopeType, scopeId: string) =>
  `${scopeType}:${scopeId}`;

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

function loadVisibleRowIds(
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

function loadScopeSyncIndex(
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
  context.accountId === activeUserAccountId &&
  activeSyncScopes.has(activeScopeKey(context.scopeType, context.scopeId));

async function startSyncScopeSession(
  accountId: string,
  scopeType: SyncScopeType,
  scopeId: string,
  canWrite: boolean,
  role: string | null,
  resetCursor: boolean,
  database: typeof db = db,
): Promise<SyncContext> {
  const context = database.transaction((tx) => {
    tx.insert(syncClientState)
      .values({ id: 1, lastOutboxSequence: 0 })
      .onConflictDoNothing()
      .run();

    const scope = { scopeType, scopeId };

    tx.insert(syncScopeState)
      .values({ ...scope, canWrite, role })
      .onConflictDoUpdate({
        target: [syncScopeState.scopeType, syncScopeState.scopeId],
        set: { canWrite, role },
      })
      .run();

    for (const collection of SYNC_COLLECTIONS) {
      const insert = tx
        .insert(syncCollectionState)
        .values({ ...scope, collection, cursor: 0 });
      if (resetCursor) {
        insert
          .onConflictDoUpdate({
            target: [
              syncCollectionState.scopeType,
              syncCollectionState.scopeId,
              syncCollectionState.collection,
            ],
            set: { cursor: 0 },
          })
          .run();
      } else {
        insert.onConflictDoNothing().run();
      }
    }

    return { accountId, ...scope };
  });
  activeUserAccountId = accountId;
  activeSyncScopes.set(activeScopeKey(scopeType, scopeId), { canWrite, role });
  return context;
}

export async function beginUserSyncSession(
  accountId: string,
  database: typeof db = db,
): Promise<SyncContext> {
  activeSyncScopes.clear();
  return startSyncScopeSession(
    accountId,
    "user",
    accountId,
    true,
    null,
    true,
    database,
  );
}

export async function resumeUserSyncSession(
  accountId: string,
  database: typeof db = db,
): Promise<SyncContext> {
  activeSyncScopes.clear();
  return startSyncScopeSession(
    accountId,
    "user",
    accountId,
    true,
    null,
    false,
    database,
  );
}

export interface AdvertisedSyncScope {
  scopeType: SyncScopeType;
  scopeId: string;
  role: string | null;
  canWrite: boolean;
  latestSyncVersion: number;
}

export interface ReconciledSyncScopes {
  contexts: SyncContext[];
  organizationChanged: boolean;
  capabilityChanged: boolean;
}

export async function reconcileSyncScopes(
  accountId: string,
  scopes: readonly AdvertisedSyncScope[],
  database: typeof db = db,
): Promise<ReconciledSyncScopes | null> {
  if (activeUserAccountId !== accountId) return null;

  const userScopes = scopes.filter((scope) => scope.scopeType === "user");
  const userScope = userScopes.find(
    (scope) => scope.scopeType === "user" && scope.scopeId === accountId,
  );
  if (
    userScopes.length !== 1 ||
    !userScope?.canWrite ||
    new Set(
      scopes.map((scope) => activeScopeKey(scope.scopeType, scope.scopeId)),
    ).size !== scopes.length
  ) {
    throw new Error("Bootstrap omitted the active writable user scope");
  }
  const organizationScopes = scopes.filter(
    (scope) => scope.scopeType === "org",
  );
  if (organizationScopes.length > 1) {
    throw new Error("Bootstrap advertised more than one active organization");
  }

  const desiredOrganization = organizationScopes[0] ?? null;
  const previousScopeRows = database.select().from(syncScopeState).all();
  const previousOrganization = previousScopeRows.find(
    (scope) => scope.scopeType === "org",
  );
  const organizationChanged =
    previousOrganization?.scopeId !== desiredOrganization?.scopeId;
  const capabilityChanged = scopes.some((scope) => {
    const previous = previousScopeRows.find(
      (row) =>
        row.scopeType === scope.scopeType && row.scopeId === scope.scopeId,
    );
    return (
      !previous ||
      previous.canWrite !== scope.canWrite ||
      previous.role !== scope.role
    );
  });

  database.transaction((tx) => {
    const desiredOrganizationId = desiredOrganization?.scopeId;
    const vocabularyOrganizations = tx
      .select({ scopeId: vocabulary.scopeId })
      .from(vocabulary)
      .where(eq(vocabulary.scopeType, "org"))
      .all();
    const snippetOrganizations = tx
      .select({ scopeId: snippets.scopeId })
      .from(snippets)
      .where(eq(snippets.scopeType, "org"))
      .all();
    const metadataOrganizations = tx
      .select({ scopeId: syncCollectionState.scopeId })
      .from(syncCollectionState)
      .where(eq(syncCollectionState.scopeType, "org"))
      .all();
    const itemStateOrganizations = tx
      .select({ scopeId: syncItemState.scopeId })
      .from(syncItemState)
      .where(eq(syncItemState.scopeType, "org"))
      .all();
    const outboxOrganizations = tx
      .select({ scopeId: syncOutbox.scopeId })
      .from(syncOutbox)
      .where(eq(syncOutbox.scopeType, "org"))
      .all();
    const advertisedOrganizations = tx
      .select({ scopeId: syncScopeState.scopeId })
      .from(syncScopeState)
      .where(eq(syncScopeState.scopeType, "org"))
      .all();
    const staleOrganizationIds = new Set(
      [
        ...vocabularyOrganizations,
        ...snippetOrganizations,
        ...metadataOrganizations,
        ...itemStateOrganizations,
        ...outboxOrganizations,
        ...advertisedOrganizations,
      ]
        .map((row) => row.scopeId)
        .filter((scopeId) => scopeId !== desiredOrganizationId),
    );

    for (const scopeId of staleOrganizationIds) {
      tx.delete(vocabulary)
        .where(
          and(eq(vocabulary.scopeType, "org"), eq(vocabulary.scopeId, scopeId)),
        )
        .run();
      tx.delete(snippets)
        .where(
          and(eq(snippets.scopeType, "org"), eq(snippets.scopeId, scopeId)),
        )
        .run();
      tx.delete(syncOutbox)
        .where(
          and(eq(syncOutbox.scopeType, "org"), eq(syncOutbox.scopeId, scopeId)),
        )
        .run();
      tx.delete(syncItemState)
        .where(
          and(
            eq(syncItemState.scopeType, "org"),
            eq(syncItemState.scopeId, scopeId),
          ),
        )
        .run();
      tx.delete(syncCollectionState)
        .where(
          and(
            eq(syncCollectionState.scopeType, "org"),
            eq(syncCollectionState.scopeId, scopeId),
          ),
        )
        .run();
    }

    tx.delete(syncScopeState).run();
    for (const scope of scopes) {
      tx.insert(syncScopeState)
        .values({
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          role: scope.role,
          canWrite: scope.canWrite,
        })
        .run();
      for (const collection of SYNC_COLLECTIONS) {
        tx.insert(syncCollectionState)
          .values({
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            collection,
            cursor: 0,
          })
          .onConflictDoNothing()
          .run();
      }
    }

    if (desiredOrganization && !desiredOrganization.canWrite) {
      discardPendingScopeMutations(tx, {
        accountId,
        scopeType: "org",
        scopeId: desiredOrganization.scopeId,
      });
    }
  });

  if (activeUserAccountId !== accountId) return null;
  activeSyncScopes.clear();
  for (const scope of scopes) {
    activeSyncScopes.set(activeScopeKey(scope.scopeType, scope.scopeId), {
      canWrite: scope.canWrite,
      role: scope.role,
    });
  }
  return {
    contexts: scopes.map((scope) => ({
      accountId,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    })),
    organizationChanged,
    capabilityChanged,
  };
}

export function pauseSyncSession(): void {
  activeUserAccountId = null;
  activeSyncScopes.clear();
}

export function deactivateOrganizationSyncScopes(): boolean {
  let changed = false;
  for (const key of activeSyncScopes.keys()) {
    if (!key.startsWith("org:")) continue;
    activeSyncScopes.delete(key);
    changed = true;
  }
  return changed;
}

export async function clearSyncState(database: typeof db = db): Promise<void> {
  activeUserAccountId = null;
  activeSyncScopes.clear();
  database.transaction((tx) => {
    tx.delete(vocabulary).where(eq(vocabulary.scopeType, "org")).run();
    tx.delete(snippets).where(eq(snippets.scopeType, "org")).run();
    tx.delete(syncOutbox).run();
    tx.delete(syncItemState).run();
    tx.delete(syncCollectionState).run();
    tx.delete(syncScopeState).run();
    tx.delete(syncClientState).run();
  });
}

export async function hasResumableUserSyncState(
  accountId: string,
  database: SyncDatabase = db,
): Promise<boolean> {
  const state = database
    .select({ collection: syncCollectionState.collection })
    .from(syncCollectionState)
    .where(
      and(
        eq(syncCollectionState.scopeType, "user"),
        eq(syncCollectionState.scopeId, accountId),
      ),
    )
    .limit(1)
    .get();
  return Boolean(state);
}

function activeUserIdentity() {
  if (!activeUserAccountId) return null;

  return {
    scopeType: "user" as const,
    scopeId: activeUserAccountId,
  };
}

function activeWritableOrganizationIdentity() {
  for (const [key, access] of activeSyncScopes) {
    if (!key.startsWith("org:") || !access.canWrite) continue;
    return { scopeType: "org" as const, scopeId: key.slice(4) };
  }
  return null;
}

export async function getActiveOrganizationAccess(
  database: SyncDatabase = db,
): Promise<{
  scopeId: string;
  role: string | null;
  canWrite: boolean;
} | null> {
  if (!activeUserAccountId) return null;
  const row = database
    .select()
    .from(syncScopeState)
    .where(eq(syncScopeState.scopeType, "org"))
    .limit(1)
    .get();
  if (!row || !activeSyncScopes.has(activeScopeKey("org", row.scopeId))) {
    return null;
  }
  return { scopeId: row.scopeId, role: row.role, canWrite: row.canWrite };
}

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
  identity: {
    scopeType: SyncScopeType;
    scopeId: string;
  },
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
  options: {
    unversioned?: boolean;
    notify?: boolean;
  } = {},
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
      .where(
        itemWhere({
          ...identity,
          collection,
          syncId,
        }),
      )
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
  if (options.notify !== false) localMutationHandler?.();
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

export interface LocalSyncMutation {
  collection: SyncCollection;
  syncId: string;
  payload: SyncPayload;
}

function enqueueLocalSyncMutationsBulk(
  database: SyncDatabase,
  identity: {
    scopeType: SyncScopeType;
    scopeId: string;
  },
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
    if (options.onlyUnbound && index.sidecarByItem.has(itemKey)) {
      continue;
    }

    enqueueLocalMutation(
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
    const identity = {
      scopeType: "user" as const,
      scopeId: fence.scopeId,
    };
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

      if (pending) {
        if (!payloadsEqual(payload, pending.desiredPayload)) {
          enqueueLocalMutation(tx, identity, collection, syncId, payload, {
            notify: false,
          });
          enqueuedMutation = true;
        }
      }
    };

    for (const row of vocabularyRows) {
      prepareRow("vocabulary", row.id, vocabularySyncPayload(row));
    }
    for (const row of snippetRows) {
      prepareRow("snippet", row.id, snippetSyncPayload(row));
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

    if (enqueuedMutation) localMutationHandler?.();
    return true;
  });
}

function findSidecar(
  database: SyncDatabase,
  fence: SyncContext,
  collection: SyncCollection,
  syncId: string,
): SyncItemState | null {
  const sidecar = database
    .select()
    .from(syncItemState)
    .where(itemWhere({ ...fence, collection, syncId }))
    .limit(1)
    .get();
  return sidecar ?? null;
}

function discardCurrentAccountCollision(
  database: SyncDatabase,
  fence: SyncContext,
  collection: SyncCollection,
  losingSyncId: string,
  preservePending: boolean,
): void {
  if (preservePending) return;
  database
    .delete(syncOutbox)
    .where(outboxWhere({ ...fence, collection, syncId: losingSyncId }))
    .run();
}

function applyDomainPayload(
  database: SyncDatabase,
  fence: SyncContext,
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
  preserveCollidingPending = false,
): void {
  const sidecar = findSidecar(database, fence, collection, syncId);
  if (!sidecar) throw new Error("Sync sidecar missing during canonical apply");
  const domainScopeId =
    fence.scopeType === "user" ? PERSONAL_SCOPE_ID : fence.scopeId;

  if (payload === null) {
    if (collection === "vocabulary") {
      database
        .delete(vocabulary)
        .where(
          and(
            eq(vocabulary.id, syncId),
            eq(vocabulary.scopeType, fence.scopeType),
            eq(vocabulary.scopeId, domainScopeId),
          ),
        )
        .run();
    } else {
      database
        .delete(snippets)
        .where(
          and(
            eq(snippets.id, syncId),
            eq(snippets.scopeType, fence.scopeType),
            eq(snippets.scopeId, domainScopeId),
          ),
        )
        .run();
    }
    return;
  }

  const now = new Date();

  if (collection === "vocabulary") {
    const value = payload as VocabularySyncPayload;
    const keyRow = database
      .select()
      .from(vocabulary)
      .where(
        and(
          eq(vocabulary.scopeType, fence.scopeType),
          eq(vocabulary.scopeId, domainScopeId),
          eq(vocabulary.word, value.word),
        ),
      )
      .limit(1)
      .get();

    if (keyRow && keyRow.id !== syncId) {
      discardCurrentAccountCollision(
        database,
        fence,
        collection,
        keyRow.id,
        preserveCollidingPending,
      );
      database
        .delete(vocabulary)
        .where(
          and(
            eq(vocabulary.id, keyRow.id),
            eq(vocabulary.scopeType, fence.scopeType),
            eq(vocabulary.scopeId, domainScopeId),
          ),
        )
        .run();
    }

    const updated = database
      .update(vocabulary)
      .set({
        scopeType: fence.scopeType,
        scopeId: domainScopeId,
        word: value.word,
        replacementWord: value.replacement,
        updatedAt: now,
      })
      .where(
        and(
          eq(vocabulary.id, syncId),
          eq(vocabulary.scopeType, fence.scopeType),
          eq(vocabulary.scopeId, domainScopeId),
        ),
      )
      .returning({ id: vocabulary.id })
      .get();
    if (!updated) {
      database
        .insert(vocabulary)
        .values({
          id: syncId,
          scopeType: fence.scopeType,
          scopeId: domainScopeId,
          word: value.word,
          replacementWord: value.replacement,
          dateAdded: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  } else {
    const value = payload as SnippetSyncPayload;
    const keyRow = database
      .select()
      .from(snippets)
      .where(
        and(
          eq(snippets.scopeType, fence.scopeType),
          eq(snippets.scopeId, domainScopeId),
          eq(snippets.trigger, value.trigger),
        ),
      )
      .limit(1)
      .get();

    if (keyRow && keyRow.id !== syncId) {
      discardCurrentAccountCollision(
        database,
        fence,
        collection,
        keyRow.id,
        preserveCollidingPending,
      );
      database
        .delete(snippets)
        .where(
          and(
            eq(snippets.id, keyRow.id),
            eq(snippets.scopeType, fence.scopeType),
            eq(snippets.scopeId, domainScopeId),
          ),
        )
        .run();
    }

    const updated = database
      .update(snippets)
      .set({
        scopeType: fence.scopeType,
        scopeId: domainScopeId,
        trigger: value.trigger,
        content: value.content,
        updatedAt: now,
      })
      .where(
        and(
          eq(snippets.id, syncId),
          eq(snippets.scopeType, fence.scopeType),
          eq(snippets.scopeId, domainScopeId),
        ),
      )
      .returning({ id: snippets.id })
      .get();
    if (!updated) {
      database
        .insert(snippets)
        .values({
          id: syncId,
          scopeType: fence.scopeType,
          scopeId: domainScopeId,
          trigger: value.trigger,
          content: value.content,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }
}

function discardPendingScopeMutations(
  database: SyncDatabase,
  fence: SyncContext,
): void {
  const pendingRows = database
    .select()
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.scopeType, fence.scopeType),
        eq(syncOutbox.scopeId, fence.scopeId),
      ),
    )
    .all();

  for (const pending of pendingRows) {
    const sidecar = findSidecar(
      database,
      fence,
      pending.collection,
      pending.syncId,
    );
    database.delete(syncOutbox).where(outboxWhere(pending)).run();
    if (sidecar) {
      applyDomainPayload(
        database,
        fence,
        pending.collection,
        pending.syncId,
        sidecar.acceptedPayload ?? null,
      );
    }
  }
}

export async function removeOrganizationSyncScope(
  fence: SyncContext,
  database: typeof db = db,
): Promise<boolean> {
  if (fence.scopeType !== "org" || !contextIsActive(fence)) return false;

  database.transaction((tx) => {
    tx.delete(vocabulary)
      .where(
        and(
          eq(vocabulary.scopeType, "org"),
          eq(vocabulary.scopeId, fence.scopeId),
        ),
      )
      .run();
    tx.delete(snippets)
      .where(
        and(eq(snippets.scopeType, "org"), eq(snippets.scopeId, fence.scopeId)),
      )
      .run();
    tx.delete(syncOutbox)
      .where(
        and(
          eq(syncOutbox.scopeType, "org"),
          eq(syncOutbox.scopeId, fence.scopeId),
        ),
      )
      .run();
    tx.delete(syncItemState)
      .where(
        and(
          eq(syncItemState.scopeType, "org"),
          eq(syncItemState.scopeId, fence.scopeId),
        ),
      )
      .run();
    tx.delete(syncCollectionState)
      .where(
        and(
          eq(syncCollectionState.scopeType, "org"),
          eq(syncCollectionState.scopeId, fence.scopeId),
        ),
      )
      .run();
    tx.delete(syncScopeState)
      .where(
        and(
          eq(syncScopeState.scopeType, "org"),
          eq(syncScopeState.scopeId, fence.scopeId),
        ),
      )
      .run();
  });
  activeSyncScopes.delete(activeScopeKey("org", fence.scopeId));
  return true;
}

function ensureCanonicalSidecar(
  database: SyncDatabase,
  fence: SyncContext,
  item: CanonicalSyncItem,
): SyncItemState {
  let sidecar = findSidecar(database, fence, item.collection, item.syncId);
  if (sidecar) return sidecar;

  database
    .insert(syncItemState)
    .values({
      scopeType: fence.scopeType,
      scopeId: fence.scopeId,
      collection: item.collection,
      syncId: item.syncId,
      acceptedSyncVersion: null,
      acceptedPayload: null,
    })
    .run();
  sidecar = findSidecar(database, fence, item.collection, item.syncId);
  if (!sidecar) throw new Error("Failed to create canonical sync sidecar");
  return sidecar;
}

function setAcceptedState(
  database: SyncDatabase,
  fence: SyncContext,
  item: CanonicalSyncItem,
): boolean {
  const sidecar = ensureCanonicalSidecar(database, fence, item);
  if (
    sidecar.acceptedSyncVersion !== null &&
    sidecar.acceptedSyncVersion > item.syncVersion
  ) {
    return false;
  }
  database
    .update(syncItemState)
    .set({
      acceptedSyncVersion: item.syncVersion,
      acceptedPayload: item.payload,
    })
    .where(itemWhere({ ...fence, ...item }))
    .run();
  return true;
}

function acceptHead(
  database: SyncDatabase,
  fence: SyncContext,
  head: CapturedSyncHead,
  syncVersion: number,
): void {
  const identity = { ...fence, ...head };
  const sidecar = findSidecar(database, fence, head.collection, head.syncId);
  const pending = database
    .select()
    .from(syncOutbox)
    .where(outboxWhere(identity))
    .limit(1)
    .get();
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
  database
    .update(syncItemState)
    .set({
      acceptedSyncVersion: syncVersion,
      acceptedPayload: head.headPayload,
    })
    .where(itemWhere(identity))
    .run();

  if (pending.desiredSequence === head.headSequence) {
    database.delete(syncOutbox).where(outboxWhere(identity)).run();
    applyDomainPayload(
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
  database
    .update(syncOutbox)
    .set({
      desiredParentSyncVersion: syncVersion,
      headPresent: false,
      headPayload: null,
      headExpectedSyncVersion: null,
      headSequence: null,
    })
    .where(outboxWhere(identity))
    .run();
}

function permanentlyFailHead(
  database: SyncDatabase,
  fence: SyncContext,
  head: CapturedSyncHead,
): void {
  const identity = { ...fence, ...head };
  const pending = database
    .select()
    .from(syncOutbox)
    .where(outboxWhere(identity))
    .limit(1)
    .get();
  if (!pending?.headPresent || pending.headSequence !== head.headSequence) {
    return;
  }

  if (pending.desiredSequence !== head.headSequence) {
    database
      .update(syncOutbox)
      .set({
        desiredParentHeadSequence: null,
        desiredParentSyncVersion: null,
        headPresent: false,
        headPayload: null,
        headExpectedSyncVersion: null,
        headSequence: null,
      })
      .where(outboxWhere(identity))
      .run();
    return;
  }

  database.delete(syncOutbox).where(outboxWhere(identity)).run();
  const sidecar = findSidecar(database, fence, head.collection, head.syncId);
  applyDomainPayload(
    database,
    fence,
    head.collection,
    head.syncId,
    sidecar?.acceptedPayload ?? null,
  );
}

function applyCanonicalItem(
  database: SyncDatabase,
  fence: SyncContext,
  item: CanonicalSyncItem,
  preservePending = false,
  discardPendingOnEqual = false,
): void {
  const sidecar = ensureCanonicalSidecar(database, fence, item);
  const identity = { ...fence, ...item };
  const pending = database
    .select()
    .from(syncOutbox)
    .where(outboxWhere(identity))
    .limit(1)
    .get();

  if (
    sidecar.acceptedSyncVersion !== null &&
    item.syncVersion < sidecar.acceptedSyncVersion
  ) {
    return;
  }
  if (item.syncVersion === sidecar.acceptedSyncVersion) {
    setAcceptedState(database, fence, item);
    if (discardPendingOnEqual && pending) {
      database.delete(syncOutbox).where(outboxWhere(identity)).run();
      applyDomainPayload(
        database,
        fence,
        item.collection,
        item.syncId,
        item.payload,
      );
      return;
    }
    applyDomainPayload(
      database,
      fence,
      item.collection,
      item.syncId,
      pending ? pending.desiredPayload : item.payload,
    );
    return;
  }

  if (preservePending) {
    const accepted = setAcceptedState(database, fence, item);
    if (!accepted) return;
    applyDomainPayload(
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
    setAcceptedState(database, fence, item);
    database.delete(syncOutbox).where(outboxWhere(identity)).run();
    applyDomainPayload(
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
    acceptHead(
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

  setAcceptedState(database, fence, item);
  if (pending) {
    database.delete(syncOutbox).where(outboxWhere(identity)).run();
  }
  applyDomainPayload(
    database,
    fence,
    item.collection,
    item.syncId,
    item.payload,
  );
}

function applyCanonicalAbsence(
  database: SyncDatabase,
  fence: SyncContext,
  head: CapturedSyncHead,
): void {
  const sidecar = findSidecar(database, fence, head.collection, head.syncId);
  if (!sidecar) return;

  database
    .update(syncItemState)
    .set({ acceptedSyncVersion: null, acceptedPayload: null })
    .where(itemWhere({ ...fence, ...head }))
    .run();
  database
    .delete(syncOutbox)
    .where(outboxWhere({ ...fence, ...head }))
    .run();
  applyDomainPayload(database, fence, head.collection, head.syncId, null);
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

export async function adoptVisibleRows(
  fence: SyncContext,
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction((tx) => {
    if (!contextIsActive(fence)) return false;

    // Only unbound rows are adoption candidates. Existing identities are
    // governed by their accepted state or durable outbox, so a same-key
    // signed-out edit is not promoted before the login pull.
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
