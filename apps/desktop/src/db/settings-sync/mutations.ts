import { sql } from "drizzle-orm";
import {
  syncClientState,
  syncItemState,
  syncOutbox,
  type SyncCollection,
  type SyncItemState,
  type SyncPayload,
  type SyncScopeType,
} from "../schema";
import { notifyLocalSyncMutation } from "./active-state";
import { itemWhere, outboxWhere } from "./query";
import type { SyncDatabase } from "./types";

const NOTE_UPLOAD_DELAY_MS = 10_000;

function allocateOutboxSequence(database: SyncDatabase): number {
  const client = database
    .insert(syncClientState)
    .values({ id: 1, lastOutboxSequence: 1 })
    .onConflictDoUpdate({
      target: syncClientState.id,
      set: {
        lastOutboxSequence: sql`${syncClientState.lastOutboxSequence} + 1`,
      },
    })
    .returning({ sequence: syncClientState.lastOutboxSequence })
    .get()!;
  return client.sequence;
}

export function enqueueLocalMutation(
  database: SyncDatabase,
  identity: { scopeType: SyncScopeType; scopeId: string },
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
  options: { notify?: boolean } = {},
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

  if (pending?.blockedReason) {
    database
      .update(syncOutbox)
      .set({ blockedReason: null })
      .where(outboxWhere(identityWithItem))
      .run();
  }

  let desiredBaseSyncVersion = sidecar.acceptedSyncVersion;
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

  const desiredNotBefore =
    collection === "note" ? Date.now() + NOTE_UPLOAD_DELAY_MS : 0;
  database
    .insert(syncOutbox)
    .values({
      ...identityWithItem,
      desiredNotBefore,
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
        desiredNotBefore,
        desiredPayload: payload,
        desiredBaseSyncVersion,
        desiredSequence,
        desiredParentHeadSequence,
        desiredParentSyncVersion,
      },
    })
    .run();
  if (options.notify !== false) notifyLocalSyncMutation(collection);
}
