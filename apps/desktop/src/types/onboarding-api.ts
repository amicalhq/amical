export interface OnboardingAPI {
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
