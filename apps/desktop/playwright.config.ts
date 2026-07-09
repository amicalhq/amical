import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.artifacts",
  // Snapshot/restore machine state (login items) the app mutates at startup.
  globalSetup: "./e2e/helpers/global-setup.ts",
  globalTeardown: "./e2e/helpers/global-teardown.ts",
  // Startup covers DB migrations and service init; keep generous headroom.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // One Electron instance at a time — each launch is a full app boot.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
});
