import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ipcMain, BrowserWindow, type IpcMainEvent } from "electron";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";
import NotesService from "@/services/notes-service";
import { notes, yjsUpdates, syncOutbox } from "@/db/schema";
import { loadNoteBody } from "@/db/note-body";
import {
  adoptVisibleRows,
  applyPullPages,
  applyPushResults,
  capturePushHeads,
  beginUserSyncSession,
  clearSyncState,
  pauseSyncSession,
} from "@/db/sync";
import * as Y from "yjs";
import type { ElectronAPI } from "@/types/electron-api";
import type { NoteBodyChange } from "@/notes/types";
import { NoteSyncProvider } from "@/renderer/main/providers/sync-provider";

let database: TestDatabase;
const service = NotesService.getInstance();
const load = vi
  .mocked(ipcMain.on)
  .mock.calls.find(([channel]) => channel === "notes:loadBody")![1];
const save = vi
  .mocked(ipcMain.on)
  .mock.calls.find(([channel]) => channel === "notes:saveBody")![1];
const oldSave = vi
  .mocked(ipcMain.handle)
  .mock.calls.find(([channel]) => channel === "notes:saveYjsUpdate")![1];
beforeEach(async () => {
  pauseSyncSession();
  database = await createTestDatabase();
  setTestDatabase(database.db);
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
});
afterEach(async () => {
  pauseSyncSession();
  await database.close();
});
const ipcSave: ElectronAPI["notes"]["saveBody"] = (
  noteId,
  markdown,
  expectedRemoteVersion,
  origin,
) => {
  const event = {} as IpcMainEvent;
  save(event, { noteId, markdown, expectedRemoteVersion, origin });
  return event.returnValue;
};

describe("normal note service and IPC", () => {
  it("keeps CRUD, title/icon updates and search attached to the same Markdown body", async () => {
    const note = await service.createNote({ title: "Searchable", icon: "🌻" });
    expect(note.contentFormat).toBe("markdown-v1");
    expect(ipcSave(note.id, "# body\n")).toMatchObject({
      status: "saved",
    });
    await service.updateNote(note.id, { title: "Renamed", icon: "📝" });
    expect(await service.getNote(note.id)).toMatchObject({
      id: note.id,
      title: "Renamed",
      icon: "📝",
      content: "# body\n",
    });
    expect(await service.listNotes({ search: "Renamed" })).toHaveLength(1);
    const event = { returnValue: undefined };
    load(event as IpcMainEvent, note.id);
    expect(event.returnValue).toMatchObject({
      body: { markdown: "# body\n" },
    });
    await service.deleteNote(note.id);
    expect(ipcSave(note.id, "delayed")).toMatchObject({ status: "deleted" });
    expect(await service.getNote(note.id)).toBeNull();
  });
  it("rejects malformed IPC without writing or throwing across sendSync", async () => {
    const note = await service.createNote({ title: "safe" });
    for (const input of [
      { noteId: note.id, markdown: {} },
      { noteId: -1, markdown: "bad" },
      { noteId: "42", markdown: "bad" },
      { noteId: "not-a-uuid", markdown: "bad" },
      { noteId: NaN, markdown: "bad" },
    ]) {
      const event = { returnValue: undefined };
      save(event as IpcMainEvent, input);
      expect(event.returnValue).toMatchObject({ status: "error" });
    }
    expect(loadNoteBody(note.id)).toMatchObject({ markdown: "" });
  });
  it("freezes legacy Yjs updates and rejects old renderer writes", async () => {
    const note = database.db
      .insert(notes)
      .values({ title: "legacy" })
      .returning()
      .get();
    const doc = new Y.Doc();
    doc
      .getText("content")
      .insert(0, JSON.stringify({ root: { type: "root", children: [] } }));
    database.db
      .insert(yjsUpdates)
      .values({
        noteId: note.id,
        updateData: Buffer.from(Y.encodeStateAsUpdate(doc)),
      })
      .run();
    doc.destroy();
    const backup = database.db.select().from(yjsUpdates).all();
    expect(() => oldSave({} as never, note.id, new ArrayBuffer(0))).toThrow(
      "Reload",
    );
    loadNoteBody(note.id);
    service.cleanup();
    expect(database.db.select().from(yjsUpdates).all()).toEqual(backup);
    await service.deleteNote(note.id);
    expect(database.db.select().from(yjsUpdates).all()).toEqual([]);
  });
});

