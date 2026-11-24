import { Effect, Layer, Scope } from "effect";
import { z } from "zod";
import { SequenzyIdentityTokenResponseSchema } from "@amical/api-contracts/apps/v1";
import { logger } from "../main/logger";
import { addRelease, up } from "../main/runtime/layer-helpers";
import {
  AppScopeTag,
  AuthServiceTag,
  RemoteConfigServiceTag,
  WidgetFeedServiceTag,
} from "../main/runtime/tags";
import {
  SEQUENZY_API_URL,
  SEQUENZY_APP_ID,
  WIDGET_FEED_PLACEMENT,
  getSequenzyConfig,
} from "../constants/sequenzy";
import { AccessForbidden, BadRequest } from "../types/errors/cloud-request";
import { DESKTOP_WIDGET_FEED_FLAG } from "../types/remote-config";
import { parseWidgetFeedItem, type WidgetFeedItem } from "../types/widget-feed";
import { getAccountResource } from "./account-request";
import {
  runAuthEffect,
  type AuthService,
  type AuthState,
} from "./auth-service";
import type { RemoteConfigService } from "./remote-config-service";

// How often the slot is fetched while signed in with the flag on.
const POLL_INTERVAL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
// Mint a new identity token this long before the old one expires.
const TOKEN_RENEW_MARGIN_MS = 5 * 60_000;

interface Identity {
  accountId: string;
  email: string;
  identityToken: string;
  expiresAt: number;
}

interface SequenzyResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

const IdentityClaimsSchema = z.object({
  email: z.string(),
  expiresAt: z.number(),
});

const PlacementsResponseSchema = z.object({
  placements: z.array(
    z.object({ placement: z.string(), message: z.unknown() }),
  ),
});

/**
 * The email and expiry (epoch ms) in a Sequenzy identity token
 * (`seq_wid_<payload>.<signature>`), read the same way as Sequenzy's web SDK.
 */
function readIdentityToken(
  token: string,
): { email: string; expiresAt: number } | null {
  if (!token.startsWith("seq_wid_")) return null;
  const parts = token.slice("seq_wid_".length).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const claims = IdentityClaimsSchema.safeParse(
      JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
    );
    return claims.success ? claims.data : null;
  } catch {
    return null;
  }
}

type SequenzyConfig = NonNullable<ReturnType<typeof getSequenzyConfig>>;

