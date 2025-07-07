import { HelperEvent } from "@amical/types";
import { AppManager } from "./app-manager";
import { logger } from "../logger";
import { ipcMain, shell, systemPreferences, app } from "electron";

export class EventHandlers {
  private appManager: AppManager;

  constructor(appManager: AppManager) {
    this.appManager = appManager;
  }

  setupEventHandlers(): void {
    this.setupSwiftBridgeEventHandlers();
    this.setupGeneralIPCHandlers();
    this.setupOnboardingIPCHandlers();
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
}
