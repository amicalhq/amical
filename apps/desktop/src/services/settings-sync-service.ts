import { BrowserWindow, ipcMain } from "electron";
import { Mutex } from "async-mutex";
import { Effect, Layer } from "effect";

import { logger } from "../main/logger";
import { addRelease, step, up } from "../main/runtime/layer-helpers";
import {
  AppScopeTag,
  AuthServiceTag,
  SettingsSyncServiceTag,
} from "../main/runtime/tags";
import type { AuthService, AuthState } from "./auth-service";
import {
  SettingsSyncClient,
  SettingsSyncHttpError,
  type SyncBootstrap,
  type SyncPushMutation,
} from "./settings-sync-client";
import {
  adoptVisibleRows,
  applyPullPages,
  applyPushResults,
  beginUserSyncSession,
  capturePushHeads,
  clearSyncState,
  deactivateOrganizationSyncScopes,
  getPullCursors,
  hasResumableUserSyncState,
  pauseSyncSession,
  prepareVisibleRowsForFullSync,
  reconcileSyncScopes,
  registerLocalSyncMutationHandler,
  removeOrganizationSyncScope,
  resumeUserSyncSession,
  type CapturedSyncHead,
  type SyncContext,
} from "../db/sync";

const POLL_INTERVAL_MS = 5 * 60_000;
const EDIT_DEBOUNCE_MS = 750;

type SyncClient = Pick<SettingsSyncClient, "bootstrap" | "pull" | "push">;

class SyncScopeAuthorizationError extends Error {
  constructor(readonly context: SyncContext) {
    super(`Axis rejected the active ${context.scopeType} sync scope`);
  }
}

export class SettingsSyncService {
  private readonly client: SyncClient;
  private readonly localStateMutex = new Mutex();
  private initialized = false;
  private stopped = false;
  private currentContext: SyncContext | null = null;
  private currentContexts: SyncContext[] = [];
  private abortController: AbortController | null = null;
  private capabilities: SyncBootstrap | null = null;
  private worker: Promise<void> | null = null;
  private rerunRequested = false;
  private authorizationBlocked = false;
  private authenticationRefreshAttempted = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private unregisterBeforeLogout: (() => void) | null = null;
  private unregisterLocalMutation: (() => void) | null = null;

  private readonly onExternalWake = () => this.wake();

  private readonly onLoggedOut = () => {
    queueMicrotask(() => {
      if (this.initialized && !this.stopped) this.notifyRenderers();
    });
  };

  private readonly onAuthenticated = (authState: AuthState) => {
    const accountId = authState.userInfo?.sub;
    if (!accountId) return;
    void this.activateAccount(accountId, "full").catch((error) => {
      logger.main.error("Failed to start settings sync after login", error);
    });
  };

  private readonly onTokenRefreshed = (authState: AuthState) => {
    const accountId = authState.userInfo?.sub;
    if (!accountId || accountId !== this.currentContext?.accountId) return;
    void this.restartAfterTokenRefresh(accountId).catch((error) => {
      logger.main.error("Failed to restart settings sync after token refresh", {
        error,
      });
    });
  };

  private constructor(
    private readonly authService: AuthService,
    client?: SyncClient,
  ) {
    this.client = client ?? new SettingsSyncClient(authService);
  }

  /**
   * The graph awaits local account binding before any window is created.
   * Token refresh and sync I/O run in the background worker.
   */
  static readonly Live: Layer.Layer<
    SettingsSyncServiceTag,
    never,
    AuthServiceTag | AppScopeTag
  > = Layer.effect(
    SettingsSyncServiceTag,
    Effect.gen(function* () {
      const authService = yield* AuthServiceTag;
      const appScope = yield* AppScopeTag;
      const service = new SettingsSyncService(authService);
      yield* addRelease(
        appScope,
        "Shutting down settings sync service...",
        "settingsSyncService",
        () => service.shutdown(),
      );
      yield* step(() => service.initialize());
      logger.main.info("Settings sync service created");
      up("settingsSyncService");
      return service;
    }),
  );

