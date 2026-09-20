import { and, eq } from "drizzle-orm";

import { db } from "..";
import {
  snippets,
  syncCollectionState,
  syncItemState,
  syncOutbox,
  syncScopeState,
  vocabulary,
} from "../schema";
import {
  activateScope,
  activeScopeKey,
  activeUserIdentity,
  contextIsActive,
  deactivateActiveOrganizationScopes,
  isActiveAccount,
  isActiveScope,
  pauseActiveSyncSession,
  removeActiveScope,
  replaceActiveScopes,
} from "./active-state";
import { discardPendingScopeMutations } from "./canonical";
import {
  SYNC_COLLECTIONS,
  type AdvertisedSyncScope,
  type ReconciledSyncScopes,
  type SyncContext,
  type SyncDatabase,
} from "./types";

export async function beginUserSyncSession(
  accountId: string,
  database: typeof db = db,
): Promise<SyncContext> {
  pauseActiveSyncSession();
  const scope = { scopeType: "user" as const, scopeId: accountId };
  const access = { canWrite: true, role: null };
  const context = database.transaction((tx) => {
    tx.insert(syncScopeState)
      .values({ ...scope, ...access })
      .onConflictDoUpdate({
        target: [syncScopeState.scopeType, syncScopeState.scopeId],
        set: access,
      })
      .run();

    for (const collection of SYNC_COLLECTIONS) {
      tx.insert(syncCollectionState)
        .values({ ...scope, collection, cursor: 0 })
        .onConflictDoNothing()
        .run();
    }

    return { accountId, ...scope };
  });
  activateScope(accountId, scope.scopeType, scope.scopeId, access);
  return context;
}

export async function reconcileSyncScopes(
  accountId: string,
  scopes: readonly AdvertisedSyncScope[],
  database: typeof db = db,
): Promise<ReconciledSyncScopes | null> {
  if (!isActiveAccount(accountId)) return null;

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
        if (scope.scopeType === "org" && collection === "note") continue;
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

  if (!replaceActiveScopes(accountId, scopes)) return null;
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
  pauseActiveSyncSession();
}

export function deactivateOrganizationSyncScopes(): boolean {
  return deactivateActiveOrganizationScopes();
}

export async function getActiveOrganizationAccess(
  database: SyncDatabase = db,
): Promise<{
  scopeId: string;
  role: string | null;
  canWrite: boolean;
} | null> {
  if (!activeUserIdentity()) return null;
  const identity = database
    .select()
    .from(syncScopeState)
    .where(eq(syncScopeState.scopeType, "org"))
    .limit(1)
    .get();
  if (!identity || !isActiveScope("org", identity.scopeId)) return null;
  return {
    scopeId: identity.scopeId,
    role: identity.role,
    canWrite: identity.canWrite,
  };
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
  removeActiveScope("org", fence.scopeId);
  return true;
}
