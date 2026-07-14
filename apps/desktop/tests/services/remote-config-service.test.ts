import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  const createService = (persisted?: PersistedRemoteConfig) => {
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

    return {
      service: new RemoteConfigService(
        authService,
        settingsService,
        telemetryService,
      ),
      settingsService,
    };
  };

  beforeEach(() => {
    process.env.CORE_API_URL = "https://core.test";
    setApplicationLocale("en");
  });

  afterEach(() => {
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

    const { service } = createService();

    await service.refresh();

    const [url, init] = fetchMock.mock.calls[0] as [
      URL,
      { headers: Record<string, string> },
    ];
    expect(url.searchParams.get("locale")).toBe("ja");
    expect(init.headers["Accept-Language"]).toBe("ja");
  });

  it("defaults the desktop background-updates flag to true", () => {
    const { service } = createService();

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
    const { service, settingsService } = createService();

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
    const { service } = createService();

    await service.refresh();

    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      false,
    );
  });

  it("normalizes a legacy persisted config without flags", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { service } = createService({
      config: { version: 1, surfaces: [] },
      lastFetchedAt: new Date().toISOString(),
    });

    await service.initialize();

    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      true,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await service.shutdown();
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
    const { service } = createService(persisted);

    await service.initialize();
    await service.refresh();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      true,
    );
    await service.shutdown();
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
    const { service } = createService();
    await service.refresh();

    await service.resetForIdentityChange();

    expect(service.getConfig().flags[DESKTOP_BACKGROUND_UPDATES_FLAG]).toBe(
      true,
    );
  });
});
