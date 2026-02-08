import dotenv from "dotenv";
dotenv.config();

import { app, ipcMain } from "electron";
import { logger } from "./logger";

import started from "electron-squirrel-startup";
import { AppManager } from "./core/app-manager";
import { updateElectronApp } from "update-electron-app";
import { isWindows } from "../utils/platform";

// Setup renderer logging relay (allows renderer to send logs to main process)
ipcMain.handle(
  "log-message",
  (_event, level: string, scope: string, ...args: unknown[]) => {
    const scopedLogger =
      logger[scope as keyof typeof logger] || logger.renderer;
    const logMethod = scopedLogger[level as keyof typeof scopedLogger];
    if (typeof logMethod === "function") {
      logMethod(...args);
    }
  },
);

if (started) {
  app.quit();
}

// Set App User Model ID for Windows (required for Squirrel.Windows)
if (isWindows()) {
  app.setAppUserModelId("com.grizzo.desktop");
}

// Register the grizzo:// protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("grizzo", process.execPath, [
      process.argv[1],
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("grizzo");
}

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
}

// Set up auto-updater for production builds
if (app.isPackaged && !isWindows()) {
  updateElectronApp({
    notifyUser: false,
  });
}
if (app.isPackaged && isWindows()) {
  // Check if running with --squirrel-firstrun (Windows only)
  const isSquirrelFirstRun = process.argv.includes("--squirrel-firstrun");
  // Delay update check on Windows to avoid Squirrel file lock issues
  if (isWindows() && !isSquirrelFirstRun) {
    setTimeout(() => {
      updateElectronApp({
        notifyUser: false,
      });
    }, 60000); // 60 second delay
  }
}

const appManager = new AppManager();

// Track initialization state for deep link handling
let isInitialized = false;
let pendingDeepLink: string | null = null;

// Handle protocol on macOS
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (isInitialized) {
    appManager.handleDeepLink(url);
  } else {
    pendingDeepLink = url;
  }
});

// Handle when another instance tries to start (Windows/Linux deep link handling)
app.on("second-instance", (_event, commandLine) => {
  // Someone tried to run a second instance, we should focus our window instead.
  if (isInitialized) {
    appManager.handleSecondInstance();
  }

  // Check if this is a protocol launch on Windows/Linux
  const url = commandLine.find((arg) => arg.startsWith("grizzo://"));
  if (url) {
    if (isInitialized) {
      appManager.handleDeepLink(url);
    } else {
      pendingDeepLink = url;
    }
  }
});

app.whenReady().then(async () => {
  await appManager.initialize();
  isInitialized = true;

  // Process any deep link that was received before initialization completed
  if (pendingDeepLink) {
    appManager.handleDeepLink(pendingDeepLink);
    pendingDeepLink = null;
  }
});
app.on("will-quit", () => appManager.cleanup());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => appManager.handleActivate());
