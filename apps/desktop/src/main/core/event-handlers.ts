import { HelperEvent } from "@amical/types";
import { AppManager } from "./app-manager";
import { logger } from "../logger";
import { ipcMain, shell, systemPreferences, app } from "electron";
import NotesService from "../../services/NotesService";

export class EventHandlers {
  private appManager: AppManager;

  constructor(appManager: AppManager) {
    this.appManager = appManager;
  }

  setupEventHandlers(): void {
    this.setupNativeBridgeEventHandlers();
    this.setupGeneralIPCHandlers();
    this.setupOnboardingIPCHandlers();
    this.setupNotesIPCHandlers();
    // Note: Audio IPC handlers are now managed by RecordingService
  }

  private setupNativeBridgeEventHandlers(): void {
    try {
      const nativeBridge = this.appManager.getNativeBridge();
      if (!nativeBridge) {
        logger.main.warn("Native bridge not available for event handlers");
        return;
      }

      // Handle non-shortcut related events only
      nativeBridge.on("helperEvent", (event: HelperEvent) => {
        logger.swift.debug("Received helperEvent from native bridge", {
          event,
        });

        // Let ShortcutManager handle all key-related events
        // This handler can process other helper events if needed
      });

      nativeBridge.on("error", (error: Error) => {
        logger.main.error("Native bridge error:", error);
      });

      nativeBridge.on("close", (code: number | null) => {
        logger.swift.warn("Native helper process closed", { code });
      });
    } catch (error) {
      logger.main.warn("Native bridge not available for event handlers");
    }
  }

  private setupGeneralIPCHandlers(): void {
    // Handle opening external links
    ipcMain.handle("open-external", async (event, url: string) => {
      await shell.openExternal(url);
      logger.main.debug("Opening external URL", { url });
    });
  }

  private setupOnboardingIPCHandlers(): void {
    // Permission checks
    ipcMain.handle("onboarding:check-microphone-permission", async () => {
      return systemPreferences.getMediaAccessStatus("microphone");
    });

    ipcMain.handle("onboarding:check-accessibility-permission", async () => {
      if (process.platform !== "darwin") {
        return true; // Non-macOS platforms don't need accessibility permission
      }
      return systemPreferences.isTrustedAccessibilityClient(false);
    });

    // Permission requests
    ipcMain.handle("onboarding:request-microphone-permission", async () => {
      const status = await systemPreferences.askForMediaAccess("microphone");
      logger.main.info("Microphone permission request result:", status);
      return status;
    });

    ipcMain.handle("onboarding:request-accessibility-permission", async () => {
      if (process.platform !== "darwin") {
        return; // Non-macOS platforms don't need accessibility permission
      }
      // This will prompt the user to open System Preferences
      systemPreferences.isTrustedAccessibilityClient(true);
    });

    // Navigation
    ipcMain.handle("onboarding:complete", async () => {
      logger.main.info("Onboarding completed");
      this.appManager.completeOnboarding();
    });

    // System info
    ipcMain.handle("onboarding:get-platform", async () => {
      return process.platform;
    });

    // Quit app
    ipcMain.handle("onboarding:quit-app", async () => {
      logger.main.info("Quitting app from onboarding");
      app.quit();
    });
  }

  private setupNotesIPCHandlers(): void {
    const notesService = NotesService.getInstance();

    // Create note
    ipcMain.handle(
      "notes:create",
      async (
        event,
        options: {
          title: string;
          transcriptionId?: number;
          initialContent?: string;
        },
      ) => {
        try {
          const note = await notesService.createNote(options);
          logger.main.debug("Created note", { noteId: note.id });
          return note;
        } catch (error) {
          logger.main.error("Failed to create note", error);
          throw error;
        }
      },
    );

    // Get note
    ipcMain.handle("notes:get", async (event, id: number) => {
      try {
        const note = await notesService.getNote(id);
        return note;
      } catch (error) {
        logger.main.error("Failed to get note", error);
        throw error;
      }
    });

    // Get note by docName
    ipcMain.handle("notes:getByDocName", async (event, docName: string) => {
      try {
        const note = await notesService.getNoteByDocName(docName);
        return note;
      } catch (error) {
        logger.main.error("Failed to get note by docName", error);
        throw error;
      }
    });

    // List notes
    ipcMain.handle(
      "notes:list",
      async (
        event,
        options?: {
          limit?: number;
          offset?: number;
          sortBy?: "title" | "updatedAt" | "createdAt" | "lastAccessedAt";
          sortOrder?: "asc" | "desc";
          search?: string;
          transcriptionId?: number | null;
        },
      ) => {
        try {
          const notes = await notesService.listNotes(options);
          return notes;
        } catch (error) {
          logger.main.error("Failed to list notes", error);
          throw error;
        }
      },
    );

    // Update note
    ipcMain.handle(
      "notes:update",
      async (
        event,
        id: number,
        options: {
          title?: string;
          transcriptionId?: number | null;
        },
      ) => {
        try {
          const note = await notesService.updateNote(id, options);
          logger.main.debug("Updated note", { noteId: id });
          return note;
        } catch (error) {
          logger.main.error("Failed to update note", error);
          throw error;
        }
      },
    );

    // Delete note
    ipcMain.handle("notes:delete", async (event, id: number) => {
      try {
        const result = await notesService.deleteNote(id);
        logger.main.debug("Deleted note", { noteId: id });
        return result;
      } catch (error) {
        logger.main.error("Failed to delete note", error);
        throw error;
      }
    });

    // Get notes by transcription
    ipcMain.handle(
      "notes:getByTranscription",
      async (event, transcriptionId: number) => {
        try {
          const notes =
            await notesService.getNotesByTranscription(transcriptionId);
          return notes;
        } catch (error) {
          logger.main.error("Failed to get notes by transcription", error);
          throw error;
        }
      },
    );

    // Get yjs persistence for a note
    ipcMain.handle("notes:getPersistence", async (event, docName: string) => {
      try {
        const persistence = await notesService.getPersistence(docName);
        if (!persistence) {
          throw new Error("Note not found");
        }
        // We can't send the persistence object directly, but we can indicate success
        return { success: true, docName };
      } catch (error) {
        logger.main.error("Failed to get persistence", error);
        throw error;
      }
    });

    // Save yjs update
    ipcMain.handle(
      "notes:saveYjsUpdate",
      async (event, docName: string, update: ArrayBuffer) => {
        try {
          // Convert ArrayBuffer to Uint8Array
          const updateArray = new Uint8Array(update);
          await notesService.saveYjsUpdate(docName, updateArray);
          logger.main.debug("Saved yjs update", {
            docName,
            updateSize: updateArray.length,
          });
        } catch (error) {
          logger.main.error("Failed to save yjs update", error);
          throw error;
        }
      },
    );

    // Load all yjs updates for a document
    ipcMain.handle("notes:loadYjsUpdates", async (event, docName: string) => {
      try {
        const updates = await notesService.loadYjsUpdates(docName);
        logger.main.debug("Loaded yjs updates", {
          docName,
          count: updates.length,
        });
        // Convert Uint8Array[] to ArrayBuffer[] for IPC transfer
        return updates.map((u) => u.buffer);
      } catch (error) {
        logger.main.error("Failed to load yjs updates", error);
        throw error;
      }
    });
  }
}
