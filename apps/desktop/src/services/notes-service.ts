import { SettingsSyncIdSchema } from "@amical/types";
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

const noteIdSchema = SettingsSyncIdSchema;
const saveSchema = z.object({
  noteId: noteIdSchema,
  markdown: z.string(),
  expectedRemoteVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .optional(),
  origin: z
    .object({
      accountId: z.string().min(1),
      title: z.string(),
      markdown: z.string(),
      icon: z.string().nullable(),
      createdAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .optional(),
});

export interface NoteCreateOptions {
  title: string;
  icon?: string | null;
}

export interface NoteUpdateOptions {
  expectedRemoteVersion?: number | null;
  originalTitle?: string;
  originalIcon?: string | null;
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
        const { noteId, markdown, expectedRemoteVersion, origin } =
          saveSchema.parse(input);
        const result = saveNoteBody(
          noteId,
          markdown,
          expectedRemoteVersion,
          origin,
        );
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

    this.notifyBodyChange({ noteId: note.id });
    return note;
  }

  async getNote(id: string) {
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

  async updateNote(id: string, options: NoteUpdateOptions) {
    const { expectedRemoteVersion, originalTitle, originalIcon, ...updates } =
      options;
    const note = await updateNote(id, updates, expectedRemoteVersion, {
      title: originalTitle,
      icon: originalIcon,
    });
    if (note) this.notifyBodyChange({ noteId: id });
    return note;
  }

  async deleteNote(id: string) {
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
