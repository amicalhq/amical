import { HelperEvent } from "@amical/types";
import { AppManager } from "./app-manager";
import { logger } from "../logger";
import { ipcMain, shell } from "electron";

export class EventHandlers {
  private appManager: AppManager;

  constructor(appManager: AppManager) {
    this.appManager = appManager;
  }

  setupEventHandlers(): void {
    this.setupSwiftBridgeEventHandlers();
    this.setupGeneralIPCHandlers();
    // Note: Audio IPC handlers are now managed by RecordingService
  }

  private setupSwiftBridgeEventHandlers(): void {
    try {
      const swiftBridge = this.appManager.getSwiftIOBridge();
      if (!swiftBridge) {
        logger.main.warn("Swift bridge not available for event handlers");
        return;
      }

      // Handle non-shortcut related events only
      swiftBridge.on("helperEvent", (event: HelperEvent) => {
        logger.swift.debug("Received helperEvent from SwiftIOBridge", {
          event,
        });

        // Let ShortcutManager handle all key-related events
        // This handler can process other helper events if needed
      });

      swiftBridge.on("error", (error: Error) => {
        logger.main.error("SwiftIOBridge error:", error);
      });

      swiftBridge.on("close", (code: number | null) => {
        logger.swift.warn("Swift helper process closed", { code });
      });
    } catch (error) {
      logger.main.warn("Swift bridge not available for event handlers");
    }
  }

  private setupGeneralIPCHandlers(): void {
    // Handle opening external links
    ipcMain.handle("open-external", async (event, url: string) => {
      await shell.openExternal(url);
      logger.main.debug("Opening external URL", { url });
    });
  }
}