  static createForTests(
    authService: AuthService,
    client?: SyncClient,
  ): SettingsSyncService {
    return new SettingsSyncService(authService, client);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.stopped = false;
    const initializationController = new AbortController();
    this.abortController?.abort();
    this.abortController = initializationController;

    this.unregisterBeforeLogout = this.authService.registerBeforeLogoutHandler(
      () => this.handleBeforeLogout(),
    );
    this.authService.on("authenticated", this.onAuthenticated);
    this.authService.on("logged-out", this.onLoggedOut);
    this.authService.on("token-refreshed", this.onTokenRefreshed);
    this.unregisterLocalMutation = registerLocalSyncMutationHandler(() =>
      this.scheduleDebouncedWake(),
    );
    ipcMain.on("settings-sync-wake", this.onExternalWake);

    this.pollTimer = setInterval(() => this.wake(), POLL_INTERVAL_MS);
    this.pollTimer.unref?.();

    const authState = await this.authService.getAuthState();
    if (
      this.stopped ||
      !this.initialized ||
      initializationController.signal.aborted
    ) {
      return;
    }
    if (authState?.isAuthenticated && authState.userInfo?.sub) {
      const canResume = await this.runLocalTransition(() =>
        hasResumableUserSyncState(authState.userInfo!.sub),
      );
      if (initializationController.signal.aborted) return;
      await this.activateAccount(
        authState.userInfo.sub,
        canResume ? "resume" : "full",
      );
    } else {
      await this.runLocalTransition(() => clearSyncState());
      this.notifyRenderers();
    }
  }

  wake(): void {
    if (this.stopped || this.authorizationBlocked || !this.currentContext)
      return;
    this.rerunRequested = true;
    if (this.worker) return;

    this.worker = this.runWorker()
      .catch((error) => {
        logger.main.error("Settings sync worker failed", error);
      })
      .finally(() => {
        this.worker = null;
        if (this.rerunRequested && !this.stopped) this.wake();
      });
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    this.stopped = true;
    this.initialized = false;

    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.pollTimer = null;
    this.debounceTimer = null;

    this.authService.off("authenticated", this.onAuthenticated);
    this.authService.off("logged-out", this.onLoggedOut);
    this.authService.off("token-refreshed", this.onTokenRefreshed);
    ipcMain.removeListener("settings-sync-wake", this.onExternalWake);
    this.unregisterBeforeLogout?.();
    this.unregisterLocalMutation?.();
    this.unregisterBeforeLogout = null;
    this.unregisterLocalMutation = null;

    this.abortController?.abort();
    this.abortController = null;
    this.currentContext = null;
    this.currentContexts = [];
    this.capabilities = null;
    this.authorizationBlocked = false;
    this.authenticationRefreshAttempted = false;
    pauseSyncSession();
    await this.worker;
  }

  private async handleBeforeLogout(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.abortController?.abort();
    this.abortController = null;
    this.currentContext = null;
    this.currentContexts = [];
    this.capabilities = null;
    this.rerunRequested = false;
    this.authorizationBlocked = false;
    this.authenticationRefreshAttempted = false;
    pauseSyncSession();
    await this.runLocalTransition(() => clearSyncState());
  }

  private async activateAccount(
    accountId: string,
    mode: "full" | "resume",
  ): Promise<void> {
    this.authorizationBlocked = false;
    this.authenticationRefreshAttempted = false;
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this.currentContext = null;
    this.currentContexts = [];
    this.capabilities = null;
    pauseSyncSession();
    if (mode === "full") {
      await this.runLocalTransition(() => clearSyncState());
      this.notifyRenderers();
    }
    if (this.stopped || controller.signal.aborted) {
      if (this.stopped) pauseSyncSession();
      return;
    }

    const context = await this.runLocalTransition(() =>
      mode === "full"
        ? beginUserSyncSession(accountId)
        : resumeUserSyncSession(accountId),
    );
    if (this.stopped || controller.signal.aborted) {
      if (this.stopped) pauseSyncSession();
      return;
    }

    if (
      !(await this.runLocalTransition(async () => {
        if (!(await prepareVisibleRowsForFullSync(context))) return false;
        return adoptVisibleRows(context);
      }))
    ) {
      return;
    }
    if (this.stopped || controller.signal.aborted) {
      if (this.stopped) pauseSyncSession();
      return;
    }

    this.currentContext = context;
    this.currentContexts = [context];
    this.wake();
  }

  private async restartAfterTokenRefresh(accountId: string): Promise<void> {
    const context = this.currentContext;
    if (!context || context.accountId !== accountId) return;

    this.authorizationBlocked = true;
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this.capabilities = null;
    const hadOrganization = this.currentContexts.some(
      (candidate) => candidate.scopeType === "org",
    );
    this.currentContexts = [context];
    const organizationDeactivated = await this.runLocalTransition(async () =>
      deactivateOrganizationSyncScopes(),
    );
    if (
      this.stopped ||
      controller !== this.abortController ||
      accountId !== this.currentContext?.accountId
    ) {
      return;
    }

    this.authorizationBlocked = false;
    if (hadOrganization || organizationDeactivated) this.notifyRenderers();
    this.wake();
  }

