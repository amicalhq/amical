/**
 * Platform detection utilities
 */

export type Platform = NodeJS.Platform;

function getRendererPlatform(): Platform | undefined {
  if (typeof window === "undefined") return undefined;
  return window.electronAPI?.platform;
}

function getNodePlatform(): Platform | undefined {
  if (typeof process === "undefined") return undefined;
  return process.platform;
}

export function getPlatform(): Platform {
  return getRendererPlatform() ?? getNodePlatform() ?? ("unknown" as Platform);
}

export function isWindows(): boolean {
  return getPlatform() === "win32";
}

export function isMacOS(): boolean {
  return getPlatform() === "darwin";
}

export function isLinux(): boolean {
  return getPlatform() === "linux";
}

/**
 * Pick the value for the current platform. Every supported platform needs an
 * arm, so a new platform cannot fall into another platform's branch. An
 * unsupported platform gets the macOS arm.
 */
export function matchPlatform<T>(
  arms: Record<"darwin" | "win32" | "linux", T>,
): T {
  const platform = getPlatform();
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return arms[platform];
  }
  return arms.darwin;
}

/**
 * Desktop-file id of the Linux package: the reverse-DNS id of the macOS
 * bundle. The portals, the URL handler and the package names use it.
 */
export const LINUX_APP_ID = "ai.amical.desktop";

/**
 * Get the native helper name for the current platform
 */
export function getNativeHelperName(): string {
  return matchPlatform({
    darwin: "SwiftHelper",
    win32: "WindowsHelper.exe",
    linux: "linux-helper",
  });
}

/**
 * Get the native helper directory name for the current platform
 */
export function getNativeHelperDir(): string {
  return matchPlatform({
    darwin: "swift-helper",
    win32: "windows-helper",
    linux: "linux-helper",
  });
}

/**
 * Get a platform-specific display name
 */
export function getPlatformDisplayName(): string {
  const platform = getPlatform();
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}
