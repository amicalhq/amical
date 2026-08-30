import { and, eq } from "drizzle-orm";

import {
  snippets,
  syncItemState,
  syncOutbox,
  vocabulary,
  type SnippetSyncPayload,
  type SyncCollection,
  type SyncItemState,
  type SyncPayload,
  type VocabularySyncPayload,
} from "../schema";
import { itemWhere, outboxWhere, payloadsEqual } from "./query";
import {
  PERSONAL_SCOPE_ID,
  type CanonicalSyncItem,
  type CapturedSyncHead,
  type SyncContext,
  type SyncDatabase,
} from "./types";

export function findSidecar(
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

export function discardPendingScopeMutations(
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

export function setAcceptedState(
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

export function acceptHead(
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

export function permanentlyFailHead(
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

export function applyCanonicalItem(
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

export function applyCanonicalAbsence(
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
