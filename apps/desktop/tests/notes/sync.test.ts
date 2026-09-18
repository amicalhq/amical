import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";
import { notes, syncItemState, syncOutbox } from "@/db/schema";
import {
  createNote,
  updateNote,
  deleteNote,
  getNotes,
  getNoteById,
} from "@/db/notes";
import { loadNoteBody, saveNoteBody } from "@/db/note-body";
import {
  applyPullPages,
  applyPushResults,
  adoptVisibleRows,
  beginUserSyncSession,
  capturePushHeads as captureEligibleHeads,
  clearSyncState,
  getPullCursors,
  pauseSyncSession,
  resumeUserSyncSession,
} from "@/db/sync";
import { noteSyncPayload } from "@/db/settings-sync/notes";
import { NoteSyncProvider } from "@/renderer/main/providers/sync-provider";
import type { NoteBodyChange } from "@/notes/types";
import type { NoteSyncPayload } from "@amical/types";

let testDb: TestDatabase;
const REMOTE_ID = "11111111-1111-4111-8111-111111111111";
const payload = (content = "# Remote\n"): NoteSyncPayload => ({
  schemaVersion: 1,
  title: "Meeting",
  icon: "🌻",
  body: { format: "markdown", content },
  createdAtMs: 1000000,
  updatedAtMs: 2000000,
});
beforeEach(async () => {
  pauseSyncSession();
  testDb = await createTestDatabase();
  setTestDatabase(testDb.db);
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(async () => {
  pauseSyncSession();
  await testDb.close();
  vi.useRealTimers();
});
// Existing protocol scenarios operate on notes whose upload delay has elapsed.
const capturePushHeads: typeof captureEligibleHeads = (...args) => {
  vi.setSystemTime(Date.now() + 10_000);
  return captureEligibleHeads(...args);
};
const pending = () => testDb.db.select().from(syncOutbox).all();
const all = () => testDb.db.select().from(notes).all();
async function pull(
  syncId: string,
  value: NoteSyncPayload | null,
  syncVersion: number,
) {
  const fence = {
    accountId: "alice",
    scopeType: "user" as const,
    scopeId: "alice",
  };
  await applyPullPages(fence, [
    {
      collection: "note",
      items: [{ collection: "note", syncId, payload: value, syncVersion }],
      cursor: syncVersion,
    },
  ]);
}

describe("personal note sync", () => {
  it("uses the note ID as its local and cloud ID, and queues create/body/metadata/delete atomically", async () => {
    const fence = await beginUserSyncSession("alice");
    const note = await createNote({ title: "Draft" });
    expect(note).not.toHaveProperty("syncId");
    expect(note.id).toMatch(/^nt_[a-z][a-z0-9]{23}$/);
    expect(pending()[0]).toMatchObject({
      collection: "note",
      syncId: note.id,
      desiredPayload: { title: "Draft" },
    });
    saveNoteBody(note.id, "# Exact\r\n\n**body** 👋");
    await updateNote(note.id, { title: "Edited", icon: "📝" });
    const [head] = await capturePushHeads(fence);
    expect(head.headPayload).toMatchObject({
      title: "Edited",
      icon: "📝",
      body: { format: "markdown", content: "# Exact\r\n\n**body** 👋" },
    });
    await applyPushResults(
      fence,
      [head],
      [{ status: "ok", syncId: head.syncId, syncVersion: 1, applied: true }],
    );
    expect(pending()).toEqual([]);
    await deleteNote(note.id);
    expect(await capturePushHeads(fence)).toMatchObject([
      { syncId: note.id, headPayload: null, headExpectedSyncVersion: 1 },
    ]);
    expect(saveNoteBody(note.id, "late save")).toEqual({ status: "deleted" });
  });

  it("rolls back a saved body when the outbox write fails", async () => {
    await beginUserSyncSession("alice");
    const note = await createNote({ title: "Atomic" });
    testDb.db.delete(syncOutbox).run();
    testDb.db.$client.exec(
      "CREATE TRIGGER fail_note_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'outbox failed'); END;",
    );
    expect(() => saveNoteBody(note.id, "must roll back")).toThrow();
    expect(loadNoteBody(note.id)).toMatchObject({ markdown: "" });
  });

  it("adopts local notes automatically and never adopts them into another account", async () => {
    const local = await createNote({ title: "Device note" });
    saveNoteBody(local.id, "# Device draft\n");
    const before = all()[0];
    const fence = await beginUserSyncSession("alice");
    expect(pending()).toEqual([]);
    await adoptVisibleRows(fence);
    expect(all()).toEqual([{ ...before, accountId: "alice" }]);
    expect(pending()).toMatchObject([
      {
        scopeId: "alice",
        syncId: local.id,
        desiredPayload: noteSyncPayload(before),
      },
    ]);
    await clearSyncState();
    expect(await getNotes()).toEqual([]);
    const bob = await beginUserSyncSession("bob");
    await adoptVisibleRows(bob);
    expect(await getNotes()).toEqual([]);
    expect(await getNoteById(local.id)).toBeNull();
    expect(loadNoteBody(local.id).status).toBe("deleted");
    expect(saveNoteBody(local.id, "wrong account")).toEqual({
      status: "deleted",
    });
    expect(await updateNote(local.id, { title: "wrong account" })).toBeNull();
    expect(await deleteNote(local.id)).toBeNull();
    expect(await capturePushHeads(bob)).toEqual([]);
    await resumeUserSyncSession("alice");
    expect((await getNotes())[0].id).toBe(local.id);
    expect(pending()[0].desiredPayload).toMatchObject({ title: "Device note" });
  });

  it("keeps blocked note recovery data while adopting its ownership", async () => {
    const before = testDb.db
      .insert(notes)
      .values({
        title: "Needs recovery",
        contentFormat: "blocked",
        legacyContent: "Original legacy content",
        migrationError: "Unsupported content",
      })
      .returning()
      .get()!;
    const fence = await beginUserSyncSession("alice");

    await adoptVisibleRows(fence);

    expect(all()).toEqual([{ ...before, accountId: "alice" }]);
    expect(pending()).toEqual([]);
  });

  it("does not requeue adopted notes or reset their upload deadline on resume", async () => {
    await createNote({ title: "Adopt once" });
    const fence = await beginUserSyncSession("alice");
    await adoptVisibleRows(fence);
    const before = pending();

    vi.setSystemTime(Date.now() + 5000);
    await adoptVisibleRows(fence);
    const resumed = await resumeUserSyncSession("alice");
    await adoptVisibleRows(resumed);

    expect(pending()).toEqual(before);
    expect(testDb.db.select().from(syncItemState).all()).toHaveLength(1);
  });

  it("rolls back ownership when an adopted note cannot be queued", async () => {
    const local = await createNote({ title: "Atomic adoption" });
    const fence = await beginUserSyncSession("alice");
    testDb.db.$client.exec(
      "CREATE TRIGGER fail_note_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'outbox failed'); END;",
    );

    await expect(adoptVisibleRows(fence)).rejects.toThrow();

    expect(all()[0]).toMatchObject({ id: local.id, accountId: null });
    expect(pending()).toEqual([]);
    expect(testDb.db.select().from(syncItemState).all()).toEqual([]);
  });

  it("does not adopt notes for a stale account session", async () => {
    const local = await createNote({ title: "Wait for current account" });
    const alice = await beginUserSyncSession("alice");
    const bob = await beginUserSyncSession("bob");

    expect(await adoptVisibleRows(alice)).toBe(false);
    expect(all()[0]).toMatchObject({ id: local.id, accountId: null });
    expect(pending()).toEqual([]);

    expect(await adoptVisibleRows(bob)).toBe(true);
    expect(all()[0]).toMatchObject({ id: local.id, accountId: "bob" });
    expect(pending()).toMatchObject([{ scopeId: "bob", syncId: local.id }]);
  });

  it("retains a deleted note's queued tombstone through logout and restart", async () => {
    const fence = await beginUserSyncSession("alice");
    await pull(REMOTE_ID, payload(), 1);
    await deleteNote(all()[0].id);
    const before = await capturePushHeads(fence);
    await clearSyncState();
    await beginUserSyncSession("bob");
    await clearSyncState();
    await resumeUserSyncSession("alice");
    expect(await capturePushHeads(fence)).toEqual(before);
  });

  it("applies remote creation, edits and tombstones with independent cursors", async () => {
    const fence = await beginUserSyncSession("alice");
    await pull(REMOTE_ID, payload(), 2);
    const id = all()[0].id;
    expect(noteSyncPayload(all()[0])).toEqual(payload());
    await pull(REMOTE_ID, payload("updated"), 5);
    expect(all()).toHaveLength(1);
    expect(loadNoteBody(id)).toMatchObject({
      markdown: "updated",
      remoteVersion: 5,
    });
    expect(await getPullCursors(fence, ["note", "snippet"])).toEqual([
      { collection: "note", cursor: 5 },
      { collection: "snippet", cursor: 0 },
    ]);
    await pull(REMOTE_ID, null, 6);
    expect(all()).toEqual([]);
    expect(pending()).toEqual([]);
  });

  it.each(["pull", "push", "delete"])(
    "preserves a divergent draft once on a %s conflict",
    async (mode) => {
      const fence = await beginUserSyncSession("alice");
      await pull(REMOTE_ID, payload(), 1);
      saveNoteBody(all()[0].id, "local draft");
      const heads = await capturePushHeads(fence);
      const canonical = {
        collection: "note" as const,
        syncId: REMOTE_ID,
        syncVersion: 2,
        payload: mode === "delete" ? null : payload("other device"),
      };
      if (mode === "push") {
        await applyPushResults(fence, heads, [
          {
            status: "conflict",
            syncId: REMOTE_ID,
            reason: "version_conflict",
            canonical,
          },
        ]);
      } else await pull(REMOTE_ID, canonical.payload, 2);
      await pull(REMOTE_ID, canonical.payload, 2);
      const copies = all().filter((note) => note.id !== REMOTE_ID);
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({
        title: "Meeting (conflict copy)",
        content: "local draft",
        accountId: "alice",
      });
      expect(pending()).toHaveLength(1);
      expect(pending()[0].syncId).toBe(copies[0].id);
    },
  );

  it("keeps edits made during a request and uses the acknowledged version for the next push", async () => {
    const fence = await beginUserSyncSession("alice");
    const note = await createNote({ title: "Draft" });
    const heads = await capturePushHeads(fence);
    saveNoteBody(note.id, "newer draft");
    await applyPushResults(fence, heads, [
      { status: "ok", syncId: note.id, syncVersion: 1, applied: true },
    ]);
    expect(await captureEligibleHeads(fence)).toEqual([]);
    expect(await capturePushHeads(fence)).toMatchObject([
      {
        headExpectedSyncVersion: 1,
        headPayload: { body: { content: "newer draft" } },
      },
    ]);
    expect(all()).toHaveLength(1);
  });

  it("preserves the remote body if it arrives during a renderer's unsaved debounce", async () => {
    await beginUserSyncSession("alice");
    await pull(REMOTE_ID, payload(), 1);
    const id = all()[0].id;
    await pull(REMOTE_ID, payload("arrived while typing"), 2);
    saveNoteBody(id, "still typing", 1);
    expect(
      all()
        .map((note) => note.content)
        .sort(),
    ).toEqual(["arrived while typing", "still typing"]);
    expect(pending()).toHaveLength(2);
  });

  it("does not create a conflict copy when its own earlier save is acknowledged while typing", async () => {
    const fence = await beginUserSyncSession("alice");
    const note = await createNote({ title: "Typing" });
    const body = loadNoteBody(note.id);
    if (body.status !== "ready") throw new Error("not ready");
    const heads = await capturePushHeads(fence);
    await applyPushResults(fence, heads, [
      { status: "ok", syncId: note.id, syncVersion: 1, applied: true },
    ]);
    saveNoteBody(note.id, "continued typing", body.remoteVersion, body.origin);
    expect(all()).toHaveLength(1);
  });

  it.each([{ title: "Local title" }, { icon: "📝" }])(
    "does not copy metadata after its own body save is acknowledged: %j",
    async (edit) => {
      const fence = await beginUserSyncSession("alice");
      await pull(REMOTE_ID, payload(), 1);
      const original = (await getNoteById(REMOTE_ID))!;
      saveNoteBody(REMOTE_ID, "Local body edit");
      const heads = await capturePushHeads(fence);
      await applyPushResults(fence, heads, [
        { status: "ok", syncId: REMOTE_ID, syncVersion: 2, applied: true },
      ]);
      await updateNote(REMOTE_ID, edit, original.remoteVersion, original);
      expect(all()).toHaveLength(1);
      expect(all()[0]).toMatchObject({ ...edit, content: "Local body edit" });
      expect(pending()).toHaveLength(1);
    },
  );

  it("keeps a stale editor base valid across consecutive local saves and acknowledgments", async () => {
    const fence = await beginUserSyncSession("alice");
    await pull(REMOTE_ID, payload(), 1);
    const original = (await getNoteById(REMOTE_ID))!;
    await updateNote(
      REMOTE_ID,
      { title: "B" },
      original.remoteVersion,
      original,
    );
    const heads = await capturePushHeads(fence);
    await applyPushResults(fence, heads, [
      { status: "ok", syncId: REMOTE_ID, syncVersion: 2, applied: true },
    ]);
    await updateNote(
      REMOTE_ID,
      { title: "C" },
      original.remoteVersion,
      original,
    );
    expect(all()).toHaveLength(1);
    expect(await getNoteById(REMOTE_ID)).toMatchObject({
      title: "C",
      remoteVersion: 1,
    });
    expect((await capturePushHeads(fence))[0].headExpectedSyncVersion).toBe(2);
  });

  it("does not recover an old draft after a local deletion is acknowledged", async () => {
    const fence = await beginUserSyncSession("alice");
    await pull(REMOTE_ID, payload(), 1);
    const body = loadNoteBody(REMOTE_ID);
    if (body.status !== "ready") throw new Error("not ready");
    await pull(REMOTE_ID, payload("Remote update"), 2);
    await deleteNote(REMOTE_ID);
    const heads = await capturePushHeads(fence);
    await applyPushResults(fence, heads, [
      { status: "ok", syncId: REMOTE_ID, syncVersion: 3, applied: true },
    ]);
    expect(
      saveNoteBody(REMOTE_ID, "stale draft", body.remoteVersion, body.origin),
    ).toEqual({ status: "deleted" });
    expect(all()).toEqual([]);
  });

  it("preserves remote metadata when a delayed title edit uses an older remote version", async () => {
    await beginUserSyncSession("alice");
    await pull(REMOTE_ID, payload(), 1);
    const id = all()[0].id;
    await pull(
      REMOTE_ID,
      { ...payload(), title: "Remote title", icon: "👋" },
      2,
    );
    await updateNote(id, { title: "Local title" }, 1, { title: "Meeting" });
    expect(
      all()
        .map((note) => note.title)
        .sort(),
    ).toEqual(["Local title", "Remote title (conflict copy)"]);
    expect(all()[0].icon).toBe("👋");
  });

  it("keeps oversized and invalid notes locally without blocking valid notes, and retries after editing", async () => {
    const fence = await beginUserSyncSession("alice");
    const huge = await createNote({ title: "Large" });
    saveNoteBody(huge.id, "👋".repeat(40000));
    const valid = await createNote({ title: "Valid" });
    const heads = await capturePushHeads(fence);
    expect(heads.map((head) => head.syncId)).toEqual([valid.id]);
    expect((await getNoteById(huge.id))?.content).toHaveLength(80000);
    expect((await getNoteById(huge.id))?.syncError).toBeTruthy();
    await pull(huge.id, payload("remote"), 1);
    expect(all().some((note) => note.content === "👋".repeat(40000))).toBe(
      true,
    );
    const copy = all().find((note) => note.title.includes("conflict copy"))!;
    saveNoteBody(copy.id, "smaller draft");
    expect(
      (await capturePushHeads(fence)).some((head) => head.syncId === copy.id),
    ).toBe(true);
    expect((await getNoteById(copy.id))?.syncError).toBeNull();
  });

  it("preserves notes rejected by the server and honors smaller advertised size limits", async () => {
    const fence = await beginUserSyncSession("alice");
    const note = await createNote({ title: "Draft" });
    const heads = await capturePushHeads(fence);
    await applyPushResults(fence, heads, [
      {
        status: "error",
        reason: "invalid_payload",
        syncId: note.id,
        message: "invalid",
      },
    ]);
    expect(await capturePushHeads(fence)).toEqual([]);
    expect(all()[0].title).toBe("Draft");
    expect(all()[0].syncError).toBeTruthy();
    saveNoteBody(note.id, "changed");
    expect(
      await capturePushHeads(fence, undefined, ["note"], {
        maxPayloadBytes: 10,
        maxPushBytes: 1000,
      }),
    ).toEqual([]);
    expect(all()[0].content).toBe("changed");
  });

  it("finishes an already-open editor save in its original account after logout", async () => {
    await beginUserSyncSession("alice");
    const note = await createNote({ title: "Open draft" });
    const body = loadNoteBody(note.id);
    if (body.status !== "ready") throw new Error("not ready");
    await clearSyncState();
    await beginUserSyncSession("bob");
    saveNoteBody(note.id, "pending at logout", body.remoteVersion, body.origin);
    expect(await getNotes()).toEqual([]);
    expect(pending()).toMatchObject([
      {
        scopeId: "alice",
        desiredPayload: { body: { content: "pending at logout" } },
      },
    ]);
    await resumeUserSyncSession("alice");
    expect((await getNoteById(note.id))?.content).toBe("pending at logout");
  });

  it("recovers an unsaved editor draft after a remote deletion without restoring the deleted identity", async () => {
    await beginUserSyncSession("alice");
    await pull(REMOTE_ID, payload(), 1);
    const note = all()[0];
    const body = loadNoteBody(note.id);
    if (body.status !== "ready") throw new Error("not ready");
    await pull(REMOTE_ID, null, 2);
    expect(
      saveNoteBody(
        note.id,
        "typing during delete",
        body.remoteVersion,
        body.origin,
      ),
    ).toEqual({ status: "saved", recovered: true });
    expect(all()).toHaveLength(1);
    expect(all()[0].id).not.toBe(REMOTE_ID);
    expect(all()[0].content).toBe("typing during delete");
  });

  it("recovers a pending editor through the real save API when sync deletes its note", async () => {
    await beginUserSyncSession("alice");
    await pull(REMOTE_ID, payload(), 1);
    const id = all()[0].id;
    let refresh: ((change: NoteBodyChange) => void) | undefined;
    const provider = new NoteSyncProvider(id, {
      loadBody: loadNoteBody,
      saveBody: saveNoteBody,
      onBodyChange: (handler) => {
        refresh = handler;
        return () => {};
      },
    });
    provider.queue("unsaved typing");
    await pull(REMOTE_ID, null, 2);
    refresh?.({});
    provider.destroy();
    expect(all()).toHaveLength(1);
    expect(all()[0].content).toBe("unsaved typing");
    expect(all()[0].id).not.toBe(REMOTE_ID);
  });

  it("rolls back all pulled notes and the cursor if any item cannot be applied", async () => {
    const fence = await beginUserSyncSession("alice");
    await expect(
      applyPullPages(fence, [
        {
          collection: "note",
          cursor: 2,
          items: [
            {
              collection: "note",
              syncId: REMOTE_ID,
              syncVersion: 1,
              payload: payload(),
            },
            {
              collection: "note",
              syncId: "broken",
              syncVersion: 2,
              payload: {
                ...payload(),
                title: null,
              } as unknown as NoteSyncPayload,
            },
          ],
        },
      ]),
    ).rejects.toThrow();
    expect(all()).toEqual([]);
    expect(await getPullCursors(fence, ["note"])).toEqual([
      { collection: "note", cursor: 0 },
    ]);
  });
});
