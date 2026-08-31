import { randomBytes, createHash } from "crypto";
import { EventEmitter } from "events";
import { shell } from "electron";
import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Scope,
} from "effect";

import { getSettingsSection, updateSettingsSection } from "../db/app-settings";
import { logger } from "../main/logger";
import { down, up } from "../main/runtime/layer-helpers";
import { AppScopeTag, AuthServiceTag } from "../main/runtime/tags";
import { getAmicalClientHeaders, getUserAgent } from "../utils/http-client";
import type {
  ContractFailureKind,
  ContractFailureProperties,
  ContractFailureReport,
} from "./telemetry-service";

interface AuthConfig {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  idToken: string | null;
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: number | null;
  userInfo?: {
    sub: string;
    email?: string;
    name?: string;
  };
}

interface PendingAuth {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  id_token: string;
}

interface RefreshRun {
  readonly controller: AbortController;
  readonly completion: Deferred.Deferred<void>;
  readonly forceRequested: Ref.Ref<boolean>;
}

export class AuthServiceFailure extends Data.TaggedError("AuthServiceFailure")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function authFailure(
  cause: unknown,
  fallbackMessage: string,
): AuthServiceFailure {
  if (cause instanceof AuthServiceFailure) return cause;
  return new AuthServiceFailure({
    message: cause instanceof Error ? cause.message : fallbackMessage,
    cause,
  });
}

function originalAuthError(error: AuthServiceFailure): unknown {
  return error.cause instanceof Error ? error.cause : error;
}

/**
 * Promise bridge for imperative Electron and tRPC boundaries. Typed auth
 * failures retain their original Error identity; defects remain defects.
 */
export async function runAuthEffect<A>(
  effect: Effect.Effect<A, AuthServiceFailure>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;

  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    throw originalAuthError(failure.value);
  }
  throw Cause.squash(exit.cause);
}

function parseExpiresInSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseTokenResponse(
  raw: unknown,
  fallbackRefreshToken?: string,
  fallbackIdToken?: string,
): TokenResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const expiresIn = parseExpiresInSeconds(value.expires_in);
  const refreshToken =
    typeof value.refresh_token === "string"
      ? value.refresh_token
      : fallbackRefreshToken;
  const idToken =
    typeof value.id_token === "string" ? value.id_token : fallbackIdToken;

  if (
    typeof value.access_token !== "string" ||
    !idToken ||
    !refreshToken ||
    expiresIn === null
  ) {
    return null;
  }

  return {
    access_token: value.access_token,
    id_token: idToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
  };
}

export class AuthService extends EventEmitter {
  private readonly config: AuthConfig;
  private pendingAuth: PendingAuth | null = null;
  private authGeneration = 0;
  private readonly beforeLogoutHandlers = new Set<
    () => Effect.Effect<void, unknown>
  >();

  private constructor(
    private readonly authScope: Scope.CloseableScope,
    private readonly authStateSemaphore: Effect.Semaphore,
    private readonly refreshAdmissionSemaphore: Effect.Semaphore,
    private readonly refreshRun: Ref.Ref<RefreshRun | null>,
  ) {
    super();

    this.config = {
      clientId: process.env.AUTH_CLIENT_ID || __BUNDLED_AUTH_CLIENT_ID,
      authorizationEndpoint:
        process.env.AUTHORIZATION_ENDPOINT ||
        __BUNDLED_AUTH_AUTHORIZATION_ENDPOINT,
      tokenEndpoint:
        process.env.AUTH_TOKEN_ENDPOINT || __BUNDLED_AUTH_TOKEN_ENDPOINT,
      redirectUri: process.env.AUTH_REDIRECT_URI || __BUNDLED_AUTH_REDIRECT_URI,
    };

    logger.main.info("AuthService initialized with config:", {
      clientId: this.config.clientId,
      authorizationEndpoint: this.config.authorizationEndpoint,
      redirectUri: this.config.redirectUri,
    });
  }

  private static make(): Effect.Effect<AuthService> {
    return Effect.gen(function* () {
      const authScope = yield* Scope.make();
      const authStateSemaphore = yield* Effect.makeSemaphore(1);
      const refreshAdmissionSemaphore = yield* Effect.makeSemaphore(1);
      const refreshRun = yield* Ref.make<RefreshRun | null>(null);
      return new AuthService(
        authScope,
        authStateSemaphore,
        refreshAdmissionSemaphore,
        refreshRun,
      );
    });
  }

