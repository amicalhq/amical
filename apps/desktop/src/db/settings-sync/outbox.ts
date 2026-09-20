import { NOTE_SYNC_LIMITS } from "@amical/types";
import { and, eq, getTableColumns, gt, inArray, isNull } from "drizzle-orm";

import { db } from "..";
import { getUserDataAccountId } from "../user-data";
import {
  notes,
  snippets,
  syncItemState,
  syncOutbox,
  vocabulary,
  type SyncCollection,
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
import { snippetSyncPayload, vocabularySyncPayload } from "./domain";
import { enqueueLocalMutation } from "./mutations";
import { blockNoteMutation, notePayloadError, noteSyncPayload } from "./notes";
import { itemWhere, outboxWhere } from "./query";
import {
  PERSONAL_SCOPE_ID,
  type CapturedSyncHead,
  type LocalSyncMutation,
  type PushSyncResult,
  type SyncContext,
  type SyncDatabase,
} from "./types";

export function recordLocalSyncMutation(
  database: SyncDatabase,
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
): void {
  const accountId =
    activeUserIdentity()?.scopeId ?? getUserDataAccountId(database);
  if (!accountId) return;
  const identity = { scopeType: "user" as const, scopeId: accountId };
  enqueueLocalMutation(database, identity, collection, syncId, payload);
}

export function recordOrganizationSyncMutation(
  database: SyncDatabase,
  collection: SyncCollection,
  syncId: string,
  payload: SyncPayload | null,
): void {
  if (collection === "note") throw new Error("Notes only support user scope");
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
): void {
  if (mutations.length === 0) return;

  for (const mutation of mutations) {
    enqueueLocalMutation(
      database,
      identity,
      mutation.collection,
      mutation.syncId,
      mutation.payload,
      { notify: false },
    );
  }

  notifyLocalSyncMutation();
}

export function recordLocalSyncMutations(
  database: SyncDatabase,
  mutations: LocalSyncMutation[],
): void {
  const accountId =
    activeUserIdentity()?.scopeId ?? getUserDataAccountId(database);
  if (!accountId) return;
  const identity = { scopeType: "user" as const, scopeId: accountId };
  enqueueLocalSyncMutationsBulk(database, identity, mutations);
}

export async function adoptVisibleRows(
  fence: SyncContext,
  database: typeof db = db,
): Promise<boolean> {
  return database.transaction((tx) => {
    if (!contextIsActive(fence)) return false;
    if (fence.scopeType !== "user") return false;

    tx.update(notes)
      .set({ accountId: fence.scopeId })
      .where(isNull(notes.accountId))
      .run();

    const vocabularyRows = tx
      .select(getTableColumns(vocabulary))
      .from(vocabulary)
      .leftJoin(
        syncItemState,
        and(
          eq(syncItemState.scopeType, "user"),
          eq(syncItemState.scopeId, fence.scopeId),
          eq(syncItemState.collection, "vocabulary"),
          eq(syncItemState.syncId, vocabulary.id),
        ),
      )
      .where(
        and(
          eq(vocabulary.scopeType, "user"),
          eq(vocabulary.scopeId, PERSONAL_SCOPE_ID),
          isNull(syncItemState.syncId),
        ),
      )
      .all();
    const snippetRows = tx
      .select(getTableColumns(snippets))
      .from(snippets)
      .leftJoin(
        syncItemState,
        and(
          eq(syncItemState.scopeType, "user"),
          eq(syncItemState.scopeId, fence.scopeId),
          eq(syncItemState.collection, "snippet"),
          eq(syncItemState.syncId, snippets.id),
        ),
      )
      .where(
        and(
          eq(snippets.scopeType, "user"),
          eq(snippets.scopeId, PERSONAL_SCOPE_ID),
          isNull(syncItemState.syncId),
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
        ...tx
          .select(getTableColumns(notes))
          .from(notes)
          .leftJoin(
            syncItemState,
            and(
              eq(syncItemState.scopeType, "user"),
              eq(syncItemState.scopeId, fence.scopeId),
              eq(syncItemState.collection, "note"),
              eq(syncItemState.syncId, notes.id),
            ),
          )
          .where(
            and(
              eq(notes.accountId, fence.accountId),
              eq(notes.contentFormat, "markdown-v1"),
              isNull(syncItemState.syncId),
            ),
          )
          .all()
          .map((row) => ({
            collection: "note" as const,
            syncId: row.id,
            payload: noteSyncPayload(row),
          })),
      ],
    );

    return true;
  });
}

export async function resetNoteUploadDelays(): Promise<boolean> {
  const result = db
    .update(syncOutbox)
    .set({ desiredNotBefore: 0 })
    .where(
      and(
        eq(syncOutbox.collection, "note"),
        gt(syncOutbox.desiredNotBefore, 0),
        isNull(syncOutbox.blockedReason),
      ),
    )
    .run();
  return result.changes > 0;
}

// During this run, unrelated sync wakes must still respect note edit deadlines.
export function getNextNotePushAt(): number | null {
  const identity = activeUserIdentity();
  if (!identity) return null;
  return (
    db
      .select({ deadline: syncOutbox.desiredNotBefore })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.scopeType, "user"),
          eq(syncOutbox.scopeId, identity.scopeId),
          eq(syncOutbox.collection, "note"),
          eq(syncOutbox.headPresent, false),
          isNull(syncOutbox.blockedReason),
          gt(syncOutbox.desiredNotBefore, Date.now()),
        ),
      )
      .orderBy(syncOutbox.desiredNotBefore)
      .limit(1)
      .get()?.deadline ?? null
  );
}

