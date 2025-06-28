import { BrowserWindow, screen, systemPreferences } from "electron";
import path from "node:path";
import { logger } from "../logger";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
declare const WIDGET_WINDOW_VITE_NAME: string;

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private widgetWindow: BrowserWindow | null = null;
  private currentWindowDisplayId: number | null = null;
  private activeSpaceChangeSubscriptionId: number | null = null;
  private onMainWindowCreated?: (window: BrowserWindow) => void;

  createOrShowMainWindow(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show();
      this.mainWindow.focus();
      return;
    }

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      frame: false,
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

    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
    });

    if (this.onMainWindowCreated) {
      this.onMainWindowCreated(this.mainWindow);
    }
  }

  createWidgetWindow(): void {
    const mainScreen = screen.getPrimaryDisplay();
    const { width, height } = mainScreen.workAreaSize;

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

    this.currentWindowDisplayId = mainScreen.id;
    this.widgetWindow.setIgnoreMouseEvents(true, { forward: true });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const devUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      devUrl.pathname = "widget.html";
      this.widgetWindow.loadURL(devUrl.toString());
    } else {
      this.widgetWindow.loadFile(
        path.join(
          __dirname,
          `../renderer/${WIDGET_WINDOW_VITE_NAME}/widget.html`,
        ),
      );
    }

    if (process.platform === "darwin") {
      this.widgetWindow.setAlwaysOnTop(true, "floating", 1);
      this.widgetWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
      this.widgetWindow.setHiddenInMissionControl(true);
      this.setupDisplayChangeNotifications();
    }
  }

  private setupDisplayChangeNotifications(): void {
    if (process.platform !== "darwin") return;

    try {
      this.activeSpaceChangeSubscriptionId =
        systemPreferences.subscribeWorkspaceNotification(
          "NSWorkspaceActiveDisplayDidChangeNotification",
          () => {
            if (this.widgetWindow && !this.widgetWindow.isDestroyed()) {
              try {
                const cursorPoint = screen.getCursorScreenPoint();
                const displayForCursor =
                  screen.getDisplayNearestPoint(cursorPoint);
                if (this.currentWindowDisplayId !== displayForCursor.id) {
                  logger.main.info("Moving floating window to display", {
                    displayId: displayForCursor.id,
                  });
                  this.widgetWindow.setBounds(displayForCursor.workArea);
                  this.currentWindowDisplayId = displayForCursor.id;
                }
              } catch (error) {
                logger.main.warn("Error handling display change:", error);
              }
            }
          },
        );

      if (
        this.activeSpaceChangeSubscriptionId !== undefined &&
        this.activeSpaceChangeSubscriptionId >= 0
      ) {
        logger.main.info(
          "Successfully subscribed to display change notifications",
        );
      } else {
        logger.main.error(
          "Failed to subscribe to display change notifications",
        );
      }
    } catch (error) {
      logger.main.error(
        "Error during subscription to display notifications:",
        error,
      );
      this.activeSpaceChangeSubscriptionId = null;
    }
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  getWidgetWindow(): BrowserWindow | null {
    return this.widgetWindow;
  }

  getAllWindows(): (BrowserWindow | null)[] {
    return [this.mainWindow, this.widgetWindow];
  }

  setMainWindowCreatedCallback(
    callback: (window: BrowserWindow) => void,
  ): void {
    this.onMainWindowCreated = callback;
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
    if (
      process.platform === "darwin" &&
      this.activeSpaceChangeSubscriptionId !== null
    ) {
      systemPreferences.unsubscribeWorkspaceNotification(
        this.activeSpaceChangeSubscriptionId,
      );
      logger.main.info("Unsubscribed from display change notifications");
      this.activeSpaceChangeSubscriptionId = null;
    }
  }
}