  private scheduleDebouncedWake(): void {
    if (this.stopped || this.authorizationBlocked || !this.currentContext)
      return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.wake();
    }, EDIT_DEBOUNCE_MS);
  }

  private async runWorker(): Promise<void> {
    while (this.rerunRequested && !this.stopped) {
      this.rerunRequested = false;
      const context = this.currentContext;
      const controller = this.abortController;
      if (!context || !controller) return;

      try {
        await this.runIncrementalSync(context, controller.signal);
        if (!controller.signal.aborted) {
          this.authenticationRefreshAttempted = false;
        }
      } catch (error) {
        if (controller.signal.aborted || this.stopped) continue;
        if (error instanceof SyncScopeAuthorizationError) {
          this.authorizationBlocked = true;
          this.rerunRequested = false;
          logger.main.warn(
            "Axis rejected the active user sync scope; waiting for auth change",
            { error },
          );
          return;
        }
        if (error instanceof SettingsSyncHttpError && error.status === 401) {
          this.authorizationBlocked = true;
          this.rerunRequested = false;
          logger.main.warn(
            "Settings sync authentication failed; waiting for auth change",
            { error },
          );
          if (!this.authenticationRefreshAttempted) {
            this.authenticationRefreshAttempted = true;
            await this.authService.refreshTokenIfNeeded(true);
          }
          return;
        }
        if (error instanceof SettingsSyncHttpError && error.status === 403) {
          const changed = await this.removeAllOrganizationScopes(
            context,
            controller.signal,
          );
          if (controller.signal.aborted || this.stopped) continue;
          if (changed) this.notifyRenderers();
          this.authorizationBlocked = true;
          this.rerunRequested = false;
          logger.main.warn(
            "Settings sync authorization failed; waiting for auth change",
            { error },
          );
          return;
        }
        logger.main.warn(
          "Settings sync attempt failed; durable work retained",
          {
            error,
          },
        );
      }
    }
  }

  private async runIncrementalSync(
    context: SyncContext,
    signal: AbortSignal,
  ): Promise<void> {
    const capabilities = await this.client.bootstrap(context.accountId, signal);
    if (signal.aborted) return;
    const reconciled = await this.runLocalTransition(() =>
      reconcileSyncScopes(context.accountId, capabilities.scopes),
    );
    if (!reconciled || signal.aborted) return;
    this.capabilities = capabilities;
    this.currentContexts = reconciled.contexts;
    if (reconciled.organizationChanged || reconciled.capabilityChanged) {
      this.notifyRenderers();
    }
    if (capabilities.collections.length === 0) return;

    for (const scopeContext of reconciled.contexts) {
      const scope = capabilities.scopes.find(
        (candidate) =>
          candidate.scopeType === scopeContext.scopeType &&
          candidate.scopeId === scopeContext.scopeId,
      );
      if (!scope) continue;
      try {
        if (scope.canWrite) {
          await this.pushUntilDrained(scopeContext, signal);
          if (signal.aborted) return;
        }
        await this.pullUntilCurrent(scopeContext, signal);
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof SyncScopeAuthorizationError) {
          if (scopeContext.scopeType !== "org") throw error;
          const changed = await this.deactivateOrganizationScopes(signal);
          if (signal.aborted) return;
          if (changed) this.notifyRenderers();
          this.rerunRequested = true;
          return;
        }
        if (
          scopeContext.scopeType === "org" &&
          error instanceof SettingsSyncHttpError &&
          error.status === 403
        ) {
          if (
            await this.runLocalTransition(() =>
              removeOrganizationSyncScope(scopeContext),
            )
          ) {
            this.currentContexts = this.currentContexts.filter(
              (candidate) =>
                candidate.scopeType !== "org" ||
                candidate.scopeId !== scopeContext.scopeId,
            );
            this.notifyRenderers();
          }
          continue;
        }
        throw error;
      }
      if (signal.aborted) return;
    }
  }

  private async pullUntilCurrent(
    context: SyncContext,
    signal: AbortSignal,
  ): Promise<void> {
    const capabilities = this.capabilities;
    if (!capabilities) throw new Error("Settings sync is not bootstrapped");

    let changed = false;
    try {
      while (!signal.aborted) {
        const cursors = await this.runLocalTransition(async () =>
          signal.aborted
            ? null
            : getPullCursors(context, capabilities.collections),
        );
        if (cursors === null) return;
        const page = await this.client.pull(
          context.scopeType,
          context.scopeId,
          cursors,
          capabilities.pullLimit,
          signal,
        );
        if (signal.aborted) return;
        if (
          !(await this.runLocalTransition(async () =>
            signal.aborted ? false : applyPullPages(context, page.collections),
          ))
        ) {
          return;
        }
        changed ||= page.collections.some(
          (collection) => collection.items.length > 0,
        );
        if (page.collections.every((collection) => !collection.hasMore)) break;
      }
    } finally {
      if (changed && !signal.aborted) this.notifyRenderers();
    }
  }

  private async pushUntilDrained(
    context: SyncContext,
    signal: AbortSignal,
  ): Promise<void> {
    const capabilities = this.capabilities;
    if (!capabilities) throw new Error("Settings sync is not bootstrapped");

    while (!signal.aborted) {
      const heads = await this.runLocalTransition(async () =>
        signal.aborted
          ? []
          : capturePushHeads(context, undefined, capabilities.collections),
      );
      if (heads.length === 0) return;
      const batch = this.buildPushBatch(
        heads,
        capabilities.maxPushBatch,
        capabilities.maxPushBytes,
      );

      const results = await this.client.push(batch.mutations, signal);
      if (signal.aborted) return;
      if (
        results.some(
          (result) =>
            result.status === "error" && result.reason === "unauthorized_scope",
        )
      ) {
        throw new SyncScopeAuthorizationError(context);
      }
      if (
        !(await this.runLocalTransition(async () =>
          signal.aborted
            ? false
            : applyPushResults(context, batch.heads, results),
        ))
      ) {
        return;
      }
      if (results.some((result) => result.status !== "ok")) {
        this.notifyRenderers();
      }
    }
  }

  private buildPushBatch(
    heads: CapturedSyncHead[],
    maxCount: number,
    maxBytes: number,
  ): { heads: CapturedSyncHead[]; mutations: SyncPushMutation[] } {
    const selectedHeads: CapturedSyncHead[] = [];
    const mutations: SyncPushMutation[] = [];

    for (const head of heads) {
      if (selectedHeads.length >= maxCount) break;
      const mutation: SyncPushMutation = {
        collection: head.collection,
        scopeType: head.scopeType,
        scopeId: head.scopeId,
        syncId: head.syncId,
        expectedSyncVersion: head.headExpectedSyncVersion,
        payload: head.headPayload,
      };
      const candidate = [...mutations, mutation];
      const bytes = Buffer.byteLength(
        JSON.stringify({ mutations: candidate }),
        "utf8",
      );
      if (bytes > maxBytes) {
        if (mutations.length === 0) {
          throw new Error("Valid singleton sync mutation exceeds server cap");
        }
        break;
      }
      selectedHeads.push(head);
      mutations.push(mutation);
    }

    if (mutations.length === 0) {
      throw new Error("Unable to construct a settings sync push batch");
    }
    return { heads: selectedHeads, mutations };
  }

  private async deactivateOrganizationScopes(
    signal: AbortSignal,
  ): Promise<boolean> {
    const hadOrganization = this.currentContexts.some(
      (context) => context.scopeType === "org",
    );
    const deactivated = await this.runLocalTransition(async () =>
      signal.aborted ? false : deactivateOrganizationSyncScopes(),
    );
    if (signal.aborted) return false;
    this.currentContexts = this.currentContexts.filter(
      (context) => context.scopeType !== "org",
    );
    this.capabilities = null;
    return hadOrganization || deactivated;
  }

  private async removeAllOrganizationScopes(
    context: SyncContext,
    signal: AbortSignal,
  ): Promise<boolean> {
    const hadOrganization = this.currentContexts.some(
      (candidate) => candidate.scopeType === "org",
    );
    const reconciled = await this.runLocalTransition(async () =>
      signal.aborted
        ? null
        : reconcileSyncScopes(context.accountId, [
            {
              scopeType: "user",
              scopeId: context.accountId,
              role: null,
              canWrite: true,
              latestSyncVersion: 0,
            },
          ]),
    );
    if (!reconciled || signal.aborted) return false;
    this.currentContexts = reconciled.contexts;
    this.capabilities = null;
    return hadOrganization || reconciled.organizationChanged;
  }

  private notifyRenderers(): void {
    let windows: BrowserWindow[];
    try {
      windows = BrowserWindow.getAllWindows();
    } catch (error) {
      logger.main.warn("Failed to enumerate settings sync renderers", {
        error,
      });
      return;
    }

    for (const window of windows) {
      try {
        if (window.isDestroyed() || window.webContents.isDestroyed?.())
          continue;
        window.webContents.send("settings-sync-updated");
      } catch (error) {
        logger.main.warn("Failed to notify renderer of settings sync update", {
          error,
          windowId: window.id,
        });
      }
    }
  }

  private runLocalTransition<T>(callback: () => Promise<T>): Promise<T> {
    return this.localStateMutex.runExclusive(callback);
  }
}
