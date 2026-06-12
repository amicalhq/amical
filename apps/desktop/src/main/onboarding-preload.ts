import { contextBridge } from "electron";
import { exposeElectronTRPC } from "electron-trpc-experimental/preload";

/**
 * Onboarding preload script
 * Exposes tRPC for type-safe communication with main process
 * All onboarding operations now use tRPC instead of traditional IPC
 */

// Expose platform info. (Audio capture during the dictation try-it happens in
// the widget window, exactly as in production — no audio bridge needed here.)
contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
});

// Expose tRPC for electron-trpc-experimental
process.once("loaded", async () => {
  exposeElectronTRPC();
});
