import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthService, type AuthState } from "../../src/services/auth-service";
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
      Promise.all([authService.getIdToken(), authService.getIdToken()]),
    ).resolves.toEqual([refreshedToken, refreshedToken]);
    expect(fetchMock).toHaveBeenCalledOnce();
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

    const tokenPromise = authService.getIdToken();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await authService.logout();

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

    await expect(authService.getIdToken()).resolves.toBe(idToken("user-1"));
    expect((await getSettingsSection("auth"))?.userInfo?.sub).toBe("user-1");
  });

  it("ignores an authentication callback that finishes after logout", async () => {
    await authService.login();
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

    const callbackPromise = authService.handleAuthCallback(
      "authorization-code",
      pendingAuth.state,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await authService.logout();

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
});
