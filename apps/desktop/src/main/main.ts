import dotenv from "dotenv";
dotenv.config();

import { app } from "electron";

import started from "electron-squirrel-startup";
import { AppManager } from "./core/app-manager";
import { updateElectronApp } from "update-electron-app";
import { isWindows } from "../utils/platform";

if (started) {
  app.quit();
}

// Set App User Model ID for Windows (required for Squirrel.Windows)
if (isWindows()) {
  app.setAppUserModelId("com.amical.desktop");
}

// Register the amical:// protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("amical", process.execPath, [
      process.argv[1],
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("amical");
}

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
}

// Set up auto-updater for production builds
if (app.isPackaged && !isWindows()) {
  updateElectronApp();
}
if (app.isPackaged && isWindows()) {
  // Check if running with --squirrel-firstrun (Windows only)
  const isSquirrelFirstRun = process.argv.includes("--squirrel-firstrun");
  // Delay update check on Windows to avoid Squirrel file lock issues
  if (isWindows() && !isSquirrelFirstRun) {
    setTimeout(() => {
      updateElectronApp();
    }, 60000); // 60 second delay
  }
}

const appManager = new AppManager();

// Store the deep link URL for processing after app is ready
let deeplinkingUrl: string | null = null;

// Handle protocol on macOS
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    appManager.handleDeepLink(url);
  } else {
    deeplinkingUrl = url;
  }
});

// Handle when another instance tries to start (Windows/Linux deep link handling)
app.on("second-instance", (_event, commandLine) => {
  // Someone tried to run a second instance, we should focus our window instead.
  appManager.handleSecondInstance();

  // Check if this is a protocol launch on Windows/Linux
  const url = commandLine.find((arg) => arg.startsWith("amical://"));
  if (url) {
    appManager.handleDeepLink(url);
  }
});

app.whenReady().then(() => {
  appManager.initialize();

  // Process any deep link that was received before app was ready
  if (deeplinkingUrl) {
    appManager.handleDeepLink(deeplinkingUrl);
    deeplinkingUrl = null;
  }
});
app.on("will-quit", () => appManager.cleanup());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => appManager.handleActivate());
