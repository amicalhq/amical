import { Effect, Layer } from "effect";

import { logger } from "../main/logger";
import {
  FeatureFlagServiceTag,
  PostHogClientTag,
  SettingsServiceTag,
  TelemetryServiceTag,
  AppScopeTag,
} from "../main/runtime/tags";
import { addRelease, step, up } from "../main/runtime/layer-helpers";
import type { PostHogClient } from "./posthog-client";
import type { SettingsService } from "./settings-service";

const FLAG_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day

export class FeatureFlagService {
  private client: PostHogClient;
  private settingsService: SettingsService;

  private flags: Record<string, string | boolean> = {};
  private payloads: Record<string, unknown> = {};
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshPromise: Promise<void> | null = null;

  // Construction goes through Live: the graph is the only thing that may
  // build this service, which also makes single-construction structural.
  private constructor(client: PostHogClient, settingsService: SettingsService) {
    this.client = client;
    this.settingsService = settingsService;
  }

  /**
   * The service's layer: dependencies are the yield* lines, initialization
   * is the acquire, teardown registers on the app scope. Composed into
   * AppLive by src/main/runtime/layers.ts.
   */
  static readonly Live: Layer.Layer<
    FeatureFlagServiceTag,
    never,
    PostHogClientTag | SettingsServiceTag | TelemetryServiceTag | AppScopeTag
  > = Layer.effect(
    FeatureFlagServiceTag,
    Effect.gen(function* () {
      const client = yield* PostHogClientTag;
      const settingsService = yield* SettingsServiceTag;
      // Ordering-only: telemetry sets the PostHog identity during its init;
      // flags must not be evaluated before that (old init order steps 5 -> 6).
      yield* TelemetryServiceTag;
      const appScope = yield* AppScopeTag;
      const service = new FeatureFlagService(client, settingsService);
      yield* addRelease(
        appScope,
        "Shutting down feature flag service...",
        "featureFlagService",
        () => service.shutdown(),
      );
      yield* step(() => service.initialize());
      logger.main.info("Feature flag service initialized");
      up("featureFlagService");
      return service;
    }),
  );

  private async initialize(): Promise<void> {
    // Load persisted flags from DB (fast, no network)
    const lastFetchedAt = await this.loadPersistedFlags();

    // Background refresh if no cache or cache is stale
    const isStale =
      !lastFetchedAt ||
      Date.now() - new Date(lastFetchedAt).getTime() > FLAG_REFRESH_INTERVAL_MS;

    if (isStale) {
      this.refresh().catch((err) => {
        logger.main.error("Startup feature flag refresh failed:", err);
      });
    }

    // Periodic refresh (1 day)
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) => {
        logger.main.error("Periodic feature flag refresh failed:", err);
      });
    }, FLAG_REFRESH_INTERVAL_MS);
  }

  async shutdown(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Fetch flags from PostHog and update cache + DB.
   * Does NOT depend on telemetry opt-in — flags work regardless.
   */
  async refresh(): Promise<void> {
    if (!this.client.posthog || !this.client.distinctId) {
      return;
    }

    // Deduplicate concurrent refresh calls
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

  private async doRefresh(): Promise<void> {
    try {
      const result = await this.client.posthog!.getAllFlagsAndPayloads(
        this.client.distinctId,
        {
          personProperties: this.client.personProperties,
        },
      );
      this.flags = result.featureFlags ?? {};
      this.payloads = result.featureFlagPayloads ?? {};

      await this.settingsService.setFeatureFlags({
        flags: this.flags,
        payloads: this.payloads,
        lastFetchedAt: new Date().toISOString(),
      });

      logger.main.info("Feature flags refreshed", {
        count: Object.keys(this.flags).length,
      });
      logger.main.debug("Feature flags refreshed details", {
        flags: Object.keys(this.flags).map((key) => ({
          key,
          value: this.flags[key],
          payload: this.payloads[key],
        })),
      });
    } catch (err) {
      logger.main.error("Failed to refresh feature flags:", err);
    }
  }

  getAllFlags(): Record<string, string | boolean> {
    return this.flags;
  }

  getAllPayloads(): Record<string, unknown> {
    return this.payloads;
  }

  /**
   * Returns the flag value and payload. Triggers a refresh if the key isn't cached.
   */
  async getFlagWithPayload(
    key: string,
  ): Promise<{ value: string | boolean | undefined; payload: unknown }> {
    if (!(key in this.flags)) {
      await this.refresh();
    }

    return { value: this.flags[key], payload: this.payloads[key] };
  }

  /**
   * Returns lastFetchedAt if persisted flags were found, null otherwise.
   */
  private async loadPersistedFlags(): Promise<string | null> {
    try {
      const persisted = await this.settingsService.getFeatureFlags();
      if (persisted) {
        this.flags = persisted.flags ?? {};
        this.payloads = persisted.payloads ?? {};
        logger.main.debug("Loaded persisted feature flags", {
          count: Object.keys(this.flags).length,
          lastFetchedAt: persisted.lastFetchedAt,
        });
        return persisted.lastFetchedAt ?? null;
      }
      return null;
    } catch (err) {
      logger.main.error("Failed to load persisted feature flags:", err);
      return null;
    }
  }
}
