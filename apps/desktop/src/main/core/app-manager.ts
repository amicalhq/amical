import { app, ipcMain, shell } from "electron";
import { initializeDatabase } from "../../db";
import { logger } from "../logger";
import { WindowManager } from "./window-manager";
import { setupApplicationMenu } from "../menu";
import { ServiceManager } from "../managers/service-manager";
import { TrayManager } from "../managers/tray-manager";
import { createIPCHandler } from "electron-trpc-experimental/main";
import { router } from "../../trpc/router";
import { createContext } from "../../trpc/context";
import type { OnboardingService } from "../../services/onboarding-service";
import type { RecordingManager } from "../managers/recording-manager";
import type { ShortcutManager } from "../managers/shortcut-manager";
import type { SettingsService } from "../../services/settings-service";
import type { NativeBridge } from "../../services/platform/native-bridge-service";
import type { HelperEvent } from "@amical/types";
import { runDataMigrations } from "../migrations/data-migrations";
import { getMainFeatureFlagState } from "@/main/utils/feature-flags";
import { NOTE_WINDOW_FEATURE_FLAG } from "@/utils/feature-flags";

export class AppManager {
  private windowManager!: WindowManager;
  private serviceManager: ServiceManager;
  private trayManager: TrayManager;
  private trpcHandler!: ReturnType<typeof createIPCHandler>;

