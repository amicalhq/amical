import { shell } from "electron";
import { randomBytes, createHash } from "crypto";
import { Layer } from "effect";
import { Mutex } from "async-mutex";
import { logger } from "../main/logger";
import { EventEmitter } from "events";
import { getSettingsSection, updateSettingsSection } from "../db/app-settings";
import { getAmicalClientHeaders, getUserAgent } from "../utils/http-client";
import { AuthServiceTag } from "../main/runtime/tags";
import { up } from "../main/runtime/layer-helpers";
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
  private config: AuthConfig;
  private pendingAuth: PendingAuth | null = null;
  private refreshPromise: Promise<void> | null = null;
  private refreshAbortController: AbortController | null = null;
  private readonly authStateMutex = new Mutex();
  private authGeneration = 0;
  private beforeLogoutHandler: (() => Promise<void>) | null = null;

  private constructor() {
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

  /**
   * The service's layer. Identity side-effects on auth changes (telemetry
   * identify/reset, feature-flag refresh, remote-config reset) are NOT
   * called from here or from this class — the consumers subscribe to the
   * "authenticated" / "logged-out" events in their own Live layers. Composed
   * into AppLive by src/main/runtime/layers.ts.
   */
  static readonly Live: Layer.Layer<AuthServiceTag> = Layer.sync(
    AuthServiceTag,
    () => {
      const authService = new AuthService();
      logger.main.info("Auth service initialized");
      up("authService");
      return authService;
    },
  );

  static createForTests(): AuthService {
    return new AuthService();
  }

  registerBeforeLogoutHandler(handler: () => Promise<void>): () => void {
    this.beforeLogoutHandler = handler;

    return () => {
      if (this.beforeLogoutHandler === handler) {
        this.beforeLogoutHandler = null;
      }
    };
  }

  /**
   * Generate PKCE challenge and verifier
   */
  private generatePKCE(): { verifier: string; challenge: string } {
    const verifier = this.base64URLEncode(randomBytes(32));
    const challenge = this.base64URLEncode(
      createHash("sha256").update(verifier).digest(),
    );
    return { verifier, challenge };
  }

  /**
   * Base64 URL encode (no padding)
   */
  private base64URLEncode(buffer: Buffer): string {
    return buffer
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * Generate random state for OAuth
   */
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

  private async parseSuccessfulTokenResponse(
    response: Response,
    fallbackRefreshToken?: string,
    fallbackIdToken?: string,
  ): Promise<TokenResponse> {
    const statusProperties =
      typeof response.status === "number" ? { status: response.status } : {};
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        this.reportApiContractFailure(
          "oauth_token_response_invalid",
          "invalid_json",
          statusProperties,
        );
        throw new Error("Token endpoint returned an invalid response.");
      }
      throw error;
    }

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
      throw new Error("Token endpoint returned an invalid response.");
    }
    return parsed;
  }

  /**
   * Start the OAuth login flow
   */
  async login(): Promise<void> {
    try {
      this.authGeneration += 1;
      this.refreshAbortController?.abort();

      // Generate PKCE parameters
      const { verifier, challenge } = this.generatePKCE();
      const state = this.generateState();

      // Store pending auth data
      this.pendingAuth = {
        state,
        codeVerifier: verifier,
        codeChallenge: challenge,
      };

      // Build authorization URL
      const params = new URLSearchParams({
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        response_type: "code",
        scope: "openid profile email offline_access",
        state: state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });

      const authUrl = `${this.config.authorizationEndpoint}?${params.toString()}`;

      logger.main.info("Starting OAuth flow with URL:", authUrl);

      // Open in default browser
      await shell.openExternal(authUrl);

      // The callback will be handled via deep link
    } catch (error) {
      logger.main.error("Error starting OAuth flow:", error);
      throw error;
    }
  }

  /**
   * Handle OAuth callback from deep link
   */
  async handleAuthCallback(code: string, state: string | null): Promise<void> {
    const pendingAuth = this.pendingAuth;
    const callbackGeneration = this.authGeneration;

    try {
      logger.main.info("Handling auth callback");

      // Validate state
      if (!pendingAuth) {
        throw new Error("No pending authentication request");
      }

      if (state !== pendingAuth.state) {
        throw new Error("State mismatch - possible CSRF attack");
      }

      // Exchange code for token
      const tokenResponse = await this.exchangeCodeForToken(
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

      // Store auth data
      const authState: AuthState = {
        isAuthenticated: true,
        idToken: tokenResponse.id_token,
        refreshToken: tokenResponse.refresh_token,
        accessToken: tokenResponse.access_token,
        expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      };

      // Decode ID token to get user info (basic JWT decode)
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

      // Save to database
      const loginGeneration = ++this.authGeneration;
      this.refreshAbortController?.abort();
      const persisted = await this.authStateMutex.runExclusive(async () => {
        if (loginGeneration !== this.authGeneration) return false;
        await updateSettingsSection("auth", authState);
        return loginGeneration === this.authGeneration;
      });
      if (!persisted) return;

      // Clear pending auth
      this.pendingAuth = null;

      // Emit success event. Identity consumers (telemetry identify, feature
      // flag refresh, remote config reset) subscribe in their Live layers.
      this.emit("authenticated", authState);

      logger.main.info("Authentication successful", {
        userInfo: authState.userInfo,
      });
    } catch (error) {
      logger.main.error("Error handling auth callback:", error);
      this.emit("auth-error", error);
      throw error;
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
  ): Promise<TokenResponse> {
    logger.main.info(
      "Exchanging code for token at:",
      this.config.tokenEndpoint,
    );

    const body = {
      grant_type: "authorization_code",
      code: code,
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code_verifier: codeVerifier,
    };

    try {
      const response = await fetch(this.config.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
          ...getAmicalClientHeaders(),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.main.error("Token exchange failed:", {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`Token exchange failed: ${response.statusText}`);
      }

      const tokenResponse = await this.parseSuccessfulTokenResponse(response);
      logger.main.debug("Token exchange successful", tokenResponse);
      return tokenResponse;
    } catch (error) {
      logger.main.error("Error exchanging code for token:", error);
      throw error;
    }
  }

  /**
   * Logout and clear auth state
   */
  async logout(): Promise<void> {
    const logoutGeneration = ++this.authGeneration;
    this.refreshAbortController?.abort();
    this.pendingAuth = null;
    await this.beforeLogoutHandler?.();
    const cleared = await this.authStateMutex.runExclusive(async () => {
      if (logoutGeneration !== this.authGeneration) return false;
      await updateSettingsSection("auth", undefined);
      return logoutGeneration === this.authGeneration;
    });
    if (!cleared) return;
    // Identity consumers (telemetry reset, feature flag refresh, remote
    // config reset, model auto-switch) subscribe in their Live layers. A
    // logout during startup token validation fires before those listeners
    // exist and is a no-op for them, as before.
    this.emit("logged-out");
    logger.main.info("User logged out");
  }

  /**
   * Check if user is authenticated
   * Automatically refreshes tokens if they are expired or expiring soon
   */
  async isAuthenticated(): Promise<boolean> {
    await this.refreshTokenIfNeeded();

    const authState = await this.getAuthState();
    if (!authState || !authState.isAuthenticated) {
      return false;
    }

    return true;
  }

  /**
   * Get current auth state
   */
  async getAuthState(): Promise<AuthState | null> {
    const auth = await getSettingsSection("auth");
    return auth as AuthState | null;
  }

  /**
   * Get ID token for API requests
   * Automatically refreshes the token if it's expiring soon
   */
  async getIdToken(): Promise<string | null> {
    await this.refreshTokenIfNeeded();

    const authState = await this.getAuthState();
    return authState?.idToken || null;
  }

  /**
   * `returnPath` must be a relative path; absolute and protocol-relative
   * values are rejected server-side.
   */
  async openWebSession(returnPath: string): Promise<void> {
    const idToken = await this.getIdToken();
    if (!idToken) {
      throw new Error("Not signed in");
    }

    // Better-Auth plugin endpoint, mounted under /api/auth/* on the same
    // host as the OAuth token endpoint.
    const handoffUrl = new URL(
      "/api/auth/handoff/web-session",
      this.config.tokenEndpoint,
    ).toString();

    const response = await fetch(handoffUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
        "User-Agent": getUserAgent(),
        ...getAmicalClientHeaders(),
      },
      body: JSON.stringify({ return: returnPath }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      logger.main.error("Handoff request failed", {
        status: response.status,
        detail,
      });
      throw new Error(`Handoff failed: ${response.status}`);
    }

    const statusProperties =
      typeof response.status === "number" ? { status: response.status } : {};
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        this.reportApiContractFailure(
          "account_handoff_response_invalid",
          "invalid_json",
          statusProperties,
        );
        throw new Error("Handoff response was not valid JSON");
      }
      throw error;
    }

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
      throw new Error("Handoff response missing url");
    }

    // Server compromise is a remote risk, but `shell.openExternal` honors
    // any scheme/host the URL specifies (file://, vbscript:, etc.) and
    // can't be undone. Constrain to https on the amical.ai family.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      this.reportApiContractFailure(
        "account_handoff_response_invalid",
        "schema_mismatch",
        { ...statusProperties, reason: "invalid_url" },
      );
      throw new Error("Handoff response contained an invalid url");
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
      throw new Error(`Handoff URL not allowed: ${parsed.protocol}//${host}`);
    }

    await shell.openExternal(url);
  }

  /**
   * Refresh token if needed
   */
  async refreshTokenIfNeeded(force = false): Promise<void> {
    if (this.refreshPromise) {
      logger.main.debug("Refresh already in progress, waiting...");
      return this.refreshPromise;
    }

    const generation = this.authGeneration;
    const controller = new AbortController();
    this.refreshAbortController = controller;
    const refreshPromise = this.runTokenRefreshIfNeeded(
      generation,
      controller.signal,
      force,
    )
      .catch((error) => {
        logger.main.error("Token refresh failed:", error);
      })
      .finally(() => {
        if (this.refreshPromise === refreshPromise) {
          this.refreshPromise = null;
        }
        if (this.refreshAbortController === controller) {
          this.refreshAbortController = null;
        }
      });
    this.refreshPromise = refreshPromise;
    return refreshPromise;
  }

  private async runTokenRefreshIfNeeded(
    generation: number,
    signal: AbortSignal,
    force: boolean,
  ): Promise<void> {
    const authState = await this.getAuthState();
    if (signal.aborted || generation !== this.authGeneration || !authState) {
      // User was never logged in - nothing to refresh
      return;
    }

    if (!authState.refreshToken) {
      // User has auth state but no refresh token - corrupted state, logout
      await this.logout();
      return;
    }

    // Check if token needs refresh (10 minutes before expiry)
    if (
      !force &&
      authState.expiresAt &&
      authState.expiresAt - Date.now() > 10 * 60 * 1000
    ) {
      // Token still valid
      return;
    }

    logger.main.info("Token needs refresh, starting refresh flow");
    await this.performTokenRefresh(
      authState.refreshToken,
      authState.idToken,
      generation,
      signal,
    );
  }

  /**
   * Perform the actual token refresh API call
   */
  private async performTokenRefresh(
    refreshToken: string,
    currentIdToken: string | null,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      logger.main.info("Refreshing access token");

      const body = {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      };

      const response = await fetch(this.config.tokenEndpoint, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
          ...getAmicalClientHeaders(),
        },
        body: JSON.stringify(body),
      });
      if (signal.aborted || generation !== this.authGeneration) return;

      if (!response.ok) {
        const errorText = await response.text();
        const currentAuthState = await this.getAuthState();
        if (
          signal.aborted ||
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

        // If refresh token is invalid/expired, logout the user
        if (response.status === 400 || response.status === 401) {
          logger.main.info("Refresh token invalid or expired, logging out");
          await this.logout();
          this.emit("token-refresh-failed", new Error("Refresh token expired"));
          throw new Error("Refresh token expired - please log in again");
        }

        throw new Error(`Token refresh failed: ${response.statusText}`);
      }

      const tokenResponse = await this.parseSuccessfulTokenResponse(
        response,
        refreshToken,
        currentIdToken ?? undefined,
      );
      logger.main.info("Token refresh successful");

      // Get current auth state to preserve user info
      const currentAuthState = await this.getAuthState();
      if (
        signal.aborted ||
        generation !== this.authGeneration ||
        currentAuthState?.refreshToken !== refreshToken
      ) {
        logger.main.debug("Ignoring stale token refresh response");
        return;
      }

      // Update auth state with new tokens
      const updatedAuthState: AuthState = {
        isAuthenticated: true,
        idToken: tokenResponse.id_token,
        // Use new refresh token if provided, otherwise keep the old one
        refreshToken: tokenResponse.refresh_token || refreshToken,
        accessToken: tokenResponse.access_token,
        expiresAt: Date.now() + tokenResponse.expires_in * 1000,
        userInfo: currentAuthState?.userInfo,
      };

      // Update ID token user info if present
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
            throw new Error("Refreshed ID token subject changed");
          }
          updatedAuthState.userInfo = {
            sub: decodedToken.sub,
            email: decodedToken.email,
            name: decodedToken.name,
          };
        }
      }

      const persisted = await this.authStateMutex.runExclusive(async () => {
        if (signal.aborted || generation !== this.authGeneration) return false;
        const latestAuthState = await this.getAuthState();
        if (latestAuthState?.refreshToken !== refreshToken) return false;
        await updateSettingsSection("auth", updatedAuthState);
        return !signal.aborted && generation === this.authGeneration;
      });
      if (!persisted) return;

      // Emit success event
      this.emit("token-refreshed", updatedAuthState);

      logger.main.debug("Token refresh completed, new expiration:", {
        expiresAt: new Date(updatedAuthState.expiresAt!).toISOString(),
      });
    } catch (error) {
      if (signal.aborted || generation !== this.authGeneration) return;
      logger.main.error("Error refreshing token:", error);
      this.emit("token-refresh-failed", error);
      throw error;
    }
  }
}
