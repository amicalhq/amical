import { app } from "electron";
import { getPlatformDisplayName } from "./platform";

export interface AmicalClientInfo {
  client: "desktop";
  version: string;
  platform: NodeJS.Platform;
}

export const AMICAL_CLIENT_HEADER = "amical-client";
export const AMICAL_VERSION_HEADER = "amical-version";
export const AMICAL_PLATFORM_HEADER = "amical-platform";

const AMICAL_CLIENT_INFO: AmicalClientInfo = {
  client: "desktop",
  version: app.getVersion(),
  platform: process.platform,
};

const AMICAL_CLIENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  [AMICAL_CLIENT_HEADER]: AMICAL_CLIENT_INFO.client,
  [AMICAL_VERSION_HEADER]: AMICAL_CLIENT_INFO.version,
  [AMICAL_PLATFORM_HEADER]: AMICAL_CLIENT_INFO.platform,
});

export function getAmicalClientInfo(): AmicalClientInfo {
  return AMICAL_CLIENT_INFO;
}

export function getAmicalClientHeaders(): Readonly<Record<string, string>> {
  return AMICAL_CLIENT_HEADERS;
}

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