  constructor() {
    this.serviceManager = ServiceManager.getInstance();
    this.trayManager = TrayManager.getInstance();
    // WindowManager created in initialize() after deps are ready
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
          authService.handleAuthCallback(code, state);
        }
      }

      // Auto-focus the appropriate window after handling deep link
      const onboardingWindow = this.windowManager.getOnboardingWindow();
      if (onboardingWindow && !onboardingWindow.isDestroyed()) {
        onboardingWindow.show();
        onboardingWindow.focus();
      } else {
        // Create or show main window
        this.windowManager.createOrShowMainWindow();
        const mainWindow = this.windowManager.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.focus();
        }
      }
    } catch (error) {
      logger.main.error("Error handling deep link:", error);
    }
  }

  async initialize(): Promise<void> {
    await this.initializeDatabase();

    await this.serviceManager.initialize();

    const telemetryService = this.serviceManager.getService("telemetryService");
    telemetryService.trackAppLaunch();

    // Initialize tRPC handler (services must be ready first)
    this.trpcHandler = createIPCHandler({
      router,
      windows: [],
      createContext: async () => createContext(this.serviceManager),
    });
    logger.main.info("tRPC handler initialized");

    // Create WindowManager now that all deps are ready
    const settingsService = this.serviceManager.getService("settingsService");
    this.windowManager = new WindowManager(settingsService, this.trpcHandler);

    // Register WindowManager with ServiceManager for getService("windowManager")
    this.serviceManager.setWindowManager(this.windowManager);

    // Get onboarding service and subscribe to lifecycle events
    const onboardingService =
      this.serviceManager.getService("onboardingService");
    this.setupOnboardingEventListeners(onboardingService);

    // Subscribe to recording state changes for widget visibility
    const recordingManager = this.serviceManager.getService("recordingManager");
    this.setupRecordingEventListeners(recordingManager);
    const shortcutManager = this.serviceManager.getService("shortcutManager");
    this.setupShortcutEventListeners(shortcutManager);
    const nativeBridge = this.serviceManager.getService("nativeBridge");
    this.setupNativeBridgeEventListeners(nativeBridge);

    // Check if onboarding is needed using OnboardingService (single source of truth)
    const onboardingCheck = await onboardingService.checkNeedsOnboarding();

    // Sync auto-launch setting with OS on startup
    settingsService.syncAutoLaunch();
    logger.main.info("Auto-launch setting synced with OS");

    // Subscribe to settings changes for window updates
    this.setupSettingsEventListeners(settingsService);

    if (onboardingCheck.needed) {
      // Suppress global shortcut commands while onboarding is open; the
      // dictation try-it steps lift this for their lifetime (see the
      // try-it-active-changed listener above).
      shortcutManager.setCommandsSuppressed(true);
      await onboardingService.startOnboardingFlow();
      await this.windowManager.createOrShowOnboardingWindow();

      // Closing the wizard is the third exit (besides completed/cancelled):
      // treat it as cancel — track abandonment and quit via the cancelled
      // handler. Without this the app lingers headless with all shortcut
      // commands suppressed. Completion closes this window too, but it flips
      // isInProgress to false before doing so, so the guard skips it.
      this.windowManager.getOnboardingWindow()?.on("closed", () => {
        if (onboardingService.isInProgress()) {
          void onboardingService.cancelOnboardingFlow();
        }
      });
    } else {
      await this.setupWindows();
    }

    const locale = await this.setupMenu();

    // Initialize tray
    await this.trayManager.initialize(this.windowManager, locale);

    // Setup IPC handlers
    ipcMain.handle("open-external", async (_event, url: string) => {
      await shell.openExternal(url);
      logger.main.debug("Opening external URL", { url });
    });

    logger.main.info("Application initialized successfully");
  }

  private async initializeDatabase(): Promise<void> {
    await initializeDatabase();
    await runDataMigrations();
    logger.db.info(
      "Database initialized and migrations completed successfully",
    );
  }

  private setupOnboardingEventListeners(
    onboardingService: OnboardingService,
  ): void {
    // Handle onboarding completion
    onboardingService.on("completed", () => {
      const shouldRelaunch = process.env.NODE_ENV !== "development";
      logger.main.info("Onboarding completed event received", {
        shouldRelaunch,
      });

      // Re-enable global shortcut commands now that onboarding is done.
      this.serviceManager
        .getService("shortcutManager")
        .setCommandsSuppressed(false);

      this.windowManager.closeOnboardingWindow();

      if (shouldRelaunch) {
        // Production: relaunch app to reinitialize with new settings
        logger.main.info("Relaunching app after onboarding completion");
        app.relaunch();
        app.quit();
      } else {
        // Development: just show the main app windows
        logger.main.info("Dev mode: showing main app windows after onboarding");
        this.setupWindows();
      }
    });

    // Handle onboarding cancellation
    onboardingService.on("cancelled", () => {
      logger.main.info("Onboarding cancelled event received, quitting app");
      this.windowManager.closeOnboardingWindow();
      app.quit();
    });

    // A dictation try-it step lifts the shortcut suppression for its lifetime
    // so push-to-talk works exactly as in production, and needs the widget
    // window up (it is also the audio-capture surface). Leaving the step
    // re-suppresses only while the wizard is still open — completion may
    // already have lifted suppression for good.
    onboardingService.on("try-it-active-changed", (active: boolean) => {
      this.serviceManager
        .getService("shortcutManager")
        .setCommandsSuppressed(!active && onboardingService.isInProgress());
      if (active) {
        // Onboarding boot skips setupWindows, so the widget window doesn't
        // exist yet; production visibility rules take over after creation.
        this.windowManager.ensureWidgetWindow().catch((error) => {
          logger.main.error("Failed to bring up widget for try-it", error);
        });
      }
    });

    logger.main.info("Onboarding event listeners set up");
  }

  private setupRecordingEventListeners(
    recordingManager: RecordingManager,
  ): void {
    const refresh = () => {
      this.updateWidgetVisibility(this.isEffectivelyIdle(recordingManager)).catch(
        (error) => {
          logger.main.error("Failed to update widget visibility", error);
        },
      );
    };

    recordingManager.on("state-changed", refresh);
    // A pending draft keeps the widget shown even though the FSM is idle, so the
    // review box survives until insert/dismiss; re-hide once it's cleared.
    recordingManager.on("draft-changed", refresh);

    logger.main.info("Recording state listener connected in AppManager");
  }

  // The widget should be treated as "active" (shown) whenever recording OR while
  // a draft review is pending — even though the recording FSM is idle then.
  private isEffectivelyIdle(recordingManager: RecordingManager): boolean {
    return (
      recordingManager.getState() === "idle" &&
      recordingManager.getPendingDraft() === null
    );
  }

  private setupShortcutEventListeners(shortcutManager: ShortcutManager): void {
    shortcutManager.on("open-notes-window-triggered", () => {
      void this.handleOpenNotesWindowShortcut();
    });

    logger.main.info("Shortcut listeners connected in AppManager");
  }

  private setupNativeBridgeEventListeners(nativeBridge: NativeBridge): void {
    // Move the widget to the focused display when the foreground window changes.
    // Windows has no OS "active display changed" notification, so the native
    // helper reports the foreground monitor and we relocate here.
    nativeBridge.on("helperEvent", (event: HelperEvent) => {
      if (event.type === "activeDisplayChanged") {
        this.windowManager.handleDisplayChange("foreground-window");
      }
    });

    logger.main.info("Native bridge listeners connected in AppManager");
  }

  private async handleOpenNotesWindowShortcut(): Promise<void> {
    try {
      const featureFlagService =
        this.serviceManager.getService("featureFlagService");
      const noteWindowFlag = await getMainFeatureFlagState(
        featureFlagService,
        NOTE_WINDOW_FEATURE_FLAG,
      );

      if (!noteWindowFlag.enabled) {
        logger.main.debug(
          "Ignored notes window shortcut: feature flag is disabled",
          {
            flagKey: NOTE_WINDOW_FEATURE_FLAG,
            flagValue: noteWindowFlag.value,
          },
        );
        return;
      }

      this.windowManager.openNotesWindow();
    } catch (error) {
      logger.main.error("Failed to open notes window from shortcut", {
        error,
      });
    }
  }

  private setupSettingsEventListeners(settingsService: SettingsService): void {
    // Handle preference changes (widget visibility, dock visibility)
    settingsService.on(
      "preferences-changed",
      async ({
        showWidgetWhileInactiveChanged,
        showInDockChanged,
      }: {
        showWidgetWhileInactiveChanged: boolean;
        showInDockChanged: boolean;
      }) => {
        if (showWidgetWhileInactiveChanged) {
          const recordingManager =
            this.serviceManager.getService("recordingManager");
          await this.updateWidgetVisibility(
            this.isEffectivelyIdle(recordingManager),
          );
        }
        if (showInDockChanged) {
          settingsService.syncDockVisibility();
        }
      },
    );

    // Handle theme changes
    settingsService.on("theme-changed", async () => {
      await this.windowManager.updateAllWindowThemes();
    });

    logger.main.info("Settings event listeners set up");
  }

  private async updateWidgetVisibility(isIdle: boolean): Promise<void> {
    const settingsService = this.serviceManager.getService("settingsService");
    const preferences = await settingsService.getPreferences();

    if (preferences.showWidgetWhileInactive || !isIdle) {
      this.windowManager.showWidget();
    } else {
      this.windowManager.hideWidget();
    }
  }

  private async setupWindows(): Promise<void> {
    await this.windowManager.ensureWidgetWindow();

    this.windowManager.createOrShowMainWindow();

    // Apply dock visibility based on user preference (macOS only)
    const settingsService = this.serviceManager.getService("settingsService");
    const preferences = await settingsService.getPreferences();
    if (app.dock) {
      if (preferences.showInDock) {
        app.dock
          .show()
          .then(() => {
            logger.main.info("Showing app in dock based on preference");
          })
          .catch((error) => {
            logger.main.error("Error showing app in dock", error);
          });
      } else {
        app.dock.hide();
        logger.main.info("Hiding app from dock based on preference");
      }
    }
  }

  private async setupMenu(): Promise<string> {
    const settingsService = this.serviceManager.getService("settingsService");
    const uiSettings = await settingsService.getUISettings();
    const locale = uiSettings.locale ?? app.getLocale();
    await setupApplicationMenu(
      () => {
        void this.windowManager.navigateMainWindow("/settings/preferences");
      },
      () => {
        const autoUpdaterService =
          this.serviceManager.getService("autoUpdaterService");
        if (autoUpdaterService) {
          autoUpdaterService.checkForUpdates(true);
        }
        // Open About and highlight the update card so the user sees the
        // inline status update for their menu-initiated check.
        void this.windowManager.navigateMainWindow(
          "/settings/about?focusUpdate=true",
        );
      },
      () => this.windowManager.openAllDevTools(),
      locale,
    );
    return locale;
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
    // If onboarding is in progress, focus onboarding window instead
    const onboardingWindow = this.windowManager.getOnboardingWindow();
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      onboardingWindow.show();
      onboardingWindow.focus();
      logger.main.info(
        "Second instance attempted during onboarding, focusing onboarding window",
      );
      return;
    }

    // On Windows, closing main window destroys it, so we recreate it here.
    // widgetWindow is not suitable as a foreground window (focusable: false).
    const mainWindow = this.windowManager.getMainWindow();

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    } else {
      // main window was destroyed - recreate it
      this.windowManager.createOrShowMainWindow();
    }

    logger.main.info("Second instance attempted, focusing existing window");
  }

  async handleActivate(): Promise<void> {
    logger.main.info("Handle activate called");
    // If onboarding is in progress, just focus that window
    const onboardingWindow = this.windowManager.getOnboardingWindow();
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      onboardingWindow.show();
      onboardingWindow.focus();
      return;
    }

    await this.windowManager.ensureWidgetWindow();

    this.windowManager.createOrShowMainWindow();
  }
}
