import { and, eq, isNull, or } from "drizzle-orm";
import { NoteSyncPayloadSchema } from "@amical/types";
import {
  notes,
  syncOutbox,
  syncClientState,
  syncItemState,
  type Note,
  type NoteSyncPayload,
} from "../schema";
import { activeUserIdentity } from "./active-state";
import { enqueueLocalMutation } from "./mutations";
import { itemWhere, outboxWhere } from "./query";
import type { SyncContext, SyncDatabase } from "./types";

export function visibleNotesWhere() {
  const identity = activeUserIdentity();
  return identity
    ? or(isNull(notes.accountId), eq(notes.accountId, identity.scopeId))!
    : isNull(notes.accountId);
}

export function loadVisibleNoteIds(
  database: SyncDatabase,
  identity: Pick<SyncContext, "scopeType" | "scopeId">,
): Set<string> {
  return new Set(
    identity.scopeType === "user"
      ? database
          .select({ id: notes.id })
          .from(notes)
          .where(eq(notes.accountId, identity.scopeId))
          .all()
          .map((row) => row.id)
      : [],
  );
}

export function findNoteSyncState(database: SyncDatabase, note: Note) {
  if (!note.accountId) return null;
  return (
    database
      .select({ remoteVersion: syncItemState.noteRemoteVersion })
      .from(syncItemState)
      .where(
        itemWhere({
          scopeType: "user",
          scopeId: note.accountId,
          collection: "note",
          syncId: note.id,
        }),
      )
      .get() ?? null
  );
}

export function noteSyncPayload(note: Note): NoteSyncPayload {
  return {
    schemaVersion: 1,
    title: note.title,
    icon: note.icon,
    body: { format: "markdown", content: note.content ?? "" },
    createdAtMs: note.createdAt.getTime(),
    updatedAtMs: note.updatedAt.getTime(),
  };
}

export function notePayloadError(payload: unknown): string | null {
  const result = NoteSyncPayloadSchema.safeParse(payload);
  return result.success
    ? null
    : result.error.issues.map((issue) => issue.message).join("; ");
}

export function recordNoteMutation(
  database: SyncDatabase,
  note: Note,
  deleted = false,
) {
  if (!note.accountId) return;
  if (note.contentFormat !== "markdown-v1" && !deleted) return;
  database
    .insert(syncClientState)
    .values({ id: 1, lastOutboxSequence: 0 })
    .onConflictDoNothing()
    .run();
  const payload = deleted ? null : noteSyncPayload(note);
  enqueueLocalMutation(
    database,
    { scopeType: "user", scopeId: note.accountId },
    "note",
    note.id,
    payload,
  );
  // An explicit local deletion must never recover an older editor draft.
  if (deleted)
    database
      .update(syncItemState)
      .set({ noteRemoteVersion: null })
      .where(
        itemWhere({
          scopeType: "user",
          scopeId: note.accountId,
          collection: "note",
          syncId: note.id,
        }),
      )
      .run();
  if (!deleted)
    database
      .update(notes)
      .set({ syncError: notePayloadError(payload) })
      .where(eq(notes.id, note.id))
      .run();
}

export function noteIdentity(
  fence: Pick<SyncContext, "scopeType" | "scopeId">,
  syncId: string,
) {
  if (fence.scopeType !== "user")
    throw new Error("Notes only support user scope");
  return and(eq(notes.accountId, fence.scopeId), eq(notes.id, syncId));
}

export function applyNotePayload(
  database: SyncDatabase,
  fence: SyncContext,
  syncId: string,
  payload: NoteSyncPayload | null,
) {
  const where = noteIdentity(fence, syncId);
  if (payload === null) {
    database.delete(notes).where(where).run();
    return;
  }
  const values = {
    title: payload.title,
    icon: payload.icon,
    content: payload.body.content,
    contentFormat: "markdown-v1",
    createdAt: new Date(payload.createdAtMs),
    updatedAt: new Date(payload.updatedAtMs),
    syncError:
      database
        .select({ blockedReason: syncOutbox.blockedReason })
        .from(syncOutbox)
        .where(outboxWhere({ ...fence, collection: "note", syncId }))
        .get()?.blockedReason ?? notePayloadError(payload),
  };
  const updated = database
    .update(notes)
    .set(values)
    .where(where)
    .returning({ id: notes.id })
    .get();
  if (!updated)
    database
      .insert(notes)
      .values({ ...values, accountId: fence.scopeId, id: syncId })
      .run();
}

// Called in the canonical transaction before a divergent draft is replaced.
// Replays cannot make another copy after that transaction removes the pending edit.
export function preserveNoteConflict(
  database: SyncDatabase,
  fence: SyncContext,
  payload: NoteSyncPayload,
) {
  if (fence.scopeType !== "user")
    throw new Error("Notes only support user scope");
  const copy = database
    .insert(notes)
    .values({
      accountId: fence.scopeId,
      title: `${payload.title} (conflict copy)`,
      icon: payload.icon,
      content: payload.body.content,
      contentFormat: "markdown-v1",
      createdAt: new Date(payload.createdAtMs),
      updatedAt: new Date(payload.updatedAtMs),
    })
    .returning()
    .get();
  recordNoteMutation(database, copy);
  return copy;
}

export function blockNoteMutation(
  database: SyncDatabase,
  fence: SyncContext,
  syncId: string,
  reason: string,
) {
  const identity = { ...fence, collection: "note" as const, syncId };
  const pending = database
    .select()
    .from(syncOutbox)
    .where(outboxWhere(identity))
    .get();
  if (!pending) return;
  const hasNewerEdit =
    pending.headPresent && pending.desiredSequence !== pending.headSequence;
  database
    .update(syncOutbox)
    .set({
      blockedReason: hasNewerEdit ? null : reason,
      headPresent: false,
      headPayload: null,
      headSequence: null,
      headExpectedSyncVersion: null,
      desiredParentHeadSequence: null,
      desiredParentSyncVersion: null,
    })
    .where(outboxWhere(identity))
    .run();
  if (!hasNewerEdit)
    database
      .update(notes)
      .set({ syncError: reason })
      .where(noteIdentity(fence, syncId))
      .run();
}