export async function capturePushHeads(
  fence: SyncContext,
  database: typeof db = db,
  collections: readonly SyncCollection[] = ["vocabulary", "snippet", "note"],
  noteLimits = {
    maxPayloadBytes: NOTE_SYNC_LIMITS.maxPayloadBytes as number,
    maxPushBytes: Number.MAX_SAFE_INTEGER,
  },
): Promise<CapturedSyncHead[]> {
  if (collections.length === 0) return [];
  return database.transaction((tx) => {
    if (!contextIsActive(fence)) return [];

    let pendingRows = tx
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.scopeType, fence.scopeType),
          eq(syncOutbox.scopeId, fence.scopeId),
          inArray(syncOutbox.collection, [...collections]),
          isNull(syncOutbox.blockedReason),
        ),
      )
      .all();

    pendingRows = pendingRows.filter((pending) => {
      if (pending.collection !== "note") return true;
      if (!pending.headPresent && pending.desiredNotBefore > Date.now())
        return false;
      if (fence.scopeType !== "user")
        throw new Error("Notes only support user scope");
      const payload = pending.headPresent
        ? pending.headPayload
        : pending.desiredPayload;
      const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
      const mutationBytes = Buffer.byteLength(
        JSON.stringify({
          mutations: [
            {
              collection: "note",
              scopeType: "user",
              scopeId: fence.scopeId,
              syncId: pending.syncId,
              expectedSyncVersion: pending.headPresent
                ? pending.headExpectedSyncVersion
                : pending.desiredParentHeadSequence === null
                  ? pending.desiredBaseSyncVersion
                  : pending.desiredParentSyncVersion,
              payload,
            },
          ],
        }),
        "utf8",
      );
      const error = payload === null ? null : notePayloadError(payload);
      const reason =
        error ??
        ((payload !== null && payloadBytes > noteLimits.maxPayloadBytes) ||
        mutationBytes > noteLimits.maxPushBytes
          ? "Note exceeds the server sync size limit. Your changes are saved on this device."
          : null);
      if (!reason) return true;
      blockNoteMutation(tx, fence, pending.syncId, reason);
      return false;
    });

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
          isNull(syncOutbox.blockedReason),
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
        if (head.collection === "note")
          blockNoteMutation(
            tx,
            fence,
            head.syncId,
            "Cloud sync rejected this note. Your changes are saved on this device.",
          );
        else permanentlyFailHead(tx, fence, head);
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
  collections: readonly SyncCollection[] = ["vocabulary", "snippet", "note"],
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
        isNull(syncOutbox.blockedReason),
      ),
    )
    .limit(1)
    .get();
  return Boolean(pending);
}
