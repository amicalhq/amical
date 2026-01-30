import { app } from "electron";
import { getPlatformDisplayName } from "./platform";

/**
 * Get the User-Agent string for HTTP requests
 * Format: vox-desktop/{version} ({platform})
 * Example: vox-desktop/0.1.3 (macOS)
 */
export function getUserAgent(): string {
  const version = app.getVersion();
  const platform = getPlatformDisplayName();
  return `vox-desktop/${version} (${platform})`;
}
