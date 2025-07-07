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
    await this.initializeDatabase();

    const needsOnboarding = await this.checkNeedsOnboarding();

    await this.serviceManager.initialize();

    if (needsOnboarding) {
      await this.showOnboarding();
    } else {
      await this.setupWindows();
    }

    await this.setupMenu();

    // Setup event handlers
    this.eventHandlers = new EventHandlers(this);
    this.eventHandlers.setupEventHandlers();

    // Auto-update is now handled by update-electron-app in main.ts

    logger.main.info("Application initialized successfully");
  }

  private async initializeDatabase(): Promise<void> {
    await initializeDatabase();
    logger.db.info(
      "Database initialized and migrations completed successfully",
    );
  }

  private async checkNeedsOnboarding(): Promise<boolean> {
    // Force show onboarding for development testing
    if (process.env.FORCE_ONBOARDING === "true") {
      logger.main.info("Forcing onboarding window for testing");
      return true;
    }

    if (process.platform !== "darwin") {
      // For non-macOS platforms, we might still want to check microphone
      const microphoneStatus =
        systemPreferences.getMediaAccessStatus("microphone");
      return microphoneStatus !== "granted";
    }

    // Check both microphone and accessibility permissions on macOS
    const microphoneStatus =
      systemPreferences.getMediaAccessStatus("microphone");
    const accessibilityStatus =
      systemPreferences.isTrustedAccessibilityClient(false);

    logger.main.info("Permission status:", {
      microphone: microphoneStatus,
      accessibility: accessibilityStatus,
    });

    return microphoneStatus !== "granted" || !accessibilityStatus;
  }

  private async showOnboarding(): Promise<void> {
    this.windowManager.createOnboardingWindow();

    // The onboarding window will handle the permission flow
    // and call back to complete setup when done
  }

  completeOnboarding(): void {
    logger.main.info(
      "Onboarding completed, restarting app for permissions to take effect",
    );

    // Relaunch the app to ensure all permissions take effect
    app.relaunch();
    app.quit();
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
