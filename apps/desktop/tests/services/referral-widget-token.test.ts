import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { AuthService } from "../../src/services/auth-service";
import { getReferralWidgetToken } from "../../src/services/referral-widget-token";

describe("getReferralWidgetToken", () => {
  const fetchMock = vi.fn();
  const authService = {
    getAuthState: () =>
      Effect.succeed({ isAuthenticated: true, userInfo: { sub: "account-a" } }),
    getIdToken: () => Effect.succeed("id-token"),
  } as unknown as AuthService;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CORE_API_URL", "https://core.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads the Widget token from Apps V1", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ token: "widget-jwt" }));

    await expect(
      getReferralWidgetToken(authService, "account-a"),
    ).resolves.toBe("widget-jwt");
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "https://core.test/apps/v1/me/referral-widget-token",
    );
  });

  it("answers null when referrals are not available (403)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));

    await expect(
      getReferralWidgetToken(authService, "account-a"),
    ).resolves.toBeNull();
  });

  it("propagates other failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(
      getReferralWidgetToken(authService, "account-a"),
    ).rejects.toMatchObject({ _tag: "CloudHttpFailure" });
  });
});
