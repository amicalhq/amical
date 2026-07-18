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
import type { AuthService } from "../../src/services/auth-service";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";

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
  const createService = async (persisted?: PersistedRemoteConfig) => {
    const authService = {
      getIdToken: vi.fn().mockResolvedValue(null),
    } as unknown as AuthService;
    const settingsService = {
      getRemoteConfig: vi.fn().mockResolvedValue(persisted),
      setRemoteConfig: vi.fn().mockResolvedValue(undefined),
    } as unknown as SettingsService;
    const telemetryService = {
      getMachineId: vi.fn().mockReturnValue(undefined),
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
      ).pipe(Scope.extend(scope)),
    );
    closeScope = () => Effect.runPromise(Scope.close(scope, Exit.void));

    return {
      service: Context.get(ctx, RemoteConfigServiceTag),
      settingsService,
    };
  };

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
    expect(url.searchParams.get("locale")).toBe("ja");
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
        flags: { [DESKTOP_BACKGROUND_UPDATES_FLAG]: true },
      },
      lastFetchedAt: expect.any(String),
    });
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
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { service } = await createService({
      config: { version: 1, surfaces: [] },
      lastFetchedAt: new Date().toISOString(),
    });

    // Building through Live already ran initialize() (the persisted load).
    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      true,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed persisted flags and refreshes instead", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const persisted = {
      config: {
        version: 1,
        surfaces: [],
        flags: { [DESKTOP_BACKGROUND_UPDATES_FLAG]: "true" },
      },
      lastFetchedAt: new Date().toISOString(),
    } as unknown as PersistedRemoteConfig;
    const { service } = await createService(persisted);

    // initialize() ran during the layer build: it rejects the malformed
    // persisted flags and kicks its background refresh instead.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      true,
    );
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