  /**
   * The service's layer. Identity side-effects on auth changes (telemetry
   * identify/reset, feature-flag refresh, remote-config reset) are NOT
   * called from here or from this class — the consumers subscribe to the
   * "authenticated" / "logged-out" events in their own Live layers. Composed
   * into AppLive by src/main/runtime/layers.ts.
   */
  static readonly Live: Layer.Layer<AuthServiceTag, never, AppScopeTag> =
    Layer.effect(
      AuthServiceTag,
      Effect.gen(function* () {
        const appScope = yield* AppScopeTag;
        const authService = yield* AuthService.make();
        yield* Scope.addFinalizer(
          appScope,
          authService.shutdown().pipe(Effect.zipLeft(down("authService"))),
        );
        logger.main.info("Auth service initialized");
        up("authService");
        return authService;
      }),
    );

  static createForTests(): AuthService {
    return Effect.runSync(AuthService.make());
  }

  shutdown(): Effect.Effect<void> {
    return Scope.close(this.authScope, Exit.void);
  }

  registerBeforeLogoutHandler(
    handler: () => Effect.Effect<void, unknown>,
  ): () => void {
    this.beforeLogoutHandlers.add(handler);

    return () => {
      this.beforeLogoutHandlers.delete(handler);
    };
  }

  private generatePKCE(): { verifier: string; challenge: string } {
    const verifier = this.base64URLEncode(randomBytes(32));
    const challenge = this.base64URLEncode(
      createHash("sha256").update(verifier).digest(),
    );
    return { verifier, challenge };
  }

