import process from "node:process";

/**
 * Platform detection utilities
 */

export type Platform = "darwin" | "win32" | "linux";

export function getPlatform(): Platform {
  return process.platform as Platform;
}

export function isWindows(): boolean {
  return process.platform === "win32";
}

export function isMacOS(): boolean {
  return process.platform === "darwin";
}

export function isLinux(): boolean {
  return process.platform === "linux";
}

/**
 * Get the native helper name for the current platform
 */
export function getNativeHelperName(): string {
  return isWindows() ? "WindowsHelper.exe" : "SwiftHelper";
}

/**
 * Get the native helper directory name for the current platform
 */
export function getNativeHelperDir(): string {
  return isWindows() ? "windows-helper" : "swift-helper";
}

/**
 * Get a platform-specific display name
 */
export function getPlatformDisplayName(): string {
  switch (process.platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return process.platform;
  }
}
