import { app } from "electron";
import * as path from "path";
import { eq, asc, sql } from "drizzle-orm";
import * as cron from "node-cron";
import {
  createNote,
  getNotes,
  getNoteById,
  getNoteByDocName,
  updateNote,
  touchNote,
  deleteNote,
  getNotesByTranscriptionId,
  setNoteMetadata,
  getNoteMetadata,
  generateDocName,
} from "../db/notes";
import { db } from "../db/config";
import { yjsUpdates } from "../db/schema";
import { LibSQLPersistence } from "@amical/y-libsql";
import * as Y from "yjs";
import { logger } from "../main/logger";

export interface NoteCreateOptions {
  title: string;
  transcriptionId?: number;
  initialContent?: string;
}

export interface NoteUpdateOptions {
  title?: string;
  transcriptionId?: number | null;
}

class NotesService {
  private static instance: NotesService;
  private dbPath: string;
  private persistenceInstances: Map<string, LibSQLPersistence> = new Map();
  private compactionTask: cron.ScheduledTask | null = null;

  private constructor() {
    // Use the same database as the main app
    this.dbPath = `file:${path.join(app.getPath("userData"), "amical.db")}`;

    // Set up cron job for daily compaction
    this.setupCompactionCron();
  }

  public static getInstance(): NotesService {
    if (!NotesService.instance) {
      NotesService.instance = new NotesService();
    }
    return NotesService.instance;
  }

  async createNote(options: NoteCreateOptions) {
    const docName = generateDocName();

    // Create the note in the database
    const note = await createNote({
      title: options.title,
      docName,
      transcriptionId: options.transcriptionId,
    });

    // Initialize yjs document with initial content if provided
    if (options.initialContent) {
      const ydoc = new Y.Doc();
      const text = ydoc.getText("content");
      text.insert(0, options.initialContent);

      // Create persistence to save initial content
      const persistence = new LibSQLPersistence(docName, ydoc, {
        url: this.dbPath,
      });

      await persistence.whenSynced;

      // Store in our map for later use
      this.persistenceInstances.set(docName, persistence);
    }

    return note;
  }

  async getNote(id: number) {
    const note = await getNoteById(id);
    if (note) {
      // Update last accessed time
      await touchNote(id);
    }
    return note;
  }

  async getNoteByDocName(docName: string) {
    const note = await getNoteByDocName(docName);
    if (note) {
      // Update last accessed time
      await touchNote(note.id);
    }
    return note;
  }

