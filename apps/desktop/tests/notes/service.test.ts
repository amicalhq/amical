import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ipcMain, BrowserWindow, type IpcMainEvent } from "electron";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";
import NotesService from "@/services/notes-service";
import { notes, yjsUpdates } from "@/db/schema";
import { loadNoteBody } from "@/db/note-body";
import * as Y from "yjs";

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
  database = await createTestDatabase();
  setTestDatabase(database.db);
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
});
afterEach(async () => database.close());
function ipcSave(noteId: string, markdown: string) {
  const event = { returnValue: undefined };
  save(event as IpcMainEvent, { noteId, markdown });
  return event.returnValue;
}

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
