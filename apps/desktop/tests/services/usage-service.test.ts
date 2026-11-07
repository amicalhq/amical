import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { parseCloudUsage } from "../../src/types/usage";
import type { AuthService } from "../../src/services/auth-service";
import { UsageService } from "../../src/services/usage-service";

const freeUsage = (used: number, resetsAt = "2099-01-05T00:00:00.000Z") => ({
  cloudWords: { used, limit: 2000, resetsAt },
  offers: { premiumUpgrade: true, enterpriseRow: true },
  billing: { canManage: true },
});

describe("parseCloudUsage", () => {
  it("hides only the field that is invalid or newer than this client", () => {
    expect(
      parseCloudUsage({
        cloudWords: { used: 10, limit: 2000, resetsAt: "2099-01-05T00:00:00Z" },
        offers: { premiumUpgrade: "yes", futureOffer: true },
        billing: { canManage: "yes" },
      }),
    ).toEqual({
      cloudWords: { used: 10, limit: 2000, resetsAt: "2099-01-05T00:00:00Z" },
      offers: { premiumUpgrade: false },
      billing: { canManage: false },
    });
  });

  it("draws no meter for the response of an older server", () => {
    expect(
      parseCloudUsage({
        period: { start: null, end: null },
        usage: { wordsUsed: 0 },
        limits: { words: 2000 },
        quotaSharing: "per_user",
      }).cloudWords,
    ).toBeNull();
  });
});

describe("UsageService", () => {
  let accountId: string | null;
  let authService: AuthService;
  const fetchMock = vi.fn();

  beforeEach(() => {
    accountId = "account-a";
    authService = {
      getAuthState: () =>
        Effect.succeed({
          isAuthenticated: accountId !== null,
          userInfo: { sub: accountId },
        }),
      getIdToken: () => Effect.succeed("id-token"),
      refreshTokenIfNeeded: () => Effect.void,
    } as unknown as AuthService;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CORE_API_URL", "https://core.test");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("drops a response that arrives after the account changed", async () => {
    let resolveA!: (response: Response) => void;
    fetchMock
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (resolveA = resolve)),
      )
      .mockImplementation(async () => Response.json(freeUsage(5)));
    const service = new UsageService(authService);
    service.watch();

    service.activate("account-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    accountId = "account-b";
    service.activate("account-b");
    resolveA(Response.json(freeUsage(1999)));

    await vi.waitFor(() => expect(service.get()?.cloudWords?.used).toBe(5));
  });

  it("keeps the last value on failure, but not past its window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T00:00:00.000Z"));
    fetchMock.mockImplementationOnce(async () =>
      Response.json(freeUsage(100, "2026-11-02T00:00:00.000Z")),
    );
    const service = new UsageService(authService);
    service.watch();
    service.activate("account-a");
    await vi.waitFor(() => expect(service.get()?.cloudWords?.used).toBe(100));

    fetchMock.mockImplementation(
      async () => new Response(null, { status: 503 }),
    );
    service.activate("account-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(service.get()?.cloudWords?.used).toBe(100);

    // That window has reset, so its numbers must not show.
    vi.setSystemTime(new Date("2026-11-02T00:00:00.000Z"));
    expect(service.get()).toBeNull();
  });

  it("reads once, 15 s after a burst of cloud dictations, and only with a visible meter", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => Response.json(freeUsage(5)));
    const service = new UsageService(authService);
    service.refreshAfterDictation();
    expect(vi.getTimerCount()).toBe(0);

    // No visible meter: sign-in does not read; the first show does.
    service.activate("account-a");
    expect(fetchMock).not.toHaveBeenCalled();
    service.refreshIfStale();
    await vi.waitFor(() => expect(service.get()).not.toBeNull());
    fetchMock.mockClear();

    // Hidden meter: no read now, one read when it is next shown.
    service.refreshAfterDictation();
    expect(vi.getTimerCount()).toBe(0);
    service.refreshIfStale();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockClear();

    service.watch();

    service.refreshAfterDictation();
    await vi.advanceTimersByTimeAsync(10_000);
    service.refreshAfterDictation();
    await vi.advanceTimersByTimeAsync(14_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("keeps reading after a failed first read", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      async () => new Response(null, { status: 503 }),
    );
    const service = new UsageService(authService);
    service.watch();
    service.activate("account-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(0);

    fetchMock.mockImplementation(async () => Response.json(freeUsage(5)));
    service.refreshAfterDictation();
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.waitFor(() => expect(service.get()?.cloudWords?.used).toBe(5));
  });

  it("reads after a quota rejection even when the last read had no meter", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () =>
      Response.json({
        cloudWords: null,
        offers: { premiumUpgrade: false, enterpriseRow: false },
        billing: { canManage: true },
      }),
    );
    const service = new UsageService(authService);
    service.watch();
    service.activate("account-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(0);

    // A successful dictation does not read for a plan with no meter.
    service.refreshAfterDictation();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(async () => Response.json(freeUsage(2000)));
    service.refreshAfterDictation(true);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.waitFor(() => expect(service.get()?.cloudWords?.used).toBe(2000));
  });
});
