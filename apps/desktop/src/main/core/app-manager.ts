import { app, systemPreferences } from "electron";
import { initializeDatabase } from "../../db";
import { logger } from "../logger";
import { WindowManager } from "./window-manager";
import { setupApplicationMenu } from "../menu";
import { ServiceManager } from "../managers/service-manager";
import { EventHandlers } from "./event-handlers";
import { TrayManager } from "../managers/tray-manager";

export class AppManager {
  private windowManager: WindowManager;
  private serviceManager: ServiceManager;
  private eventHandlers: EventHandlers | null = null;
  private trayManager: TrayManager;

  constructor() {
    this.windowManager = new WindowManager();
    this.serviceManager = ServiceManager.createInstance();
    this.serviceManager.setWindowManager(this.windowManager);
    this.trayManager = TrayManager.getInstance();
  }

  handleDeepLink(url: string): void {
    logger.main.info("Handling deep link:", url);

    // Parse the URL
    try {
      const parsedUrl = new URL(url);

      // Handle auth callback
      // For custom scheme URLs like amical://oauth/callback
      // parsedUrl.host = "oauth" and parsedUrl.pathname = "/callback"
      if (parsedUrl.host === "oauth" && parsedUrl.pathname === "/callback") {
        const code = parsedUrl.searchParams.get("code");
        const state = parsedUrl.searchParams.get("state");

        if (code) {
          // Get AuthService and complete the OAuth flow
          const authService = this.serviceManager.getService("authService");
          if (authService) {
            authService.handleAuthCallback(code, state);
          }
        }
      }

      // Add other deep link handlers here in the future
    } catch (error) {
      logger.main.error("Error handling deep link:", error);
    }
  }

  async initialize(): Promise<void> {
    await this.initializeDatabase();

    const needsOnboarding = await this.checkNeedsOnboarding();

    await this.serviceManager.initialize();

    // Sync auto-launch setting with OS on startup
    const settingsService = this.serviceManager.getService("settingsService");
    if (settingsService) {
      settingsService.syncAutoLaunch();
      logger.main.info("Auto-launch setting synced with OS");
    }

    if (needsOnboarding) {
      await this.showOnboarding();
    } else {
      await this.setupWindows();
    }

    await this.setupMenu();

    // Setup event handlers
    this.eventHandlers = new EventHandlers(this);
    this.eventHandlers.setupEventHandlers();

    // Initialize tray
    this.trayManager.initialize(this.windowManager);

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

    // In development, reload windows instead of relaunching
    if (process.env.NODE_ENV === "development") {
      logger.main.info(
        "Development mode: Reloading windows instead of relaunching",
      );

      // Close onboarding window
      const onboardingWindow = this.windowManager.getOnboardingWindow();
      if (onboardingWindow && !onboardingWindow.isDestroyed()) {
        onboardingWindow.close();
      }

      // Give a short delay for permissions to register
      setTimeout(async () => {
        await this.setupWindows();

        // Force reload all windows to pick up new permissions
        const mainWindow = this.windowManager.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
        }

        const widgetWindow = this.windowManager.getWidgetWindow();
        if (widgetWindow && !widgetWindow.isDestroyed()) {
          widgetWindow.reload();
        }
      }, 1000);
    } else {
      // Production mode: relaunch the app
      app.relaunch();
      app.quit();
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

  getNativeBridge() {
    return this.serviceManager.getService("nativeBridge");
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
    if (this.trayManager) {
      this.trayManager.cleanup();
    }
  }

  handleSecondInstance(): void {
    // When a second instance tries to start, focus our existing window
    const mainWindow = this.windowManager.getMainWindow();
    const widgetWindow = this.windowManager.getWidgetWindow();

    // Try to show and focus the main window first
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
      mainWindow.show();
    } else if (widgetWindow && !widgetWindow.isDestroyed()) {
      // If no main window, focus the widget window
      widgetWindow.focus();
      widgetWindow.show();
    } else {
      // If no windows are open, create them
      this.windowManager.createOrShowMainWindow();
    }

    logger.main.info("Second instance attempted, focusing existing window");
  }

  async handleActivate(): Promise<void> {
    const allWindows = this.windowManager.getAllWindows();

    if (allWindows.every((w) => !w || w.isDestroyed())) {
      await this.windowManager.createWidgetWindow();
    } else {
      const widgetWindow = this.windowManager.getWidgetWindow();
      if (!widgetWindow || widgetWindow.isDestroyed()) {
        await this.windowManager.createWidgetWindow();
      } else {
        widgetWindow.show();
      }
      this.windowManager.createOrShowMainWindow();
    }
  }
}
