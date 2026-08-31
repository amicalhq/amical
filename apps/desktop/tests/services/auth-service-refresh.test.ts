import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Exit, Fiber } from "effect";

import {
  AuthService,
  runAuthEffect,
  type AuthState,
} from "../../src/services/auth-service";
import {
  getSettingsSection,
  updateSettingsSection,
} from "../../src/db/app-settings";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

function idToken(subject: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: subject })).toString(
    "base64url",
  );
  return `header.${payload}.signature`;
}

describe("AuthService refresh fencing", () => {
  const contractFailure = vi.fn();
  let testDb: TestDatabase;
  let authService: AuthService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env.AUTH_CLIENT_ID = "desktop";
    process.env.AUTHORIZATION_ENDPOINT = "https://auth.test/authorize";
    process.env.AUTH_TOKEN_ENDPOINT = "https://auth.test/token";
    process.env.AUTH_REDIRECT_URI = "amical://oauth/callback";

    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
    authService = AuthService.createForTests();
    contractFailure.mockReset();
    authService.on("api-contract-failure", contractFailure);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const state: AuthState = {
      isAuthenticated: true,
      idToken: idToken("user-1"),
      refreshToken: "refresh-user-1",
      accessToken: "access-user-1",
      expiresAt: Date.now() - 1,
      userInfo: { sub: "user-1" },
    };
    await updateSettingsSection("auth", state);
  });

  afterEach(async () => {
    await Effect.runPromise(authService.shutdown());
    vi.unstubAllGlobals();
    await testDb.close();
    delete process.env.AUTH_CLIENT_ID;
    delete process.env.AUTHORIZATION_ENDPOINT;
    delete process.env.AUTH_TOKEN_ENDPOINT;
    delete process.env.AUTH_REDIRECT_URI;
  });

  it("uses one refresh request for concurrent token readers", async () => {
    const refreshedToken = idToken("user-1");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id_token: refreshedToken,
        refresh_token: "refresh-user-1-next",
        access_token: "access-user-1-next",
        expires_in: 3600,
      }),
    });

    await expect(
      Promise.all([
        runAuthEffect(authService.getIdToken()),
        runAuthEffect(authService.getIdToken()),
      ]),
    ).resolves.toEqual([refreshedToken, refreshedToken]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("forces a refresh even when the token is not near expiry", async () => {
    const authState = await getSettingsSection("auth");
    await updateSettingsSection("auth", {
      ...authState!,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id_token: idToken("user-1"),
        refresh_token: "refresh-user-1-next",
        access_token: "access-user-1-next",
        expires_in: 3600,
      }),
    });

    await Effect.runPromise(authService.refreshTokenIfNeeded());
    expect(fetchMock).not.toHaveBeenCalled();

    await Effect.runPromise(authService.refreshTokenIfNeeded(true));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await getSettingsSection("auth"))?.refreshToken).toBe(
      "refresh-user-1-next",
    );
  });

  it("shares one in-flight refresh between concurrent forced callers", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const first = Effect.runPromise(authService.refreshTokenIfNeeded(true));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const second = Effect.runPromise(authService.refreshTokenIfNeeded(true));

    resolveFetch?.({
      ok: true,
      json: async () => ({
        id_token: idToken("user-1"),
        refresh_token: "refresh-user-1-next",
        access_token: "access-user-1-next",
        expires_in: 3600,
      }),
    } as Response);

    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not lose a forced refresh that joins a non-forced check", async () => {
    const authState = await getSettingsSection("auth");
    await updateSettingsSection("auth", {
      ...authState!,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    let releaseAuthStateRead: (() => void) | undefined;
    let authStateReadStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      authStateReadStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseAuthStateRead = resolve;
    });
    const originalGetAuthState = authService.getAuthState.bind(authService);
    vi.spyOn(authService, "getAuthState").mockImplementationOnce(() =>
      Effect.promise(async () => {
        authStateReadStarted?.();
        await blocked;
      }).pipe(Effect.zipRight(originalGetAuthState())),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id_token: idToken("user-1"),
        refresh_token: "refresh-user-1-next",
        access_token: "access-user-1-next",
        expires_in: 3600,
      }),
    });

    const normalRefresh = Effect.runPromise(authService.refreshTokenIfNeeded());
    await started;
    const forcedRefresh = Effect.runPromise(
      authService.refreshTokenIfNeeded(true),
    );
    releaseAuthStateRead?.();

    await Promise.all([normalRefresh, forcedRefresh]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await getSettingsSection("auth"))?.refreshToken).toBe(
      "refresh-user-1-next",
    );
  });

  it.each([
    {
      name: "invalid JSON",
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      kind: "invalid_json",
    },
    {
      name: "a schema mismatch",
      json: async () => ({ access_token: 42 }),
      kind: "schema_mismatch",
    },
  ])("reports $name from a successful token response", async (scenario) => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: scenario.json,
    });

    await runAuthEffect(authService.getIdToken());

    expect(contractFailure).toHaveBeenCalledExactlyOnceWith({
      errorContext: "oauth_token_response_invalid",
      failureKind: scenario.kind,
      properties: { status: 200 },
    });
  });

  it("runs every registered logout fence", async () => {
    const first = vi.fn(() => Effect.void);
    const second = vi.fn(() => Effect.void);
    authService.registerBeforeLogoutHandler(first);
    authService.registerBeforeLogoutHandler(second);

    await runAuthEffect(authService.logout());

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("runs logout fences sequentially and stops before clearing on failure", async () => {
    const order: string[] = [];
    const loggedOut = vi.fn();
    authService.on("logged-out", loggedOut);
    authService.registerBeforeLogoutHandler(() =>
      Effect.sync(() => order.push("first")),
    );
    authService.registerBeforeLogoutHandler(() =>
      Effect.sync(() => order.push("second")).pipe(
        Effect.zipRight(Effect.fail(new Error("stop logout"))),
      ),
    );
    authService.registerBeforeLogoutHandler(() =>
      Effect.sync(() => order.push("third")),
    );

    await expect(runAuthEffect(authService.logout())).rejects.toThrow(
      "stop logout",
    );

    expect(order).toEqual(["first", "second"]);
    expect(await getSettingsSection("auth")).toBeDefined();
    expect(loggedOut).not.toHaveBeenCalled();
  });

  it("logs out once when the refresh token is rejected", async () => {
    const loggedOut = vi.fn();
    const refreshFailed = vi.fn();
    authService.on("logged-out", loggedOut);
    authService.on("token-refresh-failed", refreshFailed);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "expired",
    });

    await Effect.runPromise(authService.refreshTokenIfNeeded(true));

    expect(await getSettingsSection("auth")).toBeUndefined();
    expect(loggedOut).toHaveBeenCalledOnce();
    expect(refreshFailed).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "Refresh token expired" }),
    );
  });

  it("ignores a successful refresh response that arrives after logout", async () => {
    let resolveFetch:
      | ((response: {
          ok: boolean;
          json: () => Promise<Record<string, unknown>>;
        }) => void)
      | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const tokenPromise = runAuthEffect(authService.getIdToken());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await runAuthEffect(authService.logout());

    resolveFetch?.({
      ok: true,
      json: async () => ({
        id_token: idToken("user-1"),
        refresh_token: "refresh-user-1-next",
        access_token: "access-user-1-next",
        expires_in: 3600,
      }),
    });

    await expect(tokenPromise).resolves.toBeNull();
    expect(await getSettingsSection("auth")).toBeUndefined();
  });

  it("does not persist a refreshed token for another subject", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id_token: idToken("user-2"),
        refresh_token: "refresh-user-2",
        access_token: "access-user-2",
        expires_in: 3600,
      }),
    });

    await expect(runAuthEffect(authService.getIdToken())).resolves.toBe(
      idToken("user-1"),
    );
    expect((await getSettingsSection("auth"))?.userInfo?.sub).toBe("user-1");
  });

  it("ignores an authentication callback that finishes after logout", async () => {
    await runAuthEffect(authService.login());
    const pendingAuth = (
      authService as unknown as {
        pendingAuth: { state: string };
      }
    ).pendingAuth;
    const authenticated = vi.fn();
    authService.on("authenticated", authenticated);

    let resolveFetch:
      | ((response: {
          ok: boolean;
          json: () => Promise<Record<string, unknown>>;
        }) => void)
      | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const callbackPromise = runAuthEffect(
      authService.handleAuthCallback("authorization-code", pendingAuth.state),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await runAuthEffect(authService.logout());

    resolveFetch?.({
      ok: true,
      json: async () => ({
        id_token: idToken("user-1"),
        refresh_token: "refresh-user-1-next",
        access_token: "access-user-1-next",
        expires_in: 3600,
      }),
    });

    await expect(callbackPromise).resolves.toBeUndefined();
    expect(await getSettingsSection("auth")).toBeUndefined();
    expect(authenticated).not.toHaveBeenCalled();
  });

  it("reports an untrusted account-handoff URL without including the URL", async () => {
    const authState = await getSettingsSection("auth");
    await updateSettingsSection("auth", {
      ...authState!,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://untrusted.example/account" }),
    });

    await expect(
      runAuthEffect(authService.openWebSession("/account")),
    ).rejects.toThrow("Handoff URL not allowed");

    expect(contractFailure).toHaveBeenCalledExactlyOnceWith({
      errorContext: "account_handoff_response_invalid",
      failureKind: "schema_mismatch",
      properties: { status: 200, reason: "untrusted_url" },
    });
  });

  it("does not cancel a shared refresh when one waiter is interrupted", async () => {
    const refreshedToken = idToken("user-1");
    let requestSignal: AbortSignal | undefined;
    let resolveFetch: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          requestSignal = init?.signal ?? undefined;
          resolveFetch = resolve;
        }),
    );

    const interruptedWaiter = Effect.runFork(authService.getIdToken());
    const remainingWaiter = Effect.runFork(authService.getIdToken());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    await Effect.runPromise(Fiber.interrupt(interruptedWaiter));
    expect(requestSignal?.aborted).toBe(false);

    resolveFetch?.({
      ok: true,
      json: async () => ({
        id_token: refreshedToken,
        refresh_token: "refresh-user-1-next",
        access_token: "access-user-1-next",
        expires_in: 3600,
      }),
    } as Response);

    await expect(Effect.runPromise(Fiber.join(remainingWaiter))).resolves.toBe(
      refreshedToken,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts the auth-scoped refresh and completes its waiter on shutdown", async () => {
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal ?? undefined;
          requestSignal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const waiter = Effect.runFork(authService.getIdToken());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    await Effect.runPromise(authService.shutdown());

    expect(requestSignal?.aborted).toBe(true);
    const exit = await Effect.runPromise(Fiber.await(waiter));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("clears a failed refresh so a later call can retry", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id_token: idToken("user-1"),
          refresh_token: "refresh-user-1-next",
          access_token: "access-user-1-next",
          expires_in: 3600,
        }),
      });

    await Effect.runPromise(authService.refreshTokenIfNeeded(true));
    await Effect.runPromise(authService.refreshTokenIfNeeded(true));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await getSettingsSection("auth"))?.refreshToken).toBe(
      "refresh-user-1-next",
    );
  });
});
