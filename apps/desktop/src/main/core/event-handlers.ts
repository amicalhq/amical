import { HelperEvent } from "@amical/types";
import { AppManager } from "./app-manager";
import { logger } from "../logger";
import { ipcMain, shell } from "electron";
import NotesService from "../../services/notes-service";

export class EventHandlers {
  private appManager: AppManager;

  constructor(appManager: AppManager) {
    this.appManager = appManager;
  }

  setupEventHandlers(): void {
    this.setupNativeBridgeEventHandlers();
    this.setupGeneralIPCHandlers();
    this.setupNotesIPCHandlers();
    // Note: Audio IPC handlers are now managed by RecordingService
    // Note: Onboarding IPC handlers removed - now using tRPC
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

  private setupNotesIPCHandlers(): void {
    const notesService = NotesService.getInstance();

    // Save yjs update
    ipcMain.handle(
      "notes:saveYjsUpdate",
      async (event, noteId: number, update: ArrayBuffer) => {
        try {
          // Convert ArrayBuffer to Uint8Array
          const updateArray = new Uint8Array(update);
          await notesService.saveYjsUpdate(noteId, updateArray);
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

    // Load all yjs updates for a note
    ipcMain.handle("notes:loadYjsUpdates", async (event, noteId: number) => {
      try {
        const updates = await notesService.loadYjsUpdates(noteId);
        logger.main.debug("Loaded yjs updates", {
          noteId,
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
