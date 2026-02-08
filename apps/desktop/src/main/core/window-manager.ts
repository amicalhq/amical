import {
  BrowserWindow,
  screen,
  systemPreferences,
  app,
  nativeTheme,
} from "electron";
import path from "node:path";
import { logger } from "../logger";
import type { SettingsService } from "../../services/settings-service";
import type { createIPCHandler } from "electron-trpc-experimental/main";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
declare const WIDGET_WINDOW_VITE_NAME: string;
declare const ONBOARDING_WINDOW_VITE_NAME: string;

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private widgetWindow: BrowserWindow | null = null;
  private onboardingWindow: BrowserWindow | null = null;
  private widgetDisplayId: number | null = null;
  private cursorPollingInterval: NodeJS.Timeout | null = null;
  private themeListenerSetup: boolean = false;

  // On Windows, inset from all edges to allow taskbar auto-hide detection
  private readonly widgetEdgeInset = process.platform === "win32" ? 4 : 0;

  /**
   * Get the correct traffic light position based on macOS version.
   * macOS Tahoe (26+) has larger, redesigned traffic light buttons as part of
   * the "Liquid Glass" design language that require a different y-offset.
   * Electron does not handle this automatically - apps must detect OS version.
   * See: https://github.com/microsoft/vscode/pull/280593
   */
  private getTrafficLightPosition(): { x: number; y: number } {
    if (process.platform !== "darwin") {
      return { x: 20, y: 16 }; // Not used on non-macOS, but return default
    }

    // process.getSystemVersion() returns marketing version (e.g., "26.0.0")
    // vs os.release() which returns Darwin kernel version (e.g., "25.1.0")
    const systemVersion = process.getSystemVersion();
    const majorVersion = parseInt(systemVersion.split(".")[0], 10);
    const isTahoeOrLater = majorVersion >= 26;

    return { x: 20, y: isTahoeOrLater ? 12 : 16 };
  }

  /** Calculate widget bounds with edge inset applied for taskbar auto-hide */
  private getWidgetBounds(workArea: Electron.Rectangle): Electron.Rectangle {
    const inset = this.widgetEdgeInset;
    return {
      x: workArea.x + inset,
      y: workArea.y + inset,
      width: workArea.width - inset * 2,
      height: workArea.height - inset * 2,
    };
  }

  constructor(
    private settingsService: SettingsService,
    private trpcHandler: ReturnType<typeof createIPCHandler>,
  ) {
    logger.main.info("WindowManager created with dependencies");
  }

  private async getThemeColors(): Promise<{
    backgroundColor: string;
    symbolColor: string;
  }> {
    const uiSettings = await this.settingsService.getUISettings();
    const theme = uiSettings?.theme || "system";

    // Determine if we should use dark colors
    let isDark = false;
    if (theme === "dark") {
      isDark = true;
    } else if (theme === "light") {
      isDark = false;
    } else if (theme === "system") {
      isDark = nativeTheme.shouldUseDarkColors;
    }

    // Return appropriate colors
    return isDark
      ? { backgroundColor: "#171717", symbolColor: "#fafafa" }
      : { backgroundColor: "#ffffff", symbolColor: "#171717" };
  }

  async updateAllWindowThemes(): Promise<void> {
    const colors = await this.getThemeColors();

    // Update main window
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setTitleBarOverlay({
        color: colors.backgroundColor,
        symbolColor: colors.symbolColor,
        height: 32,
      });
    }

    // Update onboarding window if it exists
    // Note: onboarding window has frame: false, so no title bar to update

    logger.main.info("Updated window themes", colors);
  }

  private setupThemeListener(): void {
    if (this.themeListenerSetup) return;

    // Listen for system theme changes
    nativeTheme.on("updated", async () => {
      const uiSettings = await this.settingsService.getUISettings();
      const theme = uiSettings?.theme || "system";

      // Only update if theme is set to "system"
      if (theme === "system") {
        await this.updateAllWindowThemes();
        logger.main.info("System theme changed, updating windows");
      }
    });

    this.themeListenerSetup = true;
    logger.main.info("Theme listener setup complete");
  }

  /**
   * Creates a new main window or shows existing one.
   * @param initialRoute - Optional route to navigate to when creating a NEW window.
   *                       This is passed as a URL hash to avoid race conditions where
   *                       the renderer isn't ready to receive IPC navigation events.
   *                       If window already exists, caller should use webContents.send()
   *                       to navigate (renderer is already loaded and listening).
   */
  async createOrShowMainWindow(initialRoute?: string): Promise<void> {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show();
      this.mainWindow.focus();
      return;
    }

    // Setup theme listener on first window creation
    this.setupThemeListener();

    // Get theme colors before creating window
    const colors = await this.getThemeColors();

    const primaryDisplay = screen.getPrimaryDisplay();
    const windowHeight = Math.min(800, primaryDisplay.workAreaSize.height - 40);

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: windowHeight,
      frame: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: colors.backgroundColor,
        symbolColor: colors.symbolColor,
        height: 32,
      },
      trafficLightPosition: this.getTrafficLightPosition(),
      useContentSize: true,
      ...(process.platform === "darwin"
        ? {
            transparent: true,
            vibrancy: "under-window" as const,
            visualEffectState: "active" as const,
            backgroundColor: "#00000000",
          }
        : {}),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Load the window URL, appending initial route as hash if provided
    // This avoids race conditions when the renderer isn't ready for IPC events
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const url = initialRoute
        ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#${initialRoute}`
        : MAIN_WINDOW_VITE_DEV_SERVER_URL;
      this.mainWindow.loadURL(url);
    } else {
      this.mainWindow.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
        initialRoute ? { hash: initialRoute } : undefined,
      );
    }

    this.mainWindow.on("close", () => {
      // Detach window before it's destroyed
      this.trpcHandler.detachWindow(this.mainWindow!);
    });

    this.mainWindow.on("closed", () => {
      // Window is already destroyed, just clean up reference
      this.mainWindow = null;
    });

    this.trpcHandler.attachWindow(this.mainWindow!);
  }

  async createWidgetWindow(): Promise<void> {
    const mainScreen = screen.getPrimaryDisplay();
    const widgetBounds = this.getWidgetBounds(mainScreen.workArea);

    logger.main.info("Creating widget window", {
      display: mainScreen.id,
      workArea: mainScreen.workArea,
      widgetBounds,
      edgeInset: this.widgetEdgeInset,
    });

    this.widgetWindow = new BrowserWindow({
      show: false,
      ...widgetBounds,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      // prevent main window from gaining focus upon clicks on widget
      ...(process.platform === "darwin" && { type: "panel" }),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    this.widgetDisplayId = mainScreen.id;

    // Set ignore mouse events with forward option - clicks go through except on widget
    this.widgetWindow.setIgnoreMouseEvents(true, { forward: true });

    logger.main.info("Widget window created", {
      bounds: this.widgetWindow.getBounds(),
      isVisible: this.widgetWindow.isVisible(),
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const devUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      devUrl.pathname = "widget.html";
      logger.main.info("Loading widget from dev server", devUrl.toString());
      this.widgetWindow.loadURL(devUrl.toString());
    } else {
      const widgetPath = path.join(
        __dirname,
        `../renderer/${WIDGET_WINDOW_VITE_NAME}/widget.html`,
      );
      logger.main.info("Loading widget from file", widgetPath);
      this.widgetWindow.loadFile(widgetPath);
    }

    this.widgetWindow.on("close", () => {
      // Detach window before it's destroyed
      this.trpcHandler.detachWindow(this.widgetWindow!);
    });

    this.widgetWindow.on("closed", () => {
      // Window is already destroyed, just clean up reference
      this.widgetWindow = null;
    });

    if (process.platform === "darwin") {
      this.widgetWindow.setAlwaysOnTop(true, "floating", 1);
      this.widgetWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
      this.widgetWindow.setHiddenInMissionControl(true);
    } else if (process.platform === "win32") {
      // On Windows, use "screen-saver" level for maximum z-order priority
      // to stay above other app toolbars/menus. The widget window is inset
      // from screen edges to allow taskbar auto-hide detection.
      // See: https://github.com/electron/electron/issues/11830
      this.widgetWindow.setAlwaysOnTop(true, "screen-saver");
    }

    // Set up display change notifications for all platforms
    this.setupDisplayChangeNotifications();

    // Update tRPC handler with new window
    this.trpcHandler.attachWindow(this.widgetWindow!);

    logger.main.info(
      "Widget window created (visibility controlled by AppManager)",
    );
  }

  async createOrShowOnboardingWindow(): Promise<void> {
    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
      this.onboardingWindow.show();
      this.onboardingWindow.focus();
      return;
    }

    // Setup theme listener if not already done
    this.setupThemeListener();

    // Get theme colors before creating window
    const colors = await this.getThemeColors();

    const primaryDisplay = screen.getPrimaryDisplay();
    const windowHeight = Math.min(928, primaryDisplay.workAreaSize.height - 40);

    this.onboardingWindow = new BrowserWindow({
      width: 800,
      height: windowHeight,
      frame: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: colors.backgroundColor,
        symbolColor: colors.symbolColor,
        height: 32,
      },
      trafficLightPosition: this.getTrafficLightPosition(),
      resizable: false,
      center: true,
      modal: true,
      webPreferences: {
        preload: path.join(__dirname, "onboarding-preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const devUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      devUrl.pathname = "onboarding.html";
      this.onboardingWindow.loadURL(devUrl.toString());
    } else {
      this.onboardingWindow.loadFile(
        path.join(
          __dirname,
          `../renderer/${ONBOARDING_WINDOW_VITE_NAME}/onboarding.html`,
        ),
      );
    }

    this.onboardingWindow.on("close", () => {
      this.trpcHandler.detachWindow(this.onboardingWindow!);
    });

    this.onboardingWindow.on("closed", () => {
      this.onboardingWindow = null;
    });

    // Disable main window while onboarding is open
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setEnabled(false);
    }

    this.trpcHandler.attachWindow(this.onboardingWindow!);
    logger.main.info("Onboarding window created");
  }

  closeOnboardingWindow(): void {
    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
      this.onboardingWindow.close();
    }

    // Re-enable main window
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setEnabled(true);
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  showWidget(): void {
    if (this.widgetWindow && !this.widgetWindow.isDestroyed()) {
      this.widgetWindow.showInactive();
    }
  }

  hideWidget(): void {
    if (this.widgetWindow && !this.widgetWindow.isDestroyed()) {
      this.widgetWindow.hide();
    }
  }

  private setupDisplayChangeNotifications(): void {
    // Set up comprehensive display event listeners
    screen.on("display-added", () => this.handleDisplayChange("display-added"));
    screen.on("display-removed", () =>
      this.handleDisplayChange("display-removed"),
    );
    screen.on("display-metrics-changed", () =>
      this.handleDisplayChange("display-metrics-changed"),
    );

    // Set up focus-based display detection
    this.setupFocusBasedDisplayDetection();

    // Set up cursor polling to detect when user moves to different display
    // we want to avoid polling mechanisms, we will get back to this if current soln doesn't work
    // this.startCursorPolling();

    // macOS-specific workspace change notifications
    if (process.platform === "darwin") {
      try {
        systemPreferences.subscribeWorkspaceNotification(
          "NSWorkspaceActiveDisplayDidChangeNotification",
          () => {
            this.handleDisplayChange("workspace-change");
          },
        );
      } catch (error) {
        logger.main.warn(
          "Failed to subscribe to workspace notifications:",
          error,
        );
      }
    }

    logger.main.info("Set up display change event listeners");
  }

  private setupFocusBasedDisplayDetection(): void {
    // Listen for any window focus events to detect active display changes
    app.on("browser-window-focus", (_event, window) => {
      if (!window || window.isDestroyed()) return;

      // Get the display where the focused window is located
      const focusedWindowDisplay = screen.getDisplayMatching(
        window.getBounds(),
      );

      if (focusedWindowDisplay.id === this.widgetDisplayId) {
        return;
      }

      // If the focused window is on a different display than our current one
      logger.main.info("Active display changed due to window focus", {
        previousDisplayId: this.widgetDisplayId,
        newDisplayId: focusedWindowDisplay.id,
      });

      this.widgetDisplayId = focusedWindowDisplay.id;

      // Update widget window bounds to new display
      if (this.widgetWindow && !this.widgetWindow.isDestroyed()) {
        this.widgetWindow.setBounds(
          this.getWidgetBounds(focusedWindowDisplay.workArea),
        );
      }
    });
  }

  private startCursorPolling(): void {
    // Poll cursor position every 500ms to detect display changes
    this.cursorPollingInterval = setInterval(() => {
      if (!this.widgetWindow || this.widgetWindow.isDestroyed()) return;

      const cursorPoint = screen.getCursorScreenPoint();
      const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint);

      if (cursorDisplay.id === this.widgetDisplayId) {
        return;
      }

      // If cursor moved to a different display
      logger.main.info("Active display changed due to cursor movement", {
        previousDisplayId: this.widgetDisplayId,
        newDisplayId: cursorDisplay.id,
        cursorPoint,
      });

      this.widgetDisplayId = cursorDisplay.id;

      // Update widget window bounds to new display
      this.widgetWindow.setBounds(this.getWidgetBounds(cursorDisplay.workArea));
    }, 500); // Poll every 500ms

    logger.main.info("Started cursor polling for display detection");
  }

  private handleDisplayChange(event: string): void {
    logger.main.debug("handleDisplayChange", { event });

    if (!this.widgetWindow || this.widgetWindow.isDestroyed()) return;

    // Get the current display based on cursor position
    const cursorPoint = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);

    // Update window bounds to match new display's work area
    this.widgetWindow.setBounds(this.getWidgetBounds(currentDisplay.workArea));
    this.widgetDisplayId = currentDisplay.id;
    logger.main.info("Display configuration changed", {
      displayId: currentDisplay.id,
      workArea: currentDisplay.workArea,
      event,
    });
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  getWidgetWindow(): BrowserWindow | null {
    return this.widgetWindow;
  }

  getOnboardingWindow(): BrowserWindow | null {
    return this.onboardingWindow;
  }

  getAllWindows(): (BrowserWindow | null)[] {
    return [this.mainWindow, this.widgetWindow, this.onboardingWindow];
  }

  openAllDevTools(): void {
    const windows = this.getAllWindows().filter(
      (window): window is BrowserWindow =>
        window !== null && !window.isDestroyed(),
    );

    windows.forEach((window) => {
      if (window.webContents && !window.webContents.isDevToolsOpened()) {
        window.webContents.openDevTools();
      }
    });

    logger.main.info(`Opened dev tools for ${windows.length} windows`);
  }

  cleanup(): void {
    // Stop cursor polling
    if (this.cursorPollingInterval) {
      clearInterval(this.cursorPollingInterval);
      this.cursorPollingInterval = null;
      logger.main.info("Stopped cursor polling");
    }

    // Remove display event listeners
    screen.removeAllListeners("display-added");
    screen.removeAllListeners("display-removed");
    screen.removeAllListeners("display-metrics-changed");

    // Remove focus event listener
    app.removeAllListeners("browser-window-focus");

    logger.main.info("Cleaned up display and focus event listeners");
  }
}
