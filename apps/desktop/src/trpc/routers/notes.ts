import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import NotesService from "../../services/notes-service";
import { ServiceManager } from "../../main/managers/service-manager";

const notesService = NotesService.getInstance();

// Input schemas
const GetNotesSchema = z.object({
  limit: z.number().optional().default(50),
  offset: z.number().optional().default(0),
  sortBy: z
    .enum(["title", "updatedAt", "createdAt"])
    .optional()
    .default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  search: z.string().optional(),
  transcriptionId: z.number().nullable().optional(),
});

const CreateNoteSchema = z.object({
  title: z.string().min(1),
  initialContent: z.string().optional(),
  icon: z.string().nullish(),
});

const UpdateNoteTitleSchema = z.object({
  id: z.number(),
  title: z.string().min(1),
});

const UpdateNoteIconSchema = z.object({
  id: z.number(),
  icon: z.string().nullish(),
});

export const notesRouter = createRouter({
  // Get all notes
  getNotes: procedure.input(GetNotesSchema).query(async ({ input }) => {
    return await notesService.listNotes({
      limit: input.limit,
      offset: input.offset,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      search: input.search,
      transcriptionId: input.transcriptionId,
    });
  }),

  // Get note by ID
  getNoteById: procedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const note = await notesService.getNote(input.id);
      if (!note) {
        throw new Error("Note not found");
      }
      return note;
    }),

  // Create new note
  createNote: procedure.input(CreateNoteSchema).mutation(async ({ input }) => {
    const note = await notesService.createNote({
      title: input.title,
      initialContent: input.initialContent || "",
      icon: input.icon,
    });

    // Track telemetry
    const telemetryService =
      ServiceManager.getInstance().getService("telemetryService");
    telemetryService.trackNoteCreated({
      note_id: note.id,
      has_initial_content: !!input.initialContent,
      has_icon: !!input.icon,
    });

    return note;
  }),

  // Update note title
  updateNoteTitle: procedure
    .input(UpdateNoteTitleSchema)
    .mutation(async ({ input }) => {
      const updated = await notesService.updateNote(input.id, {
        title: input.title,
      });
      if (!updated) {
        throw new Error("Failed to update note");
      }
      return updated;
    }),

  updateNoteIcon: procedure
    .input(UpdateNoteIconSchema)
    .mutation(async ({ input }) => {
      const updated = await notesService.updateNote(input.id, {
        icon: input.icon,
      });
      if (!updated) {
        throw new Error("Failed to update note");
      }
      return updated;
    }),

  // Delete note
  deleteNote: procedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const deleted = await notesService.deleteNote(input.id);
      if (!deleted) {
        throw new Error("Note not found");
      }
      return { success: true };
    }),

  // Search notes (for command palette)
  searchNotes: procedure
    .input(
      z.object({
        query: z.string().optional().default(""),
        limit: z.number().optional().default(10),
      }),
    )
    .query(async ({ input }) => {
      const notes = await notesService.listNotes({
        search: input.query || "",
        limit: input.limit,
      });
      return notes.map((note) => ({
        id: note.id,
        title: note.title,
        createdAt: note.createdAt,
        icon: note.icon || "file-text",
      }));
    }),
});
