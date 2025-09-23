import dotenv from "dotenv";
dotenv.config();

import { app } from "electron";

import started from "electron-squirrel-startup";
import { AppManager } from "./core/app-manager";
import { updateElectronApp } from "update-electron-app";

if (started) {
  app.quit();
}

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock && process.env.TESTING !== "true") {
  // Another instance is already running, quit this one
  app.quit();
}

// Set up auto-updater for production builds
if (app.isPackaged) {
  updateElectronApp();
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
