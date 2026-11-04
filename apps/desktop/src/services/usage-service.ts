import { Effect, Layer, Scope } from "effect";
import { logger } from "../main/logger";
import { addRelease, up } from "../main/runtime/layer-helpers";
import {
  AppScopeTag,
  AuthServiceTag,
  UsageServiceTag,
} from "../main/runtime/tags";
import { getAccountResource } from "./account-request";
import {
  runAuthEffect,
  type AuthService,
  type AuthState,
} from "./auth-service";
import { cloudUsageEvents } from "./cloud-usage-events";
import { parseCloudUsage, type CloudUsage } from "../types/usage";

// The server writes dictation word counts to the database every 10 s, so a
// read right after a dictation returns the old number.
const AFTER_DICTATION_DELAY_MS = 15_000;
const AFTER_DICTATION_MAX_WAIT_MS = 60_000;
// Catches usage from other devices, plan changes and the window reset.
const POLL_INTERVAL_MS = 15 * 60_000;
const STALE_AFTER_MS = 60_000;

/**
 * The signed-in account's cloud word allowance for the sidebar meter. The
 * server makes every display decision; this service only fetches and caches.
 */
export class UsageService {
  private accountId: string | null = null;
  private usage: CloudUsage | null = null;
  // Aborted on every account change, so an old response cannot show another
  // account's numbers.
  private request: AbortController | null = null;
  private lastFetchAt = 0;
  private afterDictationTimer: ReturnType<typeof setTimeout> | null = null;
  private afterDictationFirstAt: number | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private watchers = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly authService: AuthService) {}

  static readonly Live: Layer.Layer<
    UsageServiceTag,
    never,
    AuthServiceTag | AppScopeTag
  > = Layer.effect(
    UsageServiceTag,
    Effect.gen(function* () {
      const authService = yield* AuthServiceTag;
      const appScope = yield* AppScopeTag;
      const service = new UsageService(authService);
      const onAuthenticated = (authState: AuthState) => {
        const accountId = authState.userInfo?.sub;
        if (accountId) service.activate(accountId);
      };
      const onLoggedOut = () => service.clear();
      const onCloudUsage = (quotaExceeded: boolean) =>
        service.refreshAfterDictation(quotaExceeded);
      authService.on("authenticated", onAuthenticated);
      authService.on("logged-out", onLoggedOut);
      cloudUsageEvents.on("changed", onCloudUsage);
      yield* Scope.addFinalizer(
        appScope,
        Effect.sync(() => {
          authService.off("authenticated", onAuthenticated);
          authService.off("logged-out", onLoggedOut);
          cloudUsageEvents.off("changed", onCloudUsage);
        }),
      );
      yield* addRelease(
        appScope,
        "Shutting down usage service...",
        "usageService",
        () => service.clear(),
      );
      const authState = yield* Effect.promise(() =>
        runAuthEffect(authService.getAuthState()).catch(() => null),
      );
      if (authState?.isAuthenticated && authState.userInfo?.sub) {
        service.activate(authState.userInfo.sub);
      }
      logger.main.info("Usage service initialized");
      up("usageService");
      return service;
    }),
  );

  get(): CloudUsage | null {
    // A value from a window that has already reset is not served.
    const resetsAt = this.usage?.cloudWords?.resetsAt;
    if (resetsAt && Date.parse(resetsAt) <= Date.now()) return null;
    return this.usage;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A visible meter. Polls while at least one watcher is open. */
  watch(): () => void {
    this.watchers += 1;
    if (this.watchers === 1) this.schedulePoll();
    return () => {
      this.watchers -= 1;
      if (this.watchers === 0) this.cancelPoll();
    };
  }

  /** Window focus or return from the web billing page. */
  refreshIfStale(): void {
    // No meter for this plan: a plan change shows within one poll interval.
    const staleAfter = this.serverHidesMeter()
      ? POLL_INTERVAL_MS
      : STALE_AFTER_MS;
    if (Date.now() - this.lastFetchAt < staleAfter) return;
    void this.refresh();
  }

  activate(accountId: string): void {
    if (accountId !== this.accountId) {
      this.accountId = accountId;
      this.usage = null;
      this.cancelAfterDictation();
      this.publish();
    }
    // No visible meter (hidden window, local model): read when one is shown.
    if (this.watchers > 0) void this.refresh();
    else this.lastFetchAt = 0;
    this.schedulePoll();
  }

  clear(): void {
    this.accountId = null;
    this.usage = null;
    this.request?.abort();
    this.request = null;
    this.cancelAfterDictation();
    this.cancelPoll();
    this.publish();
  }

  /** Trailing debounce, so a burst of dictations gives one read. */
  refreshAfterDictation(quotaExceeded = false): void {
    if (!this.accountId) return;
    // A quota rejection proves a cap now applies, even if the last read had
    // no meter.
    if (this.serverHidesMeter() && !quotaExceeded) return;
    // Nobody sees the meter: read once when it is next shown or focused.
    if (this.watchers === 0) {
      this.lastFetchAt = 0;
      return;
    }
    const now = Date.now();
    this.afterDictationFirstAt ??= now;
    const delay = Math.min(
      AFTER_DICTATION_DELAY_MS,
      this.afterDictationFirstAt + AFTER_DICTATION_MAX_WAIT_MS - now,
    );
    if (this.afterDictationTimer) clearTimeout(this.afterDictationTimer);
    this.afterDictationTimer = setTimeout(
      () => {
        this.cancelAfterDictation();
        void this.refresh();
      },
      Math.max(0, delay),
    );
    this.afterDictationTimer.unref?.();
  }

  /** The last successful read said: no meter (no cap, pooled plan). */
  private serverHidesMeter(): boolean {
    return this.usage !== null && this.usage.cloudWords === null;
  }

  private cancelAfterDictation(): void {
    if (this.afterDictationTimer) clearTimeout(this.afterDictationTimer);
    this.afterDictationTimer = null;
    this.afterDictationFirstAt = null;
  }

  private schedulePoll(): void {
    this.cancelPoll();
    if (this.watchers === 0 || !this.accountId) return;
    const jitterMs = Math.floor(Math.random() * 60_000);
    this.pollTimer = setTimeout(() => {
      void this.refresh();
      this.schedulePoll();
    }, POLL_INTERVAL_MS + jitterMs);
    this.pollTimer.unref?.();
  }

  private cancelPoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private async refresh(): Promise<void> {
    const accountId = this.accountId;
    if (!accountId) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.lastFetchAt = Date.now();
    try {
      const value = await getAccountResource(
        this.authService,
        accountId,
        {
          path: "/apps/v1/me/usage",
          parse: parseCloudUsage,
          accountChangedMessage: "Account changed while loading usage",
          fallbackMessage: "Unable to load cloud usage",
        },
        request.signal,
      );
      if (request.signal.aborted) return;
      this.usage = value;
    } catch (error) {
      if (request.signal.aborted) return;
      // Keep the last value; get() stops serving it once its window resets.
      // A failed read is not fresh, so the next focus tries again.
      this.lastFetchAt = 0;
      logger.main.warn("Cloud usage refresh failed", { error });
      return;
    } finally {
      if (this.request === request) this.request = null;
    }
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}