  private base64URLEncode(buffer: Buffer): string {
    return buffer
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  private generateState(): string {
    return this.base64URLEncode(randomBytes(16));
  }

  private reportApiContractFailure(
    errorContext: string,
    failureKind: ContractFailureKind,
    properties?: ContractFailureProperties,
  ): void {
    const report: ContractFailureReport = {
      errorContext,
      failureKind,
      properties,
    };
    this.emit("api-contract-failure", report);
  }

  private parseSuccessfulTokenResponse(
    response: Response,
    fallbackRefreshToken?: string,
    fallbackIdToken?: string,
  ): Effect.Effect<TokenResponse, AuthServiceFailure> {
    return Effect.gen(this, function* () {
      const statusProperties =
        typeof response.status === "number" ? { status: response.status } : {};
      const raw = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) => {
          if (cause instanceof SyntaxError) {
            this.reportApiContractFailure(
              "oauth_token_response_invalid",
              "invalid_json",
              statusProperties,
            );
            return authFailure(
              new Error("Token endpoint returned an invalid response."),
              "Token endpoint returned an invalid response.",
            );
          }
          return authFailure(cause, "Unable to read token endpoint response");
        },
      });

      const parsed = parseTokenResponse(
        raw,
        fallbackRefreshToken,
        fallbackIdToken,
      );
      if (!parsed) {
        this.reportApiContractFailure(
          "oauth_token_response_invalid",
          "schema_mismatch",
          statusProperties,
        );
        return yield* Effect.fail(
          authFailure(
            new Error("Token endpoint returned an invalid response."),
            "Token endpoint returned an invalid response.",
          ),
        );
      }
      return parsed;
    });
  }

  /** Start the OAuth login flow. */
  login(): Effect.Effect<void, AuthServiceFailure> {
    return Effect.gen(this, function* () {
      yield* this.advanceGenerationAndAbortRefresh();
      const authUrl = yield* Effect.try({
        try: () => {
          const { verifier, challenge } = this.generatePKCE();
          const state = this.generateState();
          this.pendingAuth = {
            state,
            codeVerifier: verifier,
            codeChallenge: challenge,
          };

          const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            response_type: "code",
            scope: "openid profile email offline_access",
            state,
            code_challenge: challenge,
            code_challenge_method: "S256",
          });
          return `${this.config.authorizationEndpoint}?${params.toString()}`;
        },
        catch: (cause) => authFailure(cause, "Unable to start OAuth flow"),
      });

      logger.main.info("Starting OAuth flow with URL:", authUrl);
      yield* Effect.tryPromise({
        try: () => shell.openExternal(authUrl),
        catch: (cause) => authFailure(cause, "Unable to open OAuth flow"),
      });
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() =>
          logger.main.error(
            "Error starting OAuth flow:",
            originalAuthError(error),
          ),
        ),
      ),
    );
  }

  /** Handle OAuth callback from deep link. */
  handleAuthCallback(
    code: string,
    state: string | null,
  ): Effect.Effect<void, AuthServiceFailure> {
    return Effect.gen(this, function* () {
      logger.main.info("Handling auth callback");
      const pendingAuth = this.pendingAuth;
      const callbackGeneration = this.authGeneration;

      if (!pendingAuth) {
        return yield* Effect.fail(
          authFailure(
            new Error("No pending authentication request"),
            "No pending authentication request",
          ),
        );
      }
      if (state !== pendingAuth.state) {
        return yield* Effect.fail(
          authFailure(
            new Error("State mismatch - possible CSRF attack"),
            "State mismatch - possible CSRF attack",
          ),
        );
      }

      const tokenResponse = yield* this.exchangeCodeForToken(
        code,
        pendingAuth.codeVerifier,
      );
      if (
        callbackGeneration !== this.authGeneration ||
        this.pendingAuth !== pendingAuth
      ) {
        logger.main.debug("Ignoring stale authentication callback");
        return;
      }

      const authState: AuthState = {
        isAuthenticated: true,
        idToken: tokenResponse.id_token,
        refreshToken: tokenResponse.refresh_token,
        accessToken: tokenResponse.access_token,
        expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      };

      if (tokenResponse.id_token) {
        try {
          const payload = tokenResponse.id_token.split(".")[1];
          const decoded = JSON.parse(Buffer.from(payload, "base64").toString());
          authState.userInfo = {
            sub: decoded.sub,
            email: decoded.email,
            name: decoded.name,
          };
        } catch (error) {
          logger.main.error("Error decoding ID token:", error);
        }
      }

      const loginGeneration = yield* this.advanceGenerationAndAbortRefresh();
      const persisted = yield* this.writeAuthState(loginGeneration, authState);
      if (!persisted) return;

      this.pendingAuth = null;
      this.emit("authenticated", authState);
      logger.main.info("Authentication successful", {
        userInfo: authState.userInfo,
      });
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          const original = originalAuthError(error);
          logger.main.error("Error handling auth callback:", original);
          this.emit("auth-error", original);
        }),
      ),
    );
  }

  private exchangeCodeForToken(
    code: string,
    codeVerifier: string,
  ): Effect.Effect<TokenResponse, AuthServiceFailure> {
    return Effect.gen(this, function* () {
      logger.main.info(
        "Exchanging code for token at:",
        this.config.tokenEndpoint,
      );
      const body = {
        grant_type: "authorization_code",
        code,
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        code_verifier: codeVerifier,
      };

      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(this.config.tokenEndpoint, {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              "User-Agent": getUserAgent(),
              ...getAmicalClientHeaders(),
            },
            body: JSON.stringify(body),
          }),
        catch: (cause) => authFailure(cause, "Token exchange failed"),
      });

      if (!response.ok) {
        const errorText = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (cause) => authFailure(cause, "Unable to read token error"),
        });
        logger.main.error("Token exchange failed:", {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        return yield* Effect.fail(
          authFailure(
            new Error(`Token exchange failed: ${response.statusText}`),
            "Token exchange failed",
          ),
        );
      }

      const tokenResponse = yield* this.parseSuccessfulTokenResponse(response);
      logger.main.debug("Token exchange successful", tokenResponse);
      return tokenResponse;
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() =>
          logger.main.error(
            "Error exchanging code for token:",
            originalAuthError(error),
          ),
        ),
      ),
    );
  }

  /** Logout and clear auth state. */
  logout(): Effect.Effect<void, AuthServiceFailure> {
    return Effect.gen(this, function* () {
      const logoutGeneration = yield* this.advanceGenerationAndAbortRefresh();
      this.pendingAuth = null;

      for (const handler of this.beforeLogoutHandlers) {
        yield* handler().pipe(
          Effect.mapError((cause) =>
            authFailure(cause, "Before-logout handler failed"),
          ),
        );
      }

      const cleared = yield* this.writeAuthState(logoutGeneration, undefined);
      if (!cleared) return;

      this.emit("logged-out");
      logger.main.info("User logged out");
    });
  }

  /** Check if the user is authenticated, refreshing near-expiry tokens. */
  isAuthenticated(): Effect.Effect<boolean, AuthServiceFailure> {
    return this.refreshTokenIfNeeded().pipe(
      Effect.zipRight(this.getAuthState()),
      Effect.map((authState) => Boolean(authState?.isAuthenticated)),
    );
  }

  getAuthState(): Effect.Effect<AuthState | null, AuthServiceFailure> {
    return Effect.tryPromise({
      try: () => getSettingsSection("auth"),
      catch: (cause) =>
        authFailure(cause, "Unable to read authentication state"),
    }).pipe(Effect.map((auth) => auth as AuthState | null));
  }

  /** Get the ID token, refreshing near-expiry tokens first. */
  getIdToken(): Effect.Effect<string | null, AuthServiceFailure> {
    return this.refreshTokenIfNeeded().pipe(
      Effect.zipRight(this.getAuthState()),
      Effect.map((authState) => authState?.idToken || null),
    );
  }

  /**
   * `returnPath` must be a relative path; absolute and protocol-relative
   * values are rejected server-side.
   */
  openWebSession(returnPath: string): Effect.Effect<void, AuthServiceFailure> {
    return Effect.gen(this, function* () {
      const idToken = yield* this.getIdToken();
      if (!idToken) {
        return yield* Effect.fail(
          authFailure(new Error("Not signed in"), "Not signed in"),
        );
      }

      const handoffUrl = yield* Effect.try({
        try: () =>
          new URL(
            "/api/auth/handoff/web-session",
            this.config.tokenEndpoint,
          ).toString(),
        catch: (cause) => authFailure(cause, "Invalid handoff URL"),
      });
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(handoffUrl, {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
              "User-Agent": getUserAgent(),
              ...getAmicalClientHeaders(),
            },
            body: JSON.stringify({ return: returnPath }),
          }),
        catch: (cause) => authFailure(cause, "Handoff request failed"),
      });

      if (!response.ok) {
        const detail = yield* Effect.tryPromise({
          try: () => response.text().catch(() => ""),
          catch: (cause) => authFailure(cause, "Unable to read handoff error"),
        });
        logger.main.error("Handoff request failed", {
          status: response.status,
          detail,
        });
        return yield* Effect.fail(
          authFailure(
            new Error(`Handoff failed: ${response.status}`),
            "Handoff request failed",
          ),
        );
      }

      const statusProperties =
        typeof response.status === "number" ? { status: response.status } : {};
      const payload = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) => {
          if (cause instanceof SyntaxError) {
            this.reportApiContractFailure(
              "account_handoff_response_invalid",
              "invalid_json",
              statusProperties,
            );
            return authFailure(
              new Error("Handoff response was not valid JSON"),
              "Handoff response was not valid JSON",
            );
          }
          return authFailure(cause, "Unable to read handoff response");
        },
      });

      const url =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).url
          : undefined;
      if (typeof url !== "string" || !url) {
        this.reportApiContractFailure(
          "account_handoff_response_invalid",
          "schema_mismatch",
          { ...statusProperties, reason: "missing_url" },
        );
        return yield* Effect.fail(
          authFailure(
            new Error("Handoff response missing url"),
            "Handoff response missing url",
          ),
        );
      }

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        this.reportApiContractFailure(
          "account_handoff_response_invalid",
          "schema_mismatch",
          { ...statusProperties, reason: "invalid_url" },
        );
        return yield* Effect.fail(
          authFailure(
            new Error("Handoff response contained an invalid url"),
            "Handoff response contained an invalid url",
          ),
        );
      }
      const host = parsed.hostname;
      const hostAllowed = host === "amical.ai" || host.endsWith(".amical.ai");
      if (parsed.protocol !== "https:" || !hostAllowed) {
        logger.main.error("Handoff URL rejected", {
          protocol: parsed.protocol,
          host,
        });
        this.reportApiContractFailure(
          "account_handoff_response_invalid",
          "schema_mismatch",
          { ...statusProperties, reason: "untrusted_url" },
        );
        return yield* Effect.fail(
          authFailure(
            new Error(`Handoff URL not allowed: ${parsed.protocol}//${host}`),
            "Handoff URL not allowed",
          ),
        );
      }

      yield* Effect.tryPromise({
        try: () => shell.openExternal(url),
        catch: (cause) => authFailure(cause, "Unable to open web session"),
      });
    });
  }

  /** Refresh the token if needed. All callers share one auth-scoped runner. */
  refreshTokenIfNeeded(force = false): Effect.Effect<void> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(this, function* () {
        const admission = yield* this.refreshAdmissionSemaphore.withPermits(1)(
          Effect.gen(this, function* () {
            const current = yield* Ref.get(this.refreshRun);
            if (current) {
              if (force) yield* Ref.set(current.forceRequested, true);
              return { run: current, existing: true } as const;
            }

            const completion = yield* Deferred.make<void>();
            const run: RefreshRun = {
              controller: new AbortController(),
              completion,
              forceRequested: yield* Ref.make(force),
            };
            yield* Ref.set(this.refreshRun, run);
            const runner = this.runTokenRefreshIfNeeded(
              this.authGeneration,
              run,
            ).pipe(
              Effect.catchAll((error) =>
                Effect.sync(() =>
                  logger.main.error(
                    "Token refresh failed:",
                    originalAuthError(error),
                  ),
                ),
              ),
              Effect.onInterrupt(() =>
                Effect.sync(() => run.controller.abort()),
              ),
              Effect.onExit((exit) =>
                Effect.uninterruptible(
                  Ref.update(this.refreshRun, (active) =>
                    active === run ? null : active,
                  ).pipe(Effect.zipRight(Deferred.done(run.completion, exit))),
                ),
              ),
            );
            yield* Effect.forkIn(Effect.interruptible(runner), this.authScope);
            return { run, existing: false } as const;
          }),
        );

        if (admission.existing) {
          logger.main.debug("Refresh already in progress, waiting...");
        }
        yield* restore(Deferred.await(admission.run.completion));
      }),
    );
  }

  private runTokenRefreshIfNeeded(
    generation: number,
    run: RefreshRun,
  ): Effect.Effect<void, AuthServiceFailure> {
    return Effect.gen(this, function* () {
      const { controller } = run;
      const authState = yield* this.getAuthState();
      if (
        controller.signal.aborted ||
        generation !== this.authGeneration ||
        !authState
      ) {
        return;
      }

      if (!authState.refreshToken) {
        yield* this.logout();
        return;
      }

      if (
        authState.expiresAt &&
        authState.expiresAt - Date.now() > 10 * 60 * 1000
      ) {
        const shouldForce = yield* this.refreshAdmissionSemaphore.withPermits(
          1,
        )(
          Effect.gen(this, function* () {
            if (yield* Ref.get(run.forceRequested)) return true;

            yield* Ref.update(this.refreshRun, (active) =>
              active === run ? null : active,
            );
            return false;
          }),
        );
        if (!shouldForce) return;
      }

      logger.main.info("Token needs refresh, starting refresh flow");
      yield* this.performTokenRefresh(
        authState.refreshToken,
        authState.idToken,
        generation,
        controller,
      );
    });
  }

  private performTokenRefresh(
    refreshToken: string,
    currentIdToken: string | null,
    generation: number,
    controller: AbortController,
  ): Effect.Effect<void, AuthServiceFailure> {
    return Effect.gen(this, function* () {
      logger.main.info("Refreshing access token");
      const body = {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      };

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(this.config.tokenEndpoint, {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              "User-Agent": getUserAgent(),
              ...getAmicalClientHeaders(),
            },
            body: JSON.stringify(body),
          }),
        catch: (cause) => authFailure(cause, "Token refresh failed"),
      });
      if (controller.signal.aborted || generation !== this.authGeneration) {
        return;
      }

      if (!response.ok) {
        const errorText = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (cause) => authFailure(cause, "Unable to read refresh error"),
        });
        const currentAuthState = yield* this.getAuthState();
        if (
          controller.signal.aborted ||
          generation !== this.authGeneration ||
          currentAuthState?.refreshToken !== refreshToken
        ) {
          return;
        }
        logger.main.error("Token refresh failed:", {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });

        if (response.status === 400 || response.status === 401) {
          logger.main.info("Refresh token invalid or expired, logging out");
          yield* this.logout();
          const expired = new Error("Refresh token expired");
          this.emit("token-refresh-failed", expired);
          return yield* Effect.fail(
            authFailure(
              new Error("Refresh token expired - please log in again"),
              "Refresh token expired - please log in again",
            ),
          );
        }

        return yield* Effect.fail(
          authFailure(
            new Error(`Token refresh failed: ${response.statusText}`),
            "Token refresh failed",
          ),
        );
      }

      const tokenResponse = yield* this.parseSuccessfulTokenResponse(
        response,
        refreshToken,
        currentIdToken ?? undefined,
      );
      logger.main.info("Token refresh successful");

      const currentAuthState = yield* this.getAuthState();
      if (
        controller.signal.aborted ||
        generation !== this.authGeneration ||
        currentAuthState?.refreshToken !== refreshToken
      ) {
        logger.main.debug("Ignoring stale token refresh response");
        return;
      }

      const updatedAuthState: AuthState = {
        isAuthenticated: true,
        idToken: tokenResponse.id_token,
        refreshToken: tokenResponse.refresh_token || refreshToken,
        accessToken: tokenResponse.access_token,
        expiresAt: Date.now() + tokenResponse.expires_in * 1000,
        userInfo: currentAuthState?.userInfo,
      };

      if (updatedAuthState.idToken) {
        let decodedToken: {
          sub?: unknown;
          email?: string;
          name?: string;
        } | null = null;
        try {
          const payload = updatedAuthState.idToken.split(".")[1];
          decodedToken = JSON.parse(Buffer.from(payload, "base64").toString());
        } catch (error) {
          logger.main.error("Error decoding refreshed ID token:", error);
        }

        if (decodedToken) {
          if (
            typeof decodedToken.sub !== "string" ||
            (currentAuthState?.userInfo?.sub &&
              decodedToken.sub !== currentAuthState.userInfo.sub)
          ) {
            return yield* Effect.fail(
              authFailure(
                new Error("Refreshed ID token subject changed"),
                "Refreshed ID token subject changed",
              ),
            );
          }
          updatedAuthState.userInfo = {
            sub: decodedToken.sub,
            email: decodedToken.email,
            name: decodedToken.name,
          };
        }
      }

      const persisted = yield* this.writeAuthState(
        generation,
        updatedAuthState,
        refreshToken,
        controller.signal,
      );
      if (!persisted) return;

      this.emit("token-refreshed", updatedAuthState);
      logger.main.debug("Token refresh completed, new expiration:", {
        expiresAt: new Date(updatedAuthState.expiresAt!).toISOString(),
      });
    }).pipe(
      Effect.catchAll((error) => {
        if (controller.signal.aborted || generation !== this.authGeneration) {
          return Effect.void;
        }
        return Effect.sync(() => {
          const original = originalAuthError(error);
          logger.main.error("Error refreshing token:", original);
          this.emit("token-refresh-failed", original);
        }).pipe(Effect.zipRight(Effect.fail(error)));
      }),
    );
  }

  private writeAuthState(
    generation: number,
    authState: AuthState | undefined,
    expectedRefreshToken?: string,
    signal?: AbortSignal,
  ): Effect.Effect<boolean, AuthServiceFailure> {
    const write = Effect.gen(this, function* () {
      if (signal?.aborted || generation !== this.authGeneration) return false;
      if (expectedRefreshToken !== undefined) {
        const latest = yield* this.getAuthState();
        if (latest?.refreshToken !== expectedRefreshToken) return false;
      }
      yield* Effect.tryPromise({
        try: () => updateSettingsSection("auth", authState),
        catch: (cause) =>
          authFailure(cause, "Unable to update authentication state"),
      });
      return !signal?.aborted && generation === this.authGeneration;
    });
    return this.authStateSemaphore.withPermits(1)(
      Effect.uninterruptible(write),
    );
  }

  private advanceGenerationAndAbortRefresh(): Effect.Effect<number> {
    return Effect.uninterruptible(
      Effect.gen(this, function* () {
        const generation = ++this.authGeneration;
        const current = yield* Ref.get(this.refreshRun);
        current?.controller.abort();
        return generation;
      }),
    );
  }
}
