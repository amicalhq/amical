import {
  app,
  systemPreferences,
  BrowserWindow,
  globalShortcut,
} from "electron";
import { initializeDatabase } from "../../db/config";
import { logger } from "../logger";
import { WindowManager } from "./window-manager";
import { setupApplicationMenu } from "../menu";
import { ServiceManager } from "../managers/service-manager";
import { createIPCHandler } from "electron-trpc-experimental/main";
import { router } from "../../trpc/router";
import { EventHandlers } from "./event-handlers";

export class AppManager {
  private windowManager: WindowManager;
  private serviceManager: ServiceManager;

  constructor() {
    this.windowManager = new WindowManager();
    this.serviceManager = ServiceManager.createInstance();
    this.windowManager.setMainWindowCreatedCallback(
      this.onMainWindowCreated.bind(this),
    );
  }

  async initialize(): Promise<void> {
    try {
      await this.initializeDatabase();

      await this.requestPermissions();
      await this.serviceManager.initialize(this.windowManager);
      this.exposeGlobalServices();
      await this.setupWindows();
      await this.setupMenu();

      // Setup event handlers
      const eventHandlers = new EventHandlers(this);
      eventHandlers.setupEventHandlers();

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
    this.setupTRPCHandler();

    if (process.platform === "darwin" && app.dock) {
      app.dock.show();
    }
  }

  private setupTRPCHandler(): Promise<void> {
    const windows = this.windowManager
      .getAllWindows()
      .filter((w): w is BrowserWindow => w !== null);
    createIPCHandler({ router, windows });
    return Promise.resolve();
  }

  updateTRPCHandler(): void {
    const windows = this.windowManager
      .getAllWindows()
      .filter((w): w is BrowserWindow => w !== null);
    createIPCHandler({ router, windows });
  }

  private async setupMenu(): Promise<void> {
    setupApplicationMenu(
      () => this.windowManager.createOrShowMainWindow(),
      () => {
        const autoUpdaterService = this.serviceManager.getAutoUpdaterService();
        if (autoUpdaterService) {
          autoUpdaterService.checkForUpdates(true);
        }
      },
      () => this.windowManager.openAllDevTools(),
    );
  }

  private exposeGlobalServices(): void {
    // Make services available globally for tRPC (temporary solution)
    const transcriptionService = this.serviceManager.getTranscriptionService();
    const autoUpdaterService = this.serviceManager.getAutoUpdaterService();
    const settingsService = this.serviceManager.getSettingsService();
    const swiftBridge = this.serviceManager.getSwiftIOBridge();

    (globalThis as any).modelManagerService =
      this.serviceManager.getModelManagerService();
    (globalThis as any).transcriptionService = transcriptionService;
    (globalThis as any).settingsService = settingsService;
    (globalThis as any).logger = logger;
    (globalThis as any).autoUpdaterService = autoUpdaterService;
    (globalThis as any).swiftBridge = swiftBridge;
  }

  getWindowManager(): WindowManager {
    return this.windowManager;
  }

  getServiceManager(): ServiceManager {
    return this.serviceManager;
  }

  getTranscriptionService(): any {
    return this.serviceManager.getTranscriptionService();
  }

  getSwiftIOBridge(): any {
    return this.serviceManager.getSwiftIOBridge();
  }

  getAutoUpdaterService(): any {
    return this.serviceManager.getAutoUpdaterService();
  }

  private onMainWindowCreated(window: BrowserWindow): void {
    this.updateTRPCHandler();
  }

  async cleanup(): Promise<void> {
    globalShortcut.unregisterAll();
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
