import { shell } from "electron";
import { randomBytes, createHash } from "crypto";
import { logger } from "../main/logger";
import { EventEmitter } from "events";
import { getSettingsSection, updateSettingsSection } from "../db/app-settings";
import { getUserAgent } from "../utils/http-client";
import { ServiceManager } from "../main/managers/service-manager";

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
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  id_token: string;
}

interface RefreshTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  id_token: string;
}

export class AuthService extends EventEmitter {
  private static instance: AuthService | null = null;
  private config: AuthConfig;
  private pendingAuth: PendingAuth | null = null;
  private refreshPromise: Promise<void> | null = null;

  private constructor() {
    super();

    this.config = {
      clientId: process.env.AUTH_CLIENT_ID || __BUNDLED_AUTH_CLIENT_ID,
      authorizationEndpoint:
        process.env.AUTHORIZATION_ENDPOINT ||
        __BUNDLED_AUTH_AUTHORIZATION_ENDPOINT,
      tokenEndpoint:
        process.env.AUTH_TOKEN_ENDPOINT || __BUNDLED_AUTH_TOKEN_ENDPOINT,
      redirectUri: "vox://oauth/callback",
    };

    logger.main.info("AuthService initialized with config:", {
      clientId: this.config.clientId,
      authorizationEndpoint: this.config.authorizationEndpoint,
      redirectUri: this.config.redirectUri,
    });
  }

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
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

  /**
   * Start the OAuth login flow
   */
  async login(): Promise<void> {
    try {
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
    try {
      logger.main.info("Handling auth callback");

      // Validate state
      if (!this.pendingAuth) {
        throw new Error("No pending authentication request");
      }

      if (state !== this.pendingAuth.state) {
        throw new Error("State mismatch - possible CSRF attack");
      }

      // Exchange code for token
      const tokenResponse = await this.exchangeCodeForToken(
        code,
        this.pendingAuth.codeVerifier,
      );

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
      await updateSettingsSection("auth", authState);

      // Identify user in telemetry
      if (authState.userInfo?.sub) {
        const telemetryService =
          ServiceManager.getInstance().getService("telemetryService");
        telemetryService.identifyUser(
          authState.userInfo.sub,
          authState.userInfo.email,
          authState.userInfo.name,
        );
      }

      // Clear pending auth
      this.pendingAuth = null;

      // Emit success event
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

      const tokenResponse: TokenResponse = await response.json();
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
    await updateSettingsSection("auth", undefined);
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
   * Refresh token if needed
   */
  async refreshTokenIfNeeded(): Promise<void> {
    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      logger.main.debug("Refresh already in progress, waiting...");
      return this.refreshPromise;
    }

    const authState = await this.getAuthState();
    if (!authState) {
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
      authState.expiresAt &&
      authState.expiresAt - Date.now() > 10 * 60 * 1000
    ) {
      // Token still valid
      return;
    }

    // Start refresh and store the promise
    logger.main.info("Token needs refresh, starting refresh flow");
    this.refreshPromise = this.performTokenRefresh(authState.refreshToken)
      .catch((error) => {
        // Handle refresh errors internally - don't throw
        // performTokenRefresh already handles 401/400 by logging out
        logger.main.error("Token refresh failed:", error);
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  /**
   * Perform the actual token refresh API call
   */
  private async performTokenRefresh(refreshToken: string): Promise<void> {
    try {
      logger.main.info("Refreshing access token");

      const body = {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      };

      const response = await fetch(this.config.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
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

      const tokenResponse: RefreshTokenResponse = await response.json();
      logger.main.info("Token refresh successful");

      // Get current auth state to preserve user info
      const currentAuthState = await this.getAuthState();

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
        try {
          const payload = updatedAuthState.idToken.split(".")[1];
          const decoded = JSON.parse(Buffer.from(payload, "base64").toString());
          updatedAuthState.userInfo = {
            sub: decoded.sub,
            email: decoded.email,
            name: decoded.name,
          };
        } catch (error) {
          logger.main.error("Error decoding refreshed ID token:", error);
        }
      }

      // Save to database
      await updateSettingsSection("auth", updatedAuthState);

      // Emit success event
      this.emit("token-refreshed", updatedAuthState);

      logger.main.debug("Token refresh completed, new expiration:", {
        expiresAt: new Date(updatedAuthState.expiresAt!).toISOString(),
      });
    } catch (error) {
      logger.main.error("Error refreshing token:", error);
      this.emit("token-refresh-failed", error);
      throw error;
    }
  }
}
