import { exposeElectronTRPC } from "electron-trpc-experimental/preload";

/**
 * Onboarding preload script
 * Exposes tRPC for type-safe communication with main process
 * All onboarding operations now use tRPC instead of traditional IPC
 */

// Expose tRPC for electron-trpc-experimental
process.once("loaded", async () => {
  exposeElectronTRPC();
});
