import dotenv from "dotenv";
dotenv.config();

import { app } from "electron";
import * as path from "path";
import * as fs from "fs";

// Set GGML_METAL_PATH_RESOURCES before any other imports
// This ensures @amical/whisper-wrapper can find its resources when unpacked from asar
if (app.isPackaged) {
  const metalResources = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@amical",
    "whisper-wrapper",
    "whisper.cpp",
  );

  if (fs.existsSync(metalResources)) {
    process.env.GGML_METAL_PATH_RESOURCES = metalResources;
  } else {
    delete process.env.GGML_METAL_PATH_RESOURCES;
  }
}
import started from "electron-squirrel-startup";
import { AppManager } from "./core/app-manager";
import { updateElectronApp } from "update-electron-app";

if (started) {
  app.quit();
}

// Set up auto-updater for production builds
if (app.isPackaged) {
  updateElectronApp();
}

const appManager = new AppManager();

app.whenReady().then(() => appManager.initialize());
app.on("will-quit", () => appManager.cleanup());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => appManager.handleActivate());
