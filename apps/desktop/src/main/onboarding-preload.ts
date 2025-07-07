import { contextBridge, ipcRenderer } from "electron";
import { exposeElectronTRPC } from "electron-trpc-experimental/preload";

interface OnboardingAPI {
  // Permission checks
  checkMicrophonePermission: () => Promise<string>;
  checkAccessibilityPermission: () => Promise<boolean>;

  // Permission requests
  requestMicrophonePermission: () => Promise<boolean>;
  requestAccessibilityPermission: () => Promise<void>;

  // Navigation
  completeOnboarding: () => Promise<void>;

  // Window controls
  quitApp: () => Promise<void>;

  // System info
  getPlatform: () => Promise<string>;

  // External links
  openExternal: (url: string) => Promise<void>;

  // Logging
  log: {
    error: (...args: any[]) => Promise<void>;
  };
}

const api: OnboardingAPI = {
  // Permission checks
  checkMicrophonePermission: () =>
    ipcRenderer.invoke("onboarding:check-microphone-permission"),

  checkAccessibilityPermission: () =>
    ipcRenderer.invoke("onboarding:check-accessibility-permission"),

  // Permission requests
  requestMicrophonePermission: () =>
    ipcRenderer.invoke("onboarding:request-microphone-permission"),

  requestAccessibilityPermission: () =>
    ipcRenderer.invoke("onboarding:request-accessibility-permission"),

  // Navigation
  completeOnboarding: () => ipcRenderer.invoke("onboarding:complete"),

  // Window controls
  quitApp: () => ipcRenderer.invoke("onboarding:quit-app"),

  // System info
  getPlatform: () => ipcRenderer.invoke("onboarding:get-platform"),

  // External links
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),

  // Logging
  log: {
    error: (...args: any[]) =>
      ipcRenderer.invoke("log-message", "error", "onboarding", ...args),
  },
};

contextBridge.exposeInMainWorld("onboardingAPI", api);

// Expose tRPC for electron-trpc-experimental
process.once("loaded", async () => {
  exposeElectronTRPC();
});
