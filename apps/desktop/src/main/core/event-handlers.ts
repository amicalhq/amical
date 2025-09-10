import { HelperEvent } from "@amical/types";
import { AppManager } from "./app-manager";
import { logger } from "../logger";
import { ipcMain, shell, systemPreferences, app } from "electron";
import NotesService from "../../services/notes-service";

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
