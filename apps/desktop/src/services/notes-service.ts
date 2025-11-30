import * as cron from "node-cron";
import {
  createNote,
  getNotes,
  getNoteById,
  updateNote,
  deleteNote,
  saveYjsUpdate as saveYjsUpdateToDB,
  loadYjsUpdates as loadYjsUpdatesFromDB,
  getUniqueNoteIds,
  getYjsUpdatesByNoteId,
  replaceYjsUpdates,
} from "../db/notes";
import * as Y from "yjs";
import { ipcMain } from "electron";
import { logger } from "../main/logger";

export interface NoteCreateOptions {
  title: string;
  initialContent?: string;
  icon?: string | null;
}

export interface NoteUpdateOptions {
  title?: string;
  transcriptionId?: number | null;
  icon?: string | null;
}

class NotesService {
  private static instance: NotesService;
  private compactionTask: cron.ScheduledTask | null = null;

  private constructor() {
    this.setupIPCHandlers();
    this.setupCompactionCron();
  }

  private setupIPCHandlers(): void {
    ipcMain.handle(
      "notes:saveYjsUpdate",
      async (_event, noteId: number, update: ArrayBuffer) => {
        try {
          const updateArray = new Uint8Array(update);
          await this.saveYjsUpdate(noteId, updateArray);
          logger.main.debug("Saved yjs update", {
            noteId,
            updateSize: updateArray.length,
          });
        } catch (error) {
          logger.main.error("Failed to save yjs update", error);
          throw error;
        }
      },
    );

    ipcMain.handle("notes:loadYjsUpdates", async (_event, noteId: number) => {
      try {
        const updates = await this.loadYjsUpdates(noteId);
        logger.main.debug("Loaded yjs updates", {
          noteId,
          count: updates.length,
        });
        return updates.map((u) => u.buffer);
      } catch (error) {
        logger.main.error("Failed to load yjs updates", error);
        throw error;
      }
    });
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

    // Initialize yjs document with initial content if provided
    if (options.initialContent) {
      const ydoc = new Y.Doc();
      const text = ydoc.getText("content");
      text.insert(0, options.initialContent);

      // Save initial content as a YJS update
      const initialUpdate = Y.encodeStateAsUpdate(ydoc);
      await saveYjsUpdateToDB(note.id, initialUpdate);
    }

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

    return await deleteNote(id);
  }

  // Save yjs update to database
  async saveYjsUpdate(noteId: number, update: Uint8Array) {
    await saveYjsUpdateToDB(noteId, update);
  }

  // Load all yjs updates for a note
  async loadYjsUpdates(noteId: number): Promise<Uint8Array[]> {
    return await loadYjsUpdatesFromDB(noteId);
  }

  // Compact all note documents
  async compactAllNotes(): Promise<void> {
    const startTime = Date.now();
    logger.main.info("Starting yjs compaction for all notes");

    try {
      // Get all unique note IDs that have updates
      const noteIds = await getUniqueNoteIds();
      logger.main.info(`Found ${noteIds.length} notes to compact`);

      let totalUpdatesBefore = 0;
      let totalUpdatesAfter = 0;

      for (const noteId of noteIds) {
        const compactResult = await this.compactNote(noteId);
        totalUpdatesBefore += compactResult.updatesBefore;
        totalUpdatesAfter += compactResult.updatesAfter;
      }

      const duration = Date.now() - startTime;
      logger.main.info(`Compaction completed in ${duration}ms`, {
        notesCompacted: noteIds.length,
        totalUpdatesBefore,
        totalUpdatesAfter,
        updatesReduced: totalUpdatesBefore - totalUpdatesAfter,
      });
    } catch (error) {
      logger.main.error("Failed to compact notes:", error);
    }
  }

  // Compact a specific note
  async compactNote(
    noteId: number,
  ): Promise<{ updatesBefore: number; updatesAfter: number }> {
    // Get all updates for this note
    const updates = await getYjsUpdatesByNoteId(noteId);
    const updatesBefore = updates.length;

    if (updatesBefore <= 1) {
      // No need to compact if there's only one update or none
      return { updatesBefore, updatesAfter: updatesBefore };
    }

    // Create a new Y.Doc and apply all updates
    const ydoc = new Y.Doc();
    for (const update of updates) {
      const updateArray = new Uint8Array(update.updateData as Buffer);
      Y.applyUpdate(ydoc, updateArray);
    }

    // Encode the current state as a single update
    const stateUpdate = Y.encodeStateAsUpdate(ydoc);

    // Replace all updates with the compacted one
    await replaceYjsUpdates(noteId, stateUpdate);

    logger.main.debug(
      `Compacted note ${noteId}: ${updatesBefore} updates -> 1 update`,
    );

    return { updatesBefore, updatesAfter: 1 };
  }

  // Set up cron job for scheduled compaction
  private setupCompactionCron() {
    // Schedule for daily at 2 AM in production, every 5 minutes in development
    const schedule =
      process.env.NODE_ENV === "development" ? "*/5 * * * *" : "0 2 * * *";

    this.compactionTask = cron.schedule(schedule, async () => {
      logger.main.info(
        `Running scheduled yjs compaction (schedule: ${schedule})`,
      );
      await this.compactAllNotes();
    });

    logger.main.info(`Yjs compaction cron job scheduled: ${schedule}`);
  }

  // Clean up resources
  cleanup() {
    // Stop the cron job
    if (this.compactionTask) {
      this.compactionTask.stop();
      this.compactionTask = null;
    }
  }
}

export default NotesService;