describe("open local editors during automatic adoption", () => {
  let provider: NoteSyncProvider | undefined;
  let refresh: (change: NoteBodyChange) => void;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    provider?.destroy();
    provider = undefined;
    vi.useRealTimers();
  });

  async function openLocalNote() {
    const note = await service.createNote({ title: "Local draft" });
    ipcSave(note.id, "Saved before login");
    provider = new NoteSyncProvider(note.id, {
      loadBody: loadNoteBody,
      saveBody: ipcSave,
      onBodyChange: (handler) => {
        refresh = handler;
        return () => {};
      },
    });
    provider.queue("Typing during login");
    await adoptVisibleRows(await beginUserSyncSession("alice"));
    return note;
  }

  it.each([
    { notifyAdoption: true, switchAccount: false },
    { notifyAdoption: false, switchAccount: false },
    { notifyAdoption: true, switchAccount: true },
    { notifyAdoption: false, switchAccount: true },
  ])(
    "preserves the pending draft across $notifyAdoption adoption notification and account switch $switchAccount",
    async ({ notifyAdoption, switchAccount }) => {
      const note = await openLocalNote();
      if (notifyAdoption) refresh({});
      await clearSyncState();
      if (switchAccount) await beginUserSyncSession("bob");
      // This may be the first refresh the editor receives after login.
      refresh({});
      vi.runAllTimers();

      expect(await service.getNote(note.id)).toBeNull();
      expect(database.db.select().from(notes).all()).toMatchObject([
        { id: note.id, accountId: "alice", content: "Typing during login" },
      ]);
      expect(database.db.select().from(syncOutbox).all()).toMatchObject([
        {
          scopeId: "alice",
          syncId: note.id,
          desiredPayload: { body: { content: "Typing during login" } },
        },
      ]);
    },
  );

  it.each([true, false])(
    "recovers the draft after a remote deletion (adoption notification: %s)",
    async (notifyAdoption) => {
      const note = await openLocalNote();
      if (notifyAdoption) refresh({});
      const fence = {
        accountId: "alice",
        scopeType: "user" as const,
        scopeId: "alice",
      };
      // Sync can finish before a busy editor handles its notifications or timer.
      vi.setSystemTime(Date.now() + 10_000);
      const heads = await capturePushHeads(fence);
      await applyPushResults(fence, heads, [
        { status: "ok", syncId: note.id, syncVersion: 1, applied: true },
      ]);
      await applyPullPages(fence, [
        {
          collection: "note",
          cursor: 2,
          items: [
            {
              collection: "note",
              syncId: note.id,
              syncVersion: 2,
              payload: null,
            },
          ],
        },
      ]);
      await clearSyncState();
      await beginUserSyncSession("bob");
      refresh({});

      const recovered = database.db.select().from(notes).all();
      expect(recovered).toMatchObject([
        { accountId: "alice", content: "Typing during login" },
      ]);
      expect(recovered[0].id).not.toBe(note.id);
      expect(await service.getNote(recovered[0].id)).toBeNull();
      expect(database.db.select().from(syncOutbox).all()).toMatchObject([
        {
          scopeId: "alice",
          syncId: recovered[0].id,
          desiredPayload: { body: { content: "Typing during login" } },
        },
      ]);
    },
  );

  it("does not recreate an adopted note deleted before the pending save", async () => {
    const note = await openLocalNote();
    await service.deleteNote(note.id);
    refresh({});
    expect(database.db.select().from(notes).all()).toEqual([]);
    expect(database.db.select().from(syncOutbox).all()).toMatchObject([
      { scopeId: "alice", syncId: note.id, desiredPayload: null },
    ]);
  });
});
