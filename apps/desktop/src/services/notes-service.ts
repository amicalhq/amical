import { BrowserWindow, ipcMain } from "electron";
import { z } from "zod";
import {
  createNote,
  getNotes,
  getNoteById,
  updateNote,
  deleteNote,
} from "../db/notes";
import { loadNoteBody, saveNoteBody } from "../db/note-body";
import type { NoteBodyChange } from "../notes/types";
import { logger } from "../main/logger";

const noteIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const saveSchema = z.object({
  noteId: noteIdSchema,
  markdown: z.string(),
});

export interface NoteCreateOptions {
  title: string;
  icon?: string | null;
}

export interface NoteUpdateOptions {
  title?: string;
  transcriptionId?: number | null;
  icon?: string | null;
}

class NotesService {
  private static instance: NotesService;

  private constructor() {
    this.setupIPCHandlers();
  }

  private setupIPCHandlers(): void {
    ipcMain.on("notes:loadBody", (event, noteId: unknown) => {
      try {
        event.returnValue = { body: loadNoteBody(noteIdSchema.parse(noteId)) };
      } catch (error) {
        logger.main.error("Failed to load note body", error);
        event.returnValue = { error: "Failed to load note" };
      }
    });
    ipcMain.on("notes:saveBody", (event, input: unknown) => {
      try {
        const { noteId, markdown } = saveSchema.parse(input);
        const result = saveNoteBody(noteId, markdown);
        event.returnValue = result;
        if (result.status === "saved") {
          this.notifyBodyChange({ noteId });
        }
      } catch (error) {
        logger.main.error("Failed to save note body", error);
        event.returnValue = { status: "error", message: "Failed to save note" };
      }
    });
    // An old renderer must not append to the frozen recovery data.
    ipcMain.handle("notes:saveYjsUpdate", () => {
      throw new Error("Reload this window to edit notes");
    });
  }

  private notifyBodyChange(change: NoteBodyChange) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send("notes:bodyChanged", change);
    }
  }

  public static getInstance(): NotesService {
    if (!NotesService.instance) {
      NotesService.instance = new NotesService();
    }
    return NotesService.instance;
  }

  async createNote(options: NoteCreateOptions) {
    // Create the note in the database
    const note = await createNote({
      title: options.title,
      icon: options.icon,
    });

    return note;
  }

  async getNote(id: number) {
    const note = await getNoteById(id);
    return note;
  }

  async listNotes(options?: {
    limit?: number;
    offset?: number;
    sortBy?: "title" | "updatedAt" | "createdAt";
    sortOrder?: "asc" | "desc";
    search?: string;
    transcriptionId?: number | null;
  }) {
    return await getNotes(options);
  }

  async updateNote(id: number, options: NoteUpdateOptions) {
    return await updateNote(id, options);
  }

  async deleteNote(id: number) {
    const note = await getNoteById(id);
    if (!note) return null;

    const deleted = await deleteNote(id);
    if (deleted) this.notifyBodyChange({ noteId: id, deleted: true });
    return deleted;
  }

  // No Yjs writes or compaction: legacy rows are retained migration backups.
  cleanup() {}
}

export default NotesService;
