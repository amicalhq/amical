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

// Handle when another instance tries to start
app.on("second-instance", () => {
  // Someone tried to run a second instance, we should focus our window instead.
  appManager.handleSecondInstance();
});

app.whenReady().then(() => appManager.initialize());
app.on("will-quit", () => appManager.cleanup());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => appManager.handleActivate());
