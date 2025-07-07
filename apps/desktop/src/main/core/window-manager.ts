import { BrowserWindow, screen, systemPreferences, app } from "electron";
import path from "node:path";
import { logger } from "../logger";
import { ServiceManager } from "../managers/service-manager";

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

  createOrShowMainWindow(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show();
      this.mainWindow.focus();
      return;
    }

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      frame: true,
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 20, y: 16 },
      useContentSize: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      this.mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      this.mainWindow.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      );
    }

    this.mainWindow.on("close", () => {
      // Detach window before it's destroyed
      ServiceManager.getInstance()!
        .getTRPCHandler()!
        .detachWindow(this.mainWindow!);
    });

    this.mainWindow.on("closed", () => {
      // Window is already destroyed, just clean up reference
      this.mainWindow = null;
    });

    ServiceManager.getInstance()!
      .getTRPCHandler()!
      .attachWindow(this.mainWindow!);
  }

  createWidgetWindow(): void {
    const mainScreen = screen.getPrimaryDisplay();
    const { width, height } = mainScreen.workAreaSize;

    logger.main.info("Creating widget window", {
      display: mainScreen.id,
      workArea: mainScreen.workArea,
      size: { width, height },
    });

    this.widgetWindow = new BrowserWindow({
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
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
      ServiceManager.getInstance()!
        .getTRPCHandler()!
        .detachWindow(this.widgetWindow!);
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
    }

    // Set up display change notifications for all platforms
    this.setupDisplayChangeNotifications();

    // Update tRPC handler with new window
    ServiceManager.getInstance()!
      .getTRPCHandler()!
      .attachWindow(this.widgetWindow!);

    // Show the widget window
    this.widgetWindow.show();
    logger.main.info("Widget window shown");
  }

  createOnboardingWindow(): void {
    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
      this.onboardingWindow.show();
      this.onboardingWindow.focus();
      return;
    }

    this.onboardingWindow = new BrowserWindow({
      width: 700,
      height: 600,
      frame: false,
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

    this.onboardingWindow.on("closed", () => {
      this.onboardingWindow = null;
    });

    // Disable main window while onboarding is open
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setEnabled(false);
    }

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
        this.widgetWindow.setBounds(focusedWindowDisplay.workArea);
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
      this.widgetWindow.setBounds(cursorDisplay.workArea);
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
    this.widgetWindow.setBounds(currentDisplay.workArea);
    this.widgetDisplayId = currentDisplay.id;

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
