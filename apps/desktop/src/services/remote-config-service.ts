import { app } from "electron";

import { logger } from "../main/logger";
import {
  RemoteConfigSchema,
  RemoteConfigSurfaceSchema,
  type RemoteConfig,
  type RemoteConfigSurface,
} from "@/types/remote-config";
import {
  AMICAL_DEVICE_ID_HEADER,
  getAmicalClientHeaders,
  getCoreApiUrl,
  getUserAgent,
} from "../utils/http-client";
import type { AuthService, AuthState } from "./auth-service";
import type { SettingsService } from "./settings-service";
import type {
  ContractFailureKind,
  TelemetryService,
} from "./telemetry-service";
import { getApplicationLocale } from "../i18n/application-locale";
import { Data, Effect, Layer, Scope } from "effect";
import { z } from "zod";
import {
  RemoteConfigServiceTag,
  AuthServiceTag,
  SettingsServiceTag,
  TelemetryServiceTag,
  AppScopeTag,
} from "../main/runtime/tags";
import { addRelease, step, up } from "../main/runtime/layer-helpers";

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
export const DESKTOP_BACKGROUND_UPDATES_FLAG = "desktop-background-updates";

/**
 * Network-phase failure: server unreachable or a non-OK status.
 * Environmental — logged, and the last good config stays.
 */
class RemoteConfigFetchFailed extends Data.TaggedError(
  "RemoteConfigFetchFailed",
)<{
  message: string;
  status?: number;
  cause?: unknown;
}> {}

/** A successful response that violates the remote-config contract. */
class RemoteConfigInvalid extends Data.TaggedError("RemoteConfigInvalid")<{
  message: string;
  failureKind: ContractFailureKind;
  issues?: unknown;
}> {}

/**
 * The local settings store failed while loading or persisting the config.
 * An expected dependency failure — logged, never reported.
 */
class RemoteConfigStorageFailed extends Data.TaggedError(
  "RemoteConfigStorageFailed",
)<{
  message: string;
  cause: unknown;
}> {}

// Envelope with the surfaces left raw: surfaces validate per element below,
// so a surface kind newer than this client (version skew) drops that element
// instead of rejecting the whole payload.
const EnvelopeSchema = RemoteConfigSchema.omit({ surfaces: true }).extend({
  surfaces: z.array(z.unknown()).optional(),
});

// Adding a kind to the contract must extend this record (compile-gated) —
// it is what separates "unknown kind" (skew, dropped silently) from
// "known kind, malformed" (contract break, reported).
const KNOWN_SURFACE_KINDS: Record<RemoteConfigSurface["kind"], true> = {
  banner: true,
  side_slot: true,
};

interface ParsedEnvelope {
  config: RemoteConfig;
  /** Issues from known-kind surfaces that failed validation (dropped). */
  brokenSurfaceIssues: unknown[];
}