  async listNotes(options?: {
    limit?: number;
    offset?: number;
    sortBy?: "title" | "updatedAt" | "createdAt" | "lastAccessedAt";
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

    // Clean up persistence instance if it exists
    const persistence = this.persistenceInstances.get(note.docName);
    if (persistence) {
      persistence.destroy();
      this.persistenceInstances.delete(note.docName);
    }

    return await deleteNote(id);
  }

  async getNotesByTranscription(transcriptionId: number) {
    return await getNotesByTranscriptionId(transcriptionId);
  }

  async setNoteMetadata(noteId: number, key: string, value: any) {
    const jsonValue = typeof value === "string" ? value : JSON.stringify(value);
    await setNoteMetadata(noteId, key, jsonValue);
  }

  async getNoteMetadata(noteId: number, key?: string) {
    const result = await getNoteMetadata(noteId, key);

    if (key && result) {
      try {
        return JSON.parse((result as any).value);
      } catch {
        return (result as any).value;
      }
    }

    return result;
  }

  // Get or create a persistence instance for a document
  async getPersistence(docName: string): Promise<LibSQLPersistence | null> {
    // Check if we already have an instance
    if (this.persistenceInstances.has(docName)) {
      return this.persistenceInstances.get(docName)!;
    }

    // Verify the note exists
    const note = await getNoteByDocName(docName);
    if (!note) {
      return null;
    }

    // Create new persistence instance
    const ydoc = new Y.Doc();
    const persistence = new LibSQLPersistence(docName, ydoc, {
      url: this.dbPath,
    });

    await persistence.whenSynced;
    this.persistenceInstances.set(docName, persistence);

    return persistence;
  }

  // Save yjs update to database
  async saveYjsUpdate(docName: string, update: Uint8Array) {
    // Convert Uint8Array to base64 for storage
    const base64Update = Buffer.from(update).toString("base64");

    // Insert into yjs_updates table
    await db.insert(yjsUpdates).values({
      docName,
      updateData: base64Update,
    });
  }

  // Load all yjs updates for a document
  async loadYjsUpdates(docName: string): Promise<Uint8Array[]> {
    const updates = await db
      .select()
      .from(yjsUpdates)
      .where(eq(yjsUpdates.docName, docName))
      .orderBy(asc(yjsUpdates.id));

    // Convert base64 back to Uint8Array
    return updates.map((u) => {
      return new Uint8Array(Buffer.from(u.updateData, "base64"));
    });
  }

  // Compact all note documents
  async compactAllNotes(): Promise<void> {
    const startTime = Date.now();
    logger.main.info("Starting yjs compaction for all notes");

    try {
      // Get all unique docNames that have updates
      const result = await db
        .select({ docName: yjsUpdates.docName })
        .from(yjsUpdates)
        .groupBy(yjsUpdates.docName);

      const docNames = result.map((r) => r.docName);
      logger.main.info(`Found ${docNames.length} documents to compact`);

      let totalUpdatesBefore = 0;
      let totalUpdatesAfter = 0;

      for (const docName of docNames) {
        const compactResult = await this.compactNote(docName);
        totalUpdatesBefore += compactResult.updatesBefore;
        totalUpdatesAfter += compactResult.updatesAfter;
      }

      const duration = Date.now() - startTime;
      logger.main.info(`Compaction completed in ${duration}ms`, {
        documentsCompacted: docNames.length,
        totalUpdatesBefore,
        totalUpdatesAfter,
        updatesReduced: totalUpdatesBefore - totalUpdatesAfter,
      });
    } catch (error) {
      logger.main.error("Failed to compact notes:", error);
    }
  }

  // Compact a specific note document
  async compactNote(
    docName: string,
  ): Promise<{ updatesBefore: number; updatesAfter: number }> {
    // Get all updates for this document
    const updates = await db
      .select()
      .from(yjsUpdates)
      .where(eq(yjsUpdates.docName, docName))
      .orderBy(asc(yjsUpdates.id));

    const updatesBefore = updates.length;

    if (updatesBefore <= 1) {
      // No need to compact if there's only one update or none
      return { updatesBefore, updatesAfter: updatesBefore };
    }

    // Create a new Y.Doc and apply all updates
    const ydoc = new Y.Doc();
    for (const update of updates) {
      const updateArray = new Uint8Array(
        Buffer.from(update.updateData, "base64"),
      );
      Y.applyUpdate(ydoc, updateArray);
    }

    // Encode the current state as a single update
    const stateUpdate = Y.encodeStateAsUpdate(ydoc);
    const base64Update = Buffer.from(stateUpdate).toString("base64");

    // Replace all updates with the compacted one
    await db.transaction(async (tx) => {
      // Delete all existing updates
      await tx.delete(yjsUpdates).where(eq(yjsUpdates.docName, docName));

      // Insert the compacted update
      await tx.insert(yjsUpdates).values({
        docName,
        updateData: base64Update,
      });
    });

    logger.main.debug(
      `Compacted document ${docName}: ${updatesBefore} updates -> 1 update`,
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

  // Clean up all persistence instances
  cleanup() {
    // Stop the cron job
    if (this.compactionTask) {
      this.compactionTask.stop();
      this.compactionTask = null;
    }

    for (const persistence of this.persistenceInstances.values()) {
      persistence.destroy();
    }
    this.persistenceInstances.clear();
  }
}

export default NotesService;
