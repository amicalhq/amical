import { app, systemPreferences } from "electron";
import { initializeDatabase } from "../../db/config";
import { logger } from "../logger";
import { WindowManager } from "./window-manager";
import { setupApplicationMenu } from "../menu";
import { ServiceManager } from "../managers/service-manager";
import { EventHandlers } from "./event-handlers";

export class AppManager {
  private windowManager: WindowManager;
  private serviceManager: ServiceManager;
  private eventHandlers: EventHandlers | null = null;

  constructor() {
    this.windowManager = new WindowManager();
    this.serviceManager = ServiceManager.createInstance();
  }

  async initialize(): Promise<void> {
    try {
      await this.initializeDatabase();

      await this.requestPermissions();
      await this.serviceManager.initialize();
      await this.setupWindows();
      await this.setupMenu();

      // Setup event handlers
      this.eventHandlers = new EventHandlers(this);
      this.eventHandlers.setupEventHandlers();

      // Auto-update is now handled by update-electron-app in main.ts

      logger.main.info("Application initialized successfully");
    } catch (error) {
      logger.main.error("Error initializing app:", error);
      throw error;
    }
  }

  private async initializeDatabase(): Promise<void> {
    await initializeDatabase();
    logger.db.info(
      "Database initialized and migrations completed successfully",
    );
  }

  private async requestPermissions(): Promise<void> {
    if (process.platform === "darwin") {
      const accessibilityEnabled =
        systemPreferences.isTrustedAccessibilityClient(false);
      if (!accessibilityEnabled) {
        logger.main.debug(
          "Please enable accessibility permissions in System Preferences > Security & Privacy > Privacy > Accessibility",
        );
      }
    }

    const microphoneEnabled =
      systemPreferences.getMediaAccessStatus("microphone");
    logger.main.info("Microphone access status:", {
      status: microphoneEnabled,
    });

    if (microphoneEnabled !== "granted") {
      await systemPreferences.askForMediaAccess("microphone");
    }
  }

  private async setupWindows(): Promise<void> {
    this.windowManager.createWidgetWindow();
    this.windowManager.createOrShowMainWindow();
    // tRPC handler is now set up in WindowManager when windows are created

    if (app.dock) {
      app.dock
        .show()
        .then(() => {
          logger.main.info("Explicitly showing app in dock");
        })
        .catch((error) => {
          logger.main.error("Error showing app in dock", error);
        });
    } else {
      logger.main.warn("app.dock is not available");
    }
  }

  private async setupMenu(): Promise<void> {
    setupApplicationMenu(
      () => this.windowManager.createOrShowMainWindow(),
      () => {
        const autoUpdaterService =
          this.serviceManager.getService("autoUpdaterService");
        if (autoUpdaterService) {
          autoUpdaterService.checkForUpdates(true);
        }
      },
      () => this.windowManager.openAllDevTools(),
    );
  }

  getWindowManager(): WindowManager {
    return this.windowManager;
  }

  getServiceManager(): ServiceManager {
    return this.serviceManager;
  }

  getTranscriptionService() {
    return this.serviceManager.getService("transcriptionService");
  }

  getSwiftIOBridge() {
    return this.serviceManager.getService("swiftIOBridge");
  }

  getAutoUpdaterService() {
    return this.serviceManager.getService("autoUpdaterService");
  }

  getEventHandlers(): EventHandlers | null {
    return this.eventHandlers;
  }

  async cleanup(): Promise<void> {
    await this.serviceManager.cleanup();
    if (this.windowManager) {
      this.windowManager.cleanup();
    }
  }

  handleActivate(): void {
    const allWindows = this.windowManager.getAllWindows();

    if (allWindows.every((w) => !w || w.isDestroyed())) {
      this.windowManager.createWidgetWindow();
    } else {
      const widgetWindow = this.windowManager.getWidgetWindow();
      if (!widgetWindow || widgetWindow.isDestroyed()) {
        this.windowManager.createWidgetWindow();
      } else {
        widgetWindow.show();
      }
      this.windowManager.createOrShowMainWindow();
    }
  }
}
