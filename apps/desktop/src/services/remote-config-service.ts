import { app } from "electron";

import { logger } from "../main/logger";
import { RemoteConfigSchema, type RemoteConfig } from "@/types/remote-config";
import {
  AMICAL_DEVICE_ID_HEADER,
  getAmicalClientHeaders,
  getCoreApiUrl,
  getUserAgent,
} from "../utils/http-client";
import type { AuthService } from "./auth-service";
import type { SettingsService } from "./settings-service";
import type { TelemetryService } from "./telemetry-service";
import { getApplicationLocale } from "../i18n/application-locale";

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
export const DESKTOP_BACKGROUND_UPDATES_FLAG = "desktop-background-updates";

export type DesktopRemoteConfig = Omit<RemoteConfig, "flags"> & {
  flags: NonNullable<RemoteConfig["flags"]> &
    Record<typeof DESKTOP_BACKGROUND_UPDATES_FLAG, boolean>;
};

const resolveRemoteConfig = (config: RemoteConfig): DesktopRemoteConfig => ({
  ...config,
  flags: {
    [DESKTOP_BACKGROUND_UPDATES_FLAG]: true,
    ...(config.flags ?? {}),
  },
});

const EMPTY_CONFIG = resolveRemoteConfig({ version: 1, surfaces: [] });

/**
 * Fetches the server-controlled remote-config envelope (banner / side-slot
 * surfaces, plus future config domains) from amical-core, persists it for
 * instant + offline render, and refreshes on launch + interval + auth change.
 * Modeled on FeatureFlagService. The call runs in all cases (signed in or not);
 * the server decides what to return per auth state, so the request carries the
 * client context (platform / version / locale), the anonymous per-install device
 * id, and the user's bearer token only when signed in.
 */
export class RemoteConfigService {
  private authService: AuthService;
  private settingsService: SettingsService;
  private telemetryService: TelemetryService;

  private config: DesktopRemoteConfig = EMPTY_CONFIG;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshPromise: Promise<void> | null = null;
  // Bumped on identity change; an in-flight refresh whose generation no longer
  // matches discards its result, so a pre-change fetch can't clobber the reset.
  private generation = 0;

  constructor(
    authService: AuthService,
    settingsService: SettingsService,
    telemetryService: TelemetryService,
  ) {
    this.authService = authService;
    this.settingsService = settingsService;
    this.telemetryService = telemetryService;
  }

  async initialize(): Promise<void> {
    // Load the persisted envelope first (fast, no network).
    const lastFetchedAt = await this.loadPersisted();

    const isStale =
      !lastFetchedAt ||
      Date.now() - new Date(lastFetchedAt).getTime() > REFRESH_INTERVAL_MS;

    if (isStale) {
      this.refresh().catch((err) => {
        logger.main.error("Startup remote config refresh failed:", err);
      });
    }

    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) => {
        logger.main.error("Periodic remote config refresh failed:", err);
      });
    }, REFRESH_INTERVAL_MS);
  }

  async shutdown(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  getConfig(): DesktopRemoteConfig {
    return this.config;
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Identity changed (sign in / out). The cached config may be targeted to the
   * previous identity, so drop it (memory + persisted cache) and refetch for the
   * new one. Bumping the generation invalidates any in-flight refresh so it
   * can't write the previous identity's surfaces over the cleared state.
   */
  async resetForIdentityChange(): Promise<void> {
    this.generation += 1;
    this.config = EMPTY_CONFIG;
    await this.settingsService.setRemoteConfig({ config: EMPTY_CONFIG });
    // doRefresh directly (not refresh) to force a fresh fetch for the new
    // identity rather than piggyback an in-flight one for the old.
    await this.doRefresh();
  }

  private async doRefresh(): Promise<void> {
    const generation = this.generation;
    try {
      const url = getCoreApiUrl("/remote-config");
      url.searchParams.set("platform", process.platform);
      url.searchParams.set("version", app.getVersion());
      url.searchParams.set("locale", getApplicationLocale());

      // Runs in all cases — the server decides what (if anything) to return per
      // auth state. Attach the bearer token only when signed in, plus the
      // anonymous per-install device id (for staged-rollout bucketing), the same
      // id the auto-updater sends.
      const idToken = await this.authService.getIdToken();
      const deviceId = this.telemetryService.getMachineId();

      const headers: Record<string, string> = {
        "User-Agent": getUserAgent(),
        ...getAmicalClientHeaders(),
      };
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }
      if (deviceId) {
        headers[AMICAL_DEVICE_ID_HEADER] = deviceId;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        logger.main.warn("Remote config fetch failed", {
          status: response.status,
        });
        return;
      }

      // The payload is untrusted; validate at the boundary and keep the last
      // good config on failure (fail-closed on bad data).
      const parsed = RemoteConfigSchema.safeParse(await response.json());
      if (!parsed.success) {
        logger.main.error("Remote config failed validation", {
          issues: parsed.error.issues,
        });
        return;
      }

      // Identity changed while this fetch was in flight — drop it so it can't
      // write the previous identity's surfaces.
      if (this.generation !== generation) {
        return;
      }

      await this.setConfig(parsed.data);

      logger.main.info("Remote config refreshed", {
        surfaces: parsed.data.surfaces?.length ?? 0,
      });
    } catch (err) {
      logger.main.error("Failed to refresh remote config:", err);
    }
  }

  // Update the in-memory config and the persisted cache together.
  private async setConfig(config: RemoteConfig): Promise<void> {
    const resolvedConfig = resolveRemoteConfig(config);
    this.config = resolvedConfig;
    await this.settingsService.setRemoteConfig({
      config: resolvedConfig,
      lastFetchedAt: new Date().toISOString(),
    });
  }

  /**
   * Returns lastFetchedAt if a persisted config was found, null otherwise.
   */
  private async loadPersisted(): Promise<string | null> {
    try {
      const persisted = await this.settingsService.getRemoteConfig();
      if (persisted?.config) {
        const parsed = RemoteConfigSchema.safeParse(persisted.config);
        if (!parsed.success) {
          logger.main.error("Persisted remote config failed validation", {
            issues: parsed.error.issues,
          });
          return null;
        }
        this.config = resolveRemoteConfig(parsed.data);
        return persisted.lastFetchedAt ?? null;
      }
      return null;
    } catch (err) {
      logger.main.error("Failed to load persisted remote config:", err);
      return null;
    }
  }
}
