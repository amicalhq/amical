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
export const AMICAL_LABS_HEADER = "amical-labs";
export const AMICAL_LAB_SELF_CORRECTION = "self-correction";
// Anonymous, stable per-install id (the telemetry machineId) used by the update
// server to bucket installs for staged rollouts. Added per request, not part of
// the frozen client headers above, because it depends on the runtime machineId.
export const AMICAL_DEVICE_ID_HEADER = "amical-device-id";

const AMICAL_LAB_TOKEN_PATTERN = /^[A-Za-z0-9._~-]+(?:=[A-Za-z0-9._~-]+)?$/;

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

export function buildAmicalLabsHeader(
  labs: readonly string[],
): string | undefined {
  const tokens = [...new Set(labs.map((lab) => lab.trim()))].filter(
    (lab) => lab.length > 0 && AMICAL_LAB_TOKEN_PATTERN.test(lab),
  );

  return tokens.length > 0 ? tokens.join(",") : undefined;
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

/**
 * Resolve a path against the amical-core base URL (e.g. /remote-config, /me/*).
 * Read from CORE_API_URL rather than derived from the auth token endpoint, so
 * callers don't depend on AuthService for the origin. (AuthService still derives
 * its own /api/auth/* endpoints from the token endpoint.)
 */
export function getCoreApiUrl(path: string): URL {
  return new URL(path, process.env.CORE_API_URL || __BUNDLED_CORE_API_URL);
}
