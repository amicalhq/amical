import { app } from "electron";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import {
  RemoteConfigServiceTag,
  AuthServiceTag,
  SettingsServiceTag,
  TelemetryServiceTag,
  AppScopeTag,
} from "../../src/main/runtime/tags";
import { setApplicationLocale } from "../../src/i18n/application-locale";
import {
  DESKTOP_BACKGROUND_UPDATES_FLAG,
  RemoteConfigService,
} from "../../src/services/remote-config-service";
import {
  AuthServiceFailure,
  type AuthService,
} from "../../src/services/auth-service";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";
import { logger } from "../../src/main/logger";
import { DESKTOP_STEREO_MIC_DOWNMIX_FLAG } from "../../src/types/audio-capture";

describe("RemoteConfigService", () => {
  type PersistedRemoteConfig = Awaited<
    ReturnType<SettingsService["getRemoteConfig"]>
  >;

  let closeScope: (() => Promise<void>) | null = null;

  // The service is only constructible through its Live layer (see
  // tests/README.md). Building it runs initialize() — the persisted-envelope
  // load — so tests assert on post-init state directly. Closing the scope in
  // afterEach runs the registered shutdown release (clears the refresh
  // interval).
  const createService = async (
    persisted?: PersistedRemoteConfig,
    overrides?: {
      getRemoteConfig?: () => Promise<PersistedRemoteConfig>;
    },
  ) => {
    // The Live subscribes to auth events, so the stub must be an emitter.
    const authService = Object.assign(new EventEmitter(), {
      getIdToken: vi.fn(() => Effect.succeed(null)),
    }) as unknown as AuthService;
    const settingsService = {
      getRemoteConfig:
        overrides?.getRemoteConfig ?? vi.fn().mockResolvedValue(persisted),
      setRemoteConfig: vi.fn().mockResolvedValue(undefined),
    } as unknown as SettingsService;
    const captureContractFailure = vi.fn();
    const telemetryService = {
      getMachineId: vi.fn().mockReturnValue(undefined),
      captureContractFailure,
    } as unknown as TelemetryService;

    const scope = Effect.runSync(Scope.make());
    const ctx = await Effect.runPromise(
      Layer.build(
        RemoteConfigService.Live.pipe(
          Layer.provide(Layer.succeed(AuthServiceTag, authService)),
          Layer.provide(Layer.succeed(SettingsServiceTag, settingsService)),
          Layer.provide(Layer.succeed(TelemetryServiceTag, telemetryService)),
          Layer.provide(Layer.succeed(AppScopeTag, scope)),
        ),
      ).pipe(Scope.provide(scope)),
    );
    closeScope = () => Effect.runPromise(Scope.close(scope, Exit.void));

    return {
      service: Context.get(ctx, RemoteConfigServiceTag),
      settingsService,
      authService,
      captureContractFailure,
    };
  };

  // A well-formed persisted envelope for startup and refresh tests.
  const cachedConfig = (): PersistedRemoteConfig =>
    ({
      config: {
        version: 1,
        surfaces: [],
        flags: { [DESKTOP_BACKGROUND_UPDATES_FLAG]: true },
      },
    }) as unknown as PersistedRemoteConfig;

  beforeEach(() => {
    process.env.CORE_API_URL = "https://core.test";
    setApplicationLocale("en");
  });

  afterEach(async () => {
    if (closeScope) {
      await closeScope();
      closeScope = null;
    }
    delete process.env.CORE_API_URL;
    vi.unstubAllGlobals();
  });

  it("loads even a fresh cache immediately and refreshes in the background", async () => {
    let resolveFetch!: (response: unknown) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const persisted = {
      config: {
        version: 1,
        surfaces: [],
        flags: { [DESKTOP_BACKGROUND_UPDATES_FLAG]: false },
      },
      lastFetchedAt: new Date().toISOString(),
    };
    const { service } = await createService(persisted as PersistedRemoteConfig);
    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      false,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    resolveFetch({
      ok: true,
      json: async () => ({ version: 1, surfaces: [] }),
    });
    await service.refresh();
    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps a version-scoped requirement offline and across identity changes", async () => {
    const requirement = {
      required: true,
      evaluatedVersion: app.getVersion(),
      minimumVersion: "9.0.0",
    };
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const { service } = await createService({
      ...cachedConfig(),
      config: { version: 1, updateRequirement: requirement },
    });
    expect(service.getUpdateRequirement()).toEqual(requirement);
    await service.resetForIdentityChange();
    expect(service.getUpdateRequirement()).toEqual(requirement);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1 }),
    });
    await service.refresh();
    expect(service.getUpdateRequirement()).toEqual(requirement);
    const changed = vi.fn();
    const off = service.onChange(changed);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 1,
        updateRequirement: { ...requirement, required: false },
      }),
    });
    await service.refresh();
    expect(service.getUpdateRequirement()).toBeNull();
    expect(changed).toHaveBeenCalledOnce();
    off();
  });

  it("does not apply a cached requirement to a newly installed version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { service } = await createService({
      ...cachedConfig(),
      config: {
        version: 1,
        updateRequirement: { required: true, evaluatedVersion: "old-version" },
      },
    });
    expect(service.getUpdateRequirement()).toBeNull();
    await service.refresh();
    expect(fetch).toHaveBeenCalled();
  });

  it("logs an auth failure and its finalizer defects without replacing cached config", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => cachedConfig()!.config,
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service, authService } = await createService(cachedConfig());
    await service.refresh();
    const config = service.getConfig();
    const failure = new AuthServiceFailure({
      message: "token unavailable",
      cause: "offline",
    });
    const first = new Error("auth cleanup failed");
    const second = new Error("auth finalizer failed");
    vi.spyOn(authService, "getIdToken").mockReturnValue(
      Effect.fail(failure).pipe(
        Effect.ensuring(Effect.die(first)),
        Effect.ensuring(Effect.die(second)),
      ),
    );
    const logError = vi
      .spyOn(logger.main, "error")
      .mockImplementation(() => {});
    fetchMock.mockClear();
    try {
      await service.refresh();
      expect(service.getConfig()).toBe(config);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(logError.mock.calls).toEqual([
        ["Failed to refresh remote config:", failure],
        ["Failed to refresh remote config:", first],
        ["Failed to refresh remote config:", second],
      ]);
    } finally {
      logError.mockRestore();
    }
  });

  it("deduplicates refreshes and discards a response from before an identity change", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const fetchMock = vi.fn(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { service } = await createService(cachedConfig());
    const original = service.refresh();
    const duplicate = service.refresh();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const reset = service.resetForIdentityChange();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const response = (required: boolean) => ({
      ok: true,
      json: async () => ({
        version: 1,
        updateRequirement: { required, evaluatedVersion: app.getVersion() },
      }),
    });
    pending[1](response(false));
    await reset;
    pending[0](response(true));
    await Promise.all([original, duplicate]);
    expect(service.getConfig().updateRequirement?.required).toBe(false);
  });

  it("uses the selected application locale for targeting and headers", async () => {
    setApplicationLocale("ja");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, surfaces: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { service } = await createService();

    await service.refresh();

    const [url, init] = fetchMock.mock.calls[0] as [
      URL,
      { headers: Record<string, string> },
    ];
    expect(url.pathname).toBe("/apps/v1/remote-config");
    expect(url.searchParams.get("locale")).toBe("ja");
    expect(url.searchParams.has("channel")).toBe(false);
    expect(init.headers["Accept-Language"]).toBe("ja");
  });

  it("defaults the desktop background-updates flag to true", async () => {
    const { service } = await createService();

    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      true,
    );
  });

  it("normalizes and persists a missing flag as true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: 1, surfaces: [] }),
      }),
    );
    const { service, settingsService } = await createService();

    await service.refresh();

    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      true,
    );
    expect(settingsService.setRemoteConfig).toHaveBeenCalledWith({
      config: {
        version: 1,
        surfaces: [],
        flags: {
          [DESKTOP_BACKGROUND_UPDATES_FLAG]: true,
          [DESKTOP_STEREO_MIC_DOWNMIX_FLAG]: true,
        },
      },
    });
  });

  it("keeps a cached stereo-downmix kill switch offline and accepts a refreshed value", async () => {
    const cached = cachedConfig();
    cached!.config!.flags = { [DESKTOP_STEREO_MIC_DOWNMIX_FLAG]: false };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { service } = await createService(cached);
    await service.refresh();
    expect(service.getConfig().flags[DESKTOP_STEREO_MIC_DOWNMIX_FLAG]).toBe(
      false,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: 1,
          flags: { [DESKTOP_STEREO_MIC_DOWNMIX_FLAG]: true },
        }),
      }),
    );
    await service.refresh();
    expect(service.getConfig().flags[DESKTOP_STEREO_MIC_DOWNMIX_FLAG]).toBe(
      true,
    );
  });

  it("preserves an explicit false flag from the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: 1,
          surfaces: [],
          flags: { [DESKTOP_BACKGROUND_UPDATES_FLAG]: false },
        }),
      }),
    );
    const { service } = await createService();

    await service.refresh();

    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      false,
    );
  });

  it("normalizes a legacy persisted config without flags", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const { service } = await createService({
      config: { version: 1, surfaces: [] },
    });

    // Building through Live already ran initialize() (the persisted load).
    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      true,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });

  it("rejects malformed persisted flags while refreshing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const persisted = {
      config: {
        version: 1,
        surfaces: [],
        flags: { [DESKTOP_BACKGROUND_UPDATES_FLAG]: "true" },
      },
    } as unknown as PersistedRemoteConfig;
    const { service } = await createService(persisted);

    // initialize() ran during the layer build: it rejects the malformed
    // persisted flags and starts the usual background refresh.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      true,
    );
  });

  it("resets on every logged-out event", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const { authService } = await createService(cachedConfig());
    const emitter = authService as unknown as EventEmitter;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fetchMock.mockClear();

    emitter.emit("logged-out");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    // EVERY, not just the first — a once()-style subscription must fail here.
    emitter.emit("logged-out");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("resets on authenticated only when the token carried a subject", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const { authService } = await createService(cachedConfig());
    const emitter = authService as unknown as EventEmitter;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fetchMock.mockClear();

    emitter.emit("authenticated", { isAuthenticated: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();

    emitter.emit("authenticated", {
      isAuthenticated: true,
      userInfo: { sub: "user-1" },
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });

  it("drops the auth subscriptions when the scope closes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const { authService } = await createService(cachedConfig());
    const emitter = authService as unknown as EventEmitter;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fetchMock.mockClear();

    await closeScope!();
    closeScope = null;

    emitter.emit("logged-out");
    emitter.emit("authenticated", {
      isAuthenticated: true,
      userInfo: { sub: "user-1" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(emitter.listenerCount("logged-out")).toBe(0);
    expect(emitter.listenerCount("authenticated")).toBe(0);
  });

  describe("contract-break reporting", () => {
    const validBanner = {
      kind: "banner",
      id: "banner-1",
      content: { body: "hello" },
    };
    const ok = (payload: unknown) => ({
      ok: true,
      json: async () => payload,
    });

    it("contains a telemetry exception while reporting an invalid envelope", async () => {
      const fetchMock = vi.fn().mockResolvedValue(ok(cachedConfig()!.config));
      vi.stubGlobal("fetch", fetchMock);
      const { service, captureContractFailure } =
        await createService(cachedConfig());
      await service.refresh();
      const config = service.getConfig();
      const telemetryError = new Error("telemetry transport crashed");
      captureContractFailure.mockImplementation(() => {
        throw telemetryError;
      });
      fetchMock.mockResolvedValue(ok({ version: "invalid" }));
      const logError = vi.spyOn(logger.main, "error");
      try {
        await expect(service.refresh()).resolves.toBeUndefined();
        expect(service.getConfig()).toBe(config);
        expect(logError).toHaveBeenCalledWith(
          "Failed to refresh remote config:",
          telemetryError,
        );
        expect(captureContractFailure).toHaveBeenCalledOnce();
      } finally {
        logError.mockRestore();
      }
    });

    it("keeps the last good config and reports an invalid envelope once per episode", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(ok({ version: 1, surfaces: [validBanner] }))
        .mockResolvedValueOnce(ok({ version: "one" }))
        .mockResolvedValueOnce(ok({ version: "one" }))
        .mockResolvedValueOnce(ok({ version: 1, surfaces: [validBanner] }))
        .mockResolvedValueOnce(ok({ version: "one" }));
      vi.stubGlobal("fetch", fetchMock);
      const { service, captureContractFailure } =
        await createService(cachedConfig());

      await service.refresh();
      expect(service.getConfig().surfaces).toHaveLength(1);

      await service.refresh();
      // Fail-closed: the last good config stays.
      expect(service.getConfig().surfaces).toHaveLength(1);
      expect(captureContractFailure).toHaveBeenCalledExactlyOnceWith(
        "remote_config_response_invalid",
        "schema_mismatch",
      );

      // Same episode (the interval would re-parse the same payload): no
      // second report.
      await service.refresh();
      expect(captureContractFailure).toHaveBeenCalledTimes(1);

      // A fully-valid payload ends the episode; the next break reports again.
      await service.refresh();
      await service.refresh();
      expect(captureContractFailure).toHaveBeenCalledTimes(2);
    });

    it("drops an unrecognized surface kind without reporting", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          ok({
            version: 1,
            surfaces: [validBanner, { kind: "carousel", id: "c-1" }],
          }),
        ),
      );
      const { service, captureContractFailure } =
        await createService(cachedConfig());

      await service.refresh();

      expect(service.getConfig().surfaces).toEqual([validBanner]);
      expect(captureContractFailure).not.toHaveBeenCalled();
    });

    it("drops a malformed known-kind surface, applies the rest, and reports", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          ok({
            version: 1,
            surfaces: [
              { kind: "banner", id: "broken" }, // missing content
              { kind: "side_slot", id: "slot-1", content: { body: "x" } },
            ],
          }),
        ),
      );
      const { service, captureContractFailure } =
        await createService(cachedConfig());

      await service.refresh();

      expect(service.getConfig().surfaces).toEqual([
        { kind: "side_slot", id: "slot-1", content: { body: "x" } },
      ]);
      expect(captureContractFailure).toHaveBeenCalledExactlyOnceWith(
        "remote_config_response_invalid",
        "schema_mismatch",
      );
    });

    it("reports a surface without a string kind — that is a break, not skew", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          ok({
            version: 1,
            surfaces: [validBanner, { id: "kindless", content: { body: "x" } }],
          }),
        ),
      );
      const { service, captureContractFailure } =
        await createService(cachedConfig());

      await service.refresh();

      expect(service.getConfig().surfaces).toEqual([validBanner]);
      expect(captureContractFailure).toHaveBeenCalledExactlyOnceWith(
        "remote_config_response_invalid",
        "schema_mismatch",
      );
    });

    it("reports invalid JSON but not network or HTTP failures", async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => {
            // A middlebox serving HTML with a 200.
            throw new SyntaxError("Unexpected token <");
          },
        });
      vi.stubGlobal("fetch", fetchMock);
      const { service, captureContractFailure } =
        await createService(cachedConfig());

      await service.refresh();
      await service.refresh();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(captureContractFailure).toHaveBeenCalledExactlyOnceWith(
        "remote_config_response_invalid",
        "invalid_json",
      );
    });

    it("never reports an invalid persisted config", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      vi.stubGlobal("fetch", fetchMock);
      const persisted = {
        config: { version: "one" },
      } as unknown as PersistedRemoteConfig;
      const { captureContractFailure } = await createService(persisted);

      // Startup still refreshes after rejecting the cache.
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      expect(captureContractFailure).not.toHaveBeenCalled();
    });

    it("a settings write failure neither rejects nor reports", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(ok({ version: 1, surfaces: [validBanner] })),
      );
      const { service, settingsService, captureContractFailure } =
        await createService(cachedConfig());
      vi.mocked(settingsService.setRemoteConfig).mockRejectedValue(
        new Error("db locked"),
      );

      await service.refresh();

      // The in-memory config applied before the persist failed.
      expect(service.getConfig().surfaces).toHaveLength(1);
      expect(captureContractFailure).not.toHaveBeenCalled();
    });

    it("a settings read failure counts as an absent cache and never reports", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      vi.stubGlobal("fetch", fetchMock);
      const { service, captureContractFailure } = await createService(
        undefined,
        {
          getRemoteConfig: vi.fn().mockRejectedValue(new Error("db gone")),
        },
      );

      // Init survived the read failure and kicked its refresh.
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
        true,
      );
      expect(captureContractFailure).not.toHaveBeenCalled();
    });
  });

  it("returns to the true default while identity config is refetched", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: 1,
          surfaces: [],
          flags: { [DESKTOP_BACKGROUND_UPDATES_FLAG]: false },
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const { service } = await createService();
    await service.refresh();

    await service.resetForIdentityChange();

    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      true,
    );
  });
});