async function postSequenzy(
  config: SequenzyConfig,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<SequenzyResponse> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(`${SEQUENZY_API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sequenzy-key": config.publicKey,
      "x-sequenzy-app-id": SEQUENZY_APP_ID,
    },
    body: JSON.stringify({
      companyId: config.companyId,
      publicKey: config.publicKey,
      ...body,
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  // A failed read (timeout, network) is a failure; a body that is not JSON is
  // just no body.
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

function isIdentityRejected(response: SequenzyResponse): boolean {
  return (
    (response.status === 401 || response.status === 403) &&
    (response.body as { code?: unknown } | undefined)?.code ===
      "invalid_web_tracking_identity"
  );
}

/**
 * The signed-in user's item for the widget notification card, from the
 * Sequenzy placement `desktop_widget`, and what the user does with the card,
 * reported back to Sequenzy.
 */
export class WidgetFeedService {
  private accountId: string | null = null;
  private identity: Identity | null = null;
  private minting: Promise<Identity | null> | null = null;
  // The token route or Sequenzy refused this account for good; nothing is
  // fetched again until the account changes.
  private refused = false;
  private item: WidgetFeedItem | null = null;
  // Items closed on this device. The slot can serve one again until Sequenzy
  // has the dismissal.
  private readonly closedIds = new Set<string>();
  private readonly displayedIds = new Set<string>();
  // Aborted on every account change, so an old response cannot show another
  // account's item.
  private request: AbortController | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<() => void>();
  // Null in a build without the Sequenzy key: the feed stays off.
  private readonly sequenzy = getSequenzyConfig();

  constructor(
    private readonly authService: AuthService,
    private readonly remoteConfigService: RemoteConfigService,
  ) {}

  static readonly Live: Layer.Layer<
    WidgetFeedServiceTag,
    never,
    AuthServiceTag | RemoteConfigServiceTag | AppScopeTag
  > = Layer.effect(
    WidgetFeedServiceTag,
    Effect.gen(function* () {
      const authService = yield* AuthServiceTag;
      const remoteConfigService = yield* RemoteConfigServiceTag;
      const appScope = yield* AppScopeTag;
      const service = new WidgetFeedService(authService, remoteConfigService);
      const onAuthenticated = (authState: AuthState) => {
        const accountId = authState.userInfo?.sub;
        if (accountId) service.activate(accountId);
      };
      const onLoggedOut = () => service.clear();
      authService.on("authenticated", onAuthenticated);
      authService.on("logged-out", onLoggedOut);
      const stopConfig = remoteConfigService.onChange(() =>
        service.onConfigChange(),
      );
      yield* Scope.addFinalizer(
        appScope,
        Effect.sync(() => {
          authService.off("authenticated", onAuthenticated);
          authService.off("logged-out", onLoggedOut);
          stopConfig();
        }),
      );
      yield* addRelease(
        appScope,
        "Shutting down widget feed service...",
        "widgetFeedService",
        () => service.clear(),
      );
      const authState = yield* Effect.promise(() =>
        runAuthEffect(authService.getAuthState()).catch(() => null),
      );
      if (authState?.isAuthenticated && authState.userInfo?.sub) {
        service.activate(authState.userInfo.sub);
      }
      logger.main.info("Widget feed service initialized");
      up("widgetFeedService");
      return service;
    }),
  );

  get(): WidgetFeedItem | null {
    return this.item;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  activate(accountId: string): void {
    if (accountId === this.accountId) return;
    this.resetAccount(accountId);
    this.syncPolling();
  }

  clear(): void {
    this.resetAccount(null);
  }

  onConfigChange(): void {
    this.syncPolling();
  }

  markDisplayed(itemId: string): void {
    if (this.displayedIds.has(itemId)) return;
    this.displayedIds.add(itemId);
    void this.report(itemId, "displayed");
  }

  /**
   * The card is done. Every close reports `dismissed`, after the click if
   * there was one, so the slot can serve its next item; the next poll
   * fetches it.
   */
  async close(itemId: string, clicked: boolean): Promise<void> {
    this.closedIds.add(itemId);
    if (this.item?.id === itemId) this.setItem(null);
    if (clicked) await this.report(itemId, "clicked");
    await this.report(itemId, "dismissed");
  }

  async refresh(): Promise<void> {
    const accountId = this.accountId;
    if (!accountId || !this.sequenzy || this.refused || !this.readFlag()) {
      return;
    }
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    try {
      const item = await this.fetchItem(accountId, request.signal);
      if (request.signal.aborted) return;
      this.setItem(item && !this.closedIds.has(item.id) ? item : null);
    } catch (error) {
      if (request.signal.aborted) return;
      // Keep the last item; the next poll tries again.
      logger.main.warn("Widget feed refresh failed", { error });
    } finally {
      if (this.request === request) this.request = null;
    }
  }

  private async report(
    itemId: string,
    event: "displayed" | "clicked" | "dismissed",
  ): Promise<void> {
    const accountId = this.accountId;
    const sequenzy = this.sequenzy;
    if (!accountId || !sequenzy) return;
    try {
      const response = await this.withIdentity(accountId, (id) =>
        postSequenzy(sequenzy, "/api/v1/in-app/feed/events", {
          email: id.email,
          identityToken: id.identityToken,
          messageId: itemId,
          type: event,
        }),
      );
      if (response && !response.ok) {
        logger.main.warn("Sequenzy did not record a widget feed event", {
          event,
          status: response.status,
        });
      }
    } catch (error) {
      logger.main.warn("Widget feed event failed", { event, error });
    }
  }

  private async fetchItem(
    accountId: string,
    signal: AbortSignal,
  ): Promise<WidgetFeedItem | null> {
    const sequenzy = this.sequenzy;
    if (!sequenzy) return null;
    const response = await this.withIdentity(accountId, (id) =>
      postSequenzy(
        sequenzy,
        "/api/v1/in-app/feed/placements",
        {
          email: id.email,
          identityToken: id.identityToken,
          placements: [WIDGET_FEED_PLACEMENT],
        },
        signal,
      ),
    );
    if (!response) return null;
    if (!response.ok) {
      throw new Error(`Sequenzy placements failed: HTTP ${response.status}`);
    }
    const parsed = PlacementsResponseSchema.safeParse(response.body);
    if (!parsed.success) throw new Error("Unexpected Sequenzy placements");
    const message = parsed.data.placements.find(
      (entry) => entry.placement === WIDGET_FEED_PLACEMENT,
    )?.message;
    if (!message) return null;
    const item = parseWidgetFeedItem(message);
    if (!item) {
      logger.main.warn("Dropped a widget feed item the card cannot draw");
    }
    return item;
  }

  /**
   * Runs a Sequenzy call as the account's contact. When Sequenzy rejects the
   * stored token, mints a new one once; null when the account has no contact.
   */
  private async withIdentity(
    accountId: string,
    call: (identity: Identity) => Promise<SequenzyResponse>,
  ): Promise<SequenzyResponse | null> {
    let identity = await this.getIdentity(accountId);
    if (!identity) return null;
    const response = await call(identity);
    if (!isIdentityRejected(response)) return response;
    if (this.identity === identity) this.identity = null;
    identity = await this.getIdentity(accountId);
    if (!identity) return null;
    const retry = await call(identity);
    if (isIdentityRejected(retry) && this.accountId === accountId) {
      // A token minted a moment ago is rejected too: retrying cannot help.
      this.refused = true;
      logger.main.warn("Sequenzy rejected a new identity token");
    }
    return retry;
  }

  /**
   * The cached identity, or one mint shared by every caller that needs it.
   * Null for an account that is no longer signed in: the shared mint may
   * already belong to the next one.
   */
  private getIdentity(accountId: string): Promise<Identity | null> {
    if (accountId !== this.accountId) return Promise.resolve(null);
    const cached = this.identity;
    if (
      cached?.accountId === accountId &&
      cached.expiresAt - TOKEN_RENEW_MARGIN_MS > Date.now()
    ) {
      return Promise.resolve(cached);
    }
    if (!this.minting) {
      const minting = this.mint(accountId).finally(() => {
        // An account change may have started another mint meanwhile.
        if (this.minting === minting) this.minting = null;
      });
      this.minting = minting;
    }
    return this.minting;
  }

  private async mint(accountId: string): Promise<Identity | null> {
    try {
      const { identityToken } = await getAccountResource(
        this.authService,
        accountId,
        {
          path: "/apps/v1/me/sequenzy-identity-token",
          method: "POST",
          parse: (body) => SequenzyIdentityTokenResponseSchema.parse(body),
          accountChangedMessage:
            "Account changed while loading the Sequenzy identity",
          fallbackMessage: "Unable to load the Sequenzy identity",
        },
      );
      const claims = readIdentityToken(identityToken);
      if (!claims) throw new Error("Unreadable Sequenzy identity token");
      if (this.accountId !== accountId) return null;
      this.identity = { accountId, identityToken, ...claims };
      return this.identity;
    } catch (error) {
      // 403: Sequenzy is off or refuses the email; 400: the account has no
      // email. Neither changes for this account.
      if (error instanceof AccessForbidden || error instanceof BadRequest) {
        if (this.accountId === accountId) this.refused = true;
        logger.main.info("Widget feed is not available for this account", {
          reason: error._tag,
        });
        return null;
      }
      throw error;
    }
  }

  private readFlag(): boolean {
    return (
      this.remoteConfigService.getConfig().flags[DESKTOP_WIDGET_FEED_FLAG] ===
      true
    );
  }

  private resetAccount(accountId: string | null): void {
    this.accountId = accountId;
    this.identity = null;
    this.minting = null;
    this.refused = false;
    this.closedIds.clear();
    this.displayedIds.clear();
    this.request?.abort();
    this.request = null;
    this.stopPolling();
    this.setItem(null);
  }

  /**
   * Polls while signed in with the flag on, starting with a fetch now. Flag
   * off: the card goes away at once.
   */
  private syncPolling(): void {
    const shouldPoll =
      this.sequenzy !== null && this.accountId !== null && this.readFlag();
    if (shouldPoll === (this.pollTimer !== null)) return;
    if (!shouldPoll) {
      this.stopPolling();
      this.request?.abort();
      this.setItem(null);
      return;
    }
    void this.refresh();
    this.pollTimer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private setItem(item: WidgetFeedItem | null): void {
    if (JSON.stringify(item) === JSON.stringify(this.item)) return;
    this.item = item;
    for (const listener of this.listeners) listener();
  }
}
