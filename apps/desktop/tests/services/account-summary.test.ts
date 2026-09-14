import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { AuthService } from "../../src/services/auth-service";
import { getAccountSummary } from "../../src/services/account-summary";

const summary = {
  totals: {
    activities: 150,
    words: 12000,
    wordsWithAudioDuration: 11000,
    audioDurationMs: 600000,
  },
  byPlatform: [{ platform: "ios", words: 9000 }],
  asOf: "2026-09-14T10:00:00.000Z",
};

describe("getAccountSummary", () => {
  let accountId: string | null;
  let authService: AuthService;
  const fetchMock = vi.fn();
  const refreshTokenIfNeeded = vi.fn(() => Effect.void);

  beforeEach(() => {
    accountId = "account-a";
    authService = {
      getAuthState: () =>
        Effect.succeed({
          isAuthenticated: accountId !== null,
          userInfo: { sub: accountId },
        }),
      getIdToken: () => Effect.succeed("id-token"),
      refreshTokenIfNeeded,
    } as unknown as AuthService;
    fetchMock
      .mockReset()
      .mockImplementation(async () => Response.json(summary));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CORE_API_URL", "https://core.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reads account totals across platforms from Apps V1", async () => {
    await expect(getAccountSummary(authService, "account-a")).resolves.toEqual({
      totals: { activities: 150, words: 12000 },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe(
      "https://core.test/apps/v1/me/activities/summary",
    );
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer id-token",
      "amical-platform": process.platform,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("times out a stalled summary after 15 seconds", async () => {
    const timeoutController = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutController.signal);
    fetchMock.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener(
            "abort",
            () => reject(init.signal!.reason),
            { once: true },
          );
        }),
    );
    const request = getAccountSummary(authService, "account-a");
    const rejected = expect(request).rejects.toThrow("Timed out");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledWith(15_000);
    timeoutController.abort(new DOMException("Timed out", "TimeoutError"));
    await rejected;
  });

  it("aborts a summary request when its worker is interrupted", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          requestSignal = init.signal as AbortSignal;
          requestSignal.addEventListener(
            "abort",
            () => reject(requestSignal!.reason),
            { once: true },
          );
        }),
    );
    const request = getAccountSummary(
      authService,
      "account-a",
      controller.signal,
    );
    const rejected = expect(request).rejects.toThrow();
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    controller.abort();
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
  });

  it.each([null, "account-b"])(
    "rejects a request for another auth state (%s)",
    async (id) => {
      accountId = id;
      await expect(
        getAccountSummary(authService, "account-a"),
      ).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("discards a response when the account changes during the request", async () => {
    fetchMock.mockImplementation(async () => {
      accountId = "account-b";
      return Response.json(summary);
    });
    await expect(getAccountSummary(authService, "account-a")).rejects.toThrow();
  });

  it("refreshes authentication and retries once after a 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(
      getAccountSummary(authService, "account-a"),
    ).resolves.toMatchObject({
      totals: { words: 12000 },
    });
    expect(refreshTokenIfNeeded).toHaveBeenCalledExactlyOnceWith(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after a second authentication failure", async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 401 }),
    );
    await expect(
      getAccountSummary(authService, "account-a"),
    ).rejects.toMatchObject({
      _tag: "AuthenticationRequired",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates server failures without substituting local stats", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(
      getAccountSummary(authService, "account-a"),
    ).rejects.toMatchObject({
      _tag: "CloudHttpFailure",
    });
    expect(refreshTokenIfNeeded).not.toHaveBeenCalled();
  });

  it("rejects malformed totals instead of displaying zero", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ ...summary, totals: { words: -1 } }),
    );
    await expect(getAccountSummary(authService, "account-a")).rejects.toThrow();
  });
});
