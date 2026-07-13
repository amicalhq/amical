import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApplicationLocale } from "../../src/i18n/application-locale";
import { RemoteConfigService } from "../../src/services/remote-config-service";
import type { AuthService } from "../../src/services/auth-service";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";

describe("RemoteConfigService locale", () => {
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

    const authService = {
      getIdToken: vi.fn().mockResolvedValue(null),
    } as unknown as AuthService;
    const settingsService = {
      setRemoteConfig: vi.fn().mockResolvedValue(undefined),
    } as unknown as SettingsService;
    const telemetryService = {
      getMachineId: vi.fn().mockReturnValue(undefined),
    } as unknown as TelemetryService;
    const service = new RemoteConfigService(
      authService,
      settingsService,
      telemetryService,
    );

    await service.refresh();

    const [url, init] = fetchMock.mock.calls[0] as [
      URL,
      { headers: Record<string, string> },
    ];
    expect(url.searchParams.get("locale")).toBe("ja");
    expect(init.headers["Accept-Language"]).toBe("ja");
  });
});
