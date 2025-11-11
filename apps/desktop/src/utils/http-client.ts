import { app } from "electron";
import { getPlatformDisplayName } from "./platform";

/**
 * Get the User-Agent string for HTTP requests
 * Format: amical-desktop/{version} ({platform})
 * Example: amical-desktop/0.1.3 (macOS)
 */
export function getUserAgent(): string {
  const version = app.getVersion();
  const platform = getPlatformDisplayName();
  return `amical-desktop/${version} (${platform})`;
}