const parseEnvelope = (
  payload: unknown,
): Effect.Effect<ParsedEnvelope, RemoteConfigInvalid> =>
  Effect.suspend(() => {
    const envelope = EnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
      return Effect.fail(
        new RemoteConfigInvalid({
          message: "Remote config failed validation",
          failureKind: "schema_mismatch",
          issues: envelope.error.issues,
        }),
      );
    }
    const { surfaces: rawSurfaces, ...rest } = envelope.data;
    if (rawSurfaces === undefined) {
      return Effect.succeed<ParsedEnvelope>({
        config: rest,
        brokenSurfaceIssues: [],
      });
    }
    const surfaces: RemoteConfigSurface[] = [];
    const brokenSurfaceIssues: unknown[] = [];
    for (const raw of rawSurfaces) {
      const surface = RemoteConfigSurfaceSchema.safeParse(raw);
      if (surface.success) {
        surfaces.push(surface.data);
        continue;
      }
      const kind = (raw as { kind?: unknown } | null)?.kind;
      if (typeof kind === "string" && !(kind in KNOWN_SURFACE_KINDS)) {
        // Version skew: a surface kind newer than this client. Not an error.
        logger.main.debug("Dropping unrecognized remote config surface", {
          kind,
        });
      } else {
        // A known kind that failed validation, or an element with no string
        // `kind` at all — no contract version emits either, so it's a break.
        brokenSurfaceIssues.push(surface.error.issues);
      }
    }
    return Effect.succeed<ParsedEnvelope>({
      config: { ...rest, surfaces },
      brokenSurfaceIssues,
    });
  });

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
  // Set by the first contract-break report of a bad-config episode and
  // re-armed by the next fully-valid payload, so the refresh interval
  // doesn't re-report the same payload every tick.
  private invalidReported = false;

  // Construction goes through Live: the graph is the only thing that may
  // build this service, which also makes single-construction structural.
  private constructor(
    authService: AuthService,
    settingsService: SettingsService,
    telemetryService: TelemetryService,
  ) {
    this.authService = authService;
    this.settingsService = settingsService;
    this.telemetryService = telemetryService;
  }

  /**
   * The service's layer: dependencies are the yield* lines, initialization
   * is the acquire, teardown registers on the app scope. Composed into
   * AppLive by src/main/runtime/layers.ts.
   */
  static readonly Live: Layer.Layer<
    RemoteConfigServiceTag,
    never,
    AuthServiceTag | SettingsServiceTag | TelemetryServiceTag | AppScopeTag
  > = Layer.effect(
    RemoteConfigServiceTag,
    Effect.gen(function* () {
      const authService = yield* AuthServiceTag;
      const settingsService = yield* SettingsServiceTag;
      const telemetryService = yield* TelemetryServiceTag;
      const appScope = yield* AppScopeTag;
      const service = new RemoteConfigService(
        authService,
        settingsService,
        telemetryService,
      );
      // shutdown() clears the 15-minute refresh interval.
      yield* addRelease(
        appScope,
        "Shutting down remote config service...",
        "remoteConfigService",
        () => service.shutdown(),
      );
      yield* step(() => service.initialize());
      // Refetch on identity changes: sign-in (when the token carried a
      // subject), and EVERY logout — remote config is functional config,
      // independent of telemetry identity, so a logout always re-fetches
      // anonymously and the server drops any per-user surfaces. The
      // subscriptions come off when the app scope closes, so a torn-down
      // graph stops reacting to late auth events and repeated builds in one
      // process (tests) can't accumulate listeners.
      const resetForAuthChange = () => {
        service.resetForIdentityChange().catch((error) => {
          logger.main.warn("Remote config reset after auth change failed", {
            error,
          });
        });
      };
      const onAuthenticated = (authState: AuthState) => {
        if (!authState.userInfo?.sub) return;
        resetForAuthChange();
      };
      authService.on("authenticated", onAuthenticated);
      authService.on("logged-out", resetForAuthChange);
      yield* Scope.addFinalizer(
        appScope,
        Effect.sync(() => {
          authService.off("authenticated", onAuthenticated);
          authService.off("logged-out", resetForAuthChange);
        }),
      );
      logger.main.info("Remote config service initialized");
      up("remoteConfigService");
      return service;
    }),
  );

  private async initialize(): Promise<void> {
    // Load the persisted envelope first (fast, no network).
    const lastFetchedAt = await Effect.runPromise(this.loadPersistedEffect());

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

  private doRefresh(): Promise<void> {
    return Effect.runPromise(
      this.refreshEffect().pipe(
        Effect.catchTags({
          RemoteConfigFetchFailed: (error) =>
            Effect.sync(() => {
              if (error.status !== undefined && error.cause === undefined) {
                logger.main.warn("Remote config fetch failed", {
                  status: error.status,
                });
              } else {
                logger.main.error(
                  "Failed to refresh remote config:",
                  error.cause ?? error,
                );
              }
            }),
          RemoteConfigInvalid: (error) =>
            Effect.sync(() => {
              this.reportInvalid(error);
            }),
          RemoteConfigStorageFailed: (error) =>
            Effect.sync(() => {
              logger.main.error(
                "Failed to refresh remote config:",
                error.cause,
              );
            }),
        }),
        Effect.catchAllDefect((defect) =>
          Effect.sync(() => {
            logger.main.error("Failed to refresh remote config:", defect);
          }),
        ),
      ),
    );
  }

  private fetchEnvelopeEffect(): Effect.Effect<
    unknown,
    RemoteConfigFetchFailed | RemoteConfigInvalid
  > {
    return Effect.gen(this, function* () {
      const url = getCoreApiUrl("/apps/v1/remote-config");
      url.searchParams.set("platform", process.platform);
      url.searchParams.set("version", app.getVersion());
      url.searchParams.set("locale", getApplicationLocale());

      // Runs in all cases — the server decides what (if anything) to return per
      // auth state. Attach the bearer token only when signed in, plus the
      // anonymous per-install device id (for staged-rollout bucketing), the same
      // id the auto-updater sends.
      const idToken = yield* Effect.tryPromise({
        try: () => this.authService.getIdToken(),
        catch: (cause) =>
          new RemoteConfigFetchFailed({
            message: "Failed to resolve auth token for remote config",
            cause,
          }),
      });
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

      const response = yield* Effect.tryPromise({
        try: () => fetch(url, { headers }),
        catch: (cause) =>
          new RemoteConfigFetchFailed({
            message: "Remote config fetch failed",
            cause,
          }),
      });

      if (!response.ok) {
        return yield* Effect.fail(
          new RemoteConfigFetchFailed({
            message: "Remote config fetch failed",
            status: response.status,
          }),
        );
      }

      return yield* Effect.tryPromise({
        try: (): Promise<unknown> => response.json(),
        catch: (cause) =>
          cause instanceof SyntaxError
            ? new RemoteConfigInvalid({
                message: "Remote config response was not JSON",
                failureKind: "invalid_json",
              })
            : new RemoteConfigFetchFailed({
                message: "Failed to read remote config response",
                status: response.status,
                cause,
              }),
      });
    });
  }

  /**
   * The refresh pipeline: fetch → validate → apply. The payload is untrusted;
   * it is validated at this boundary and the last good config stays on any
   * failure (fail-closed on bad data). Typed failures settle in doRefresh.
   */
  private refreshEffect(): Effect.Effect<
    void,
    RemoteConfigFetchFailed | RemoteConfigInvalid | RemoteConfigStorageFailed
  > {
    return Effect.gen(this, function* () {
      const generation = this.generation;
      const payload = yield* this.fetchEnvelopeEffect();
      const { config, brokenSurfaceIssues } = yield* parseEnvelope(payload);

      // Identity changed while this fetch was in flight — drop it so it can't
      // write the previous identity's surfaces.
      if (this.generation !== generation) {
        return;
      }

      if (brokenSurfaceIssues.length > 0) {
        // Known-kind surfaces that failed validation were dropped in the
        // parse; the rest of the payload still applies, and the break is
        // reported.
        yield* Effect.sync(() => {
          this.reportInvalid(
            new RemoteConfigInvalid({
              message: "Remote config surfaces failed validation",
              failureKind: "schema_mismatch",
              issues: brokenSurfaceIssues,
            }),
          );
        });
      } else {
        // A fully-valid payload ends the bad-config episode.
        yield* Effect.sync(() => {
          this.invalidReported = false;
        });
      }

      yield* Effect.tryPromise({
        try: () => this.setConfig(config),
        catch: (cause) =>
          new RemoteConfigStorageFailed({
            message: "Failed to persist remote config",
            cause,
          }),
      });

      yield* Effect.sync(() => {
        logger.main.info("Remote config refreshed", {
          surfaces: config.surfaces?.length ?? 0,
        });
      });
    });
  }

  /**
   * A contract break: both ends of the payload are ours and the server saw a
   * 200, so without a report the break is invisible fleet-wide (the client
   * fails closed and keeps the last good config). Reported once per
   * bad-config episode; the next fully-valid payload re-arms it.
   */
  private reportInvalid(error: RemoteConfigInvalid): void {
    logger.main.error("Remote config failed validation", {
      issues: error.issues,
    });
    if (this.invalidReported) {
      return;
    }
    this.invalidReported = true;
    this.telemetryService.captureContractFailure(
      "remote_config_response_invalid",
      error.failureKind,
    );
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
   * A cache that fails to load or validate is treated as absent.
   */
  private loadPersistedEffect(): Effect.Effect<string | null> {
    return Effect.gen(this, function* () {
      const persisted = yield* Effect.tryPromise({
        try: () => this.settingsService.getRemoteConfig(),
        catch: (cause) =>
          new RemoteConfigStorageFailed({
            message: "Failed to load persisted remote config",
            cause,
          }),
      });
      if (!persisted?.config) {
        return null;
      }
      // Same tolerant parse as the wire, but never reported: the cache is
      // our own post-validation write, not a server payload.
      const { config } = yield* parseEnvelope(persisted.config);
      this.config = resolveRemoteConfig(config);
      return persisted.lastFetchedAt ?? null;
    }).pipe(
      Effect.catchTags({
        RemoteConfigInvalid: (error) =>
          Effect.sync(() => {
            logger.main.error("Persisted remote config failed validation", {
              issues: error.issues,
            });
            return null;
          }),
        RemoteConfigStorageFailed: (error) =>
          Effect.sync(() => {
            logger.main.error(
              "Failed to load persisted remote config:",
              error.cause,
            );
            return null;
          }),
      }),
      Effect.catchAllDefect((defect) =>
        Effect.sync(() => {
          logger.main.error("Failed to load persisted remote config:", defect);
          return null;
        }),
      ),
    );
  }
}
