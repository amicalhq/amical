import { BrowserWindow, ipcMain } from "electron";
import { Mutex } from "async-mutex";
import { Effect, Layer } from "effect";

import { logger } from "../main/logger";
import { addRelease, up } from "../main/runtime/layer-helpers";
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
  fenceSyncSession,
  getActiveSyncFence,
  getPullCursors,
  hasPendingSyncWork,
  pauseSyncSession,
  prepareVisibleRowsForFullSync,
  registerLocalSyncMutationHandler,
  resumeUserSyncSession,
  type CapturedSyncHead,
  type SyncFence,
} from "../db/sync";

const POLL_INTERVAL_MS = 5 * 60_000;
const EDIT_DEBOUNCE_MS = 750;
const MAX_PUSH_ROUNDS_PER_WAKE = 100;

type SyncClient = Pick<SettingsSyncClient, "bootstrap" | "pull" | "push">;

export class SettingsSyncService {
  private readonly client: SyncClient;
  private readonly localStateMutex = new Mutex();
  private initialized = false;
  private stopped = false;
  private identityGeneration = 0;
  private currentFence: SyncFence | null = null;
  private abortController: AbortController | null = null;
  private capabilities: SyncBootstrap | null = null;
  private worker: Promise<void> | null = null;
  private rerunRequested = false;
  private authorizationBlocked = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private unregisterBeforeLogout: (() => void) | null = null;
  private unregisterLocalMutation: (() => void) | null = null;

  private readonly onExternalWake = () => this.wake();

  private readonly onAuthenticated = (authState: AuthState) => {
    const accountId = authState.userInfo?.sub;
    if (!accountId) return;
    void this.activateAccount(accountId, "full").catch((error) => {
      logger.main.error("Failed to start settings sync after login", error);
    });
  };

  private readonly onTokenRefreshed = (authState: AuthState) => {
    const accountId = authState.userInfo?.sub;
    if (
      !this.authorizationBlocked ||
      !accountId ||
      accountId !== this.currentFence?.accountId
    ) {
      return;
    }
    this.authorizationBlocked = false;
    this.wake();
  };

  private constructor(
    private readonly authService: AuthService,
    client?: SyncClient,
  ) {
    this.client = client ?? new SettingsSyncClient(authService);
  }

  /**
   * The graph owns the service and starts it without awaiting authentication
   * or sync I/O, so it does not block graph construction or window startup.
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
      void service.initialize().catch((error) => {
        logger.main.error("Failed to initialize settings sync service", error);
      });
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

    this.unregisterBeforeLogout = this.authService.registerBeforeLogoutHandler(
      () => this.handleBeforeLogout(),
    );
    this.authService.on("authenticated", this.onAuthenticated);
    this.authService.on("token-refreshed", this.onTokenRefreshed);
    this.unregisterLocalMutation = registerLocalSyncMutationHandler(() =>
      this.scheduleDebouncedWake(),
    );
    ipcMain.on("settings-sync-wake", this.onExternalWake);

    this.pollTimer = setInterval(() => this.wake(), POLL_INTERVAL_MS);
    this.pollTimer.unref?.();

    const isAuthenticated = await this.authService.isAuthenticated();
    const authState = isAuthenticated
      ? await this.authService.getAuthState()
      : null;
    if (this.stopped || !this.initialized) return;
    if (authState?.userInfo?.sub) {
      const activeFence = await this.runLocalTransition(() =>
        getActiveSyncFence(),
      );
      await this.activateAccount(
        authState.userInfo.sub,
        activeFence?.accountId === authState.userInfo.sub ? "resume" : "full",
      );
    } else {
      await this.runLocalTransition(() => fenceSyncSession());
    }
  }

  wake(): void {
    if (this.stopped || this.authorizationBlocked || !this.currentFence) return;
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
    this.identityGeneration += 1;

    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.pollTimer = null;
    this.debounceTimer = null;

    this.authService.off("authenticated", this.onAuthenticated);
    this.authService.off("token-refreshed", this.onTokenRefreshed);
    ipcMain.removeListener("settings-sync-wake", this.onExternalWake);
    this.unregisterBeforeLogout?.();
    this.unregisterLocalMutation?.();
    this.unregisterBeforeLogout = null;
    this.unregisterLocalMutation = null;

    this.abortController?.abort();
    this.abortController = null;
    this.currentFence = null;
    this.capabilities = null;
    this.authorizationBlocked = false;
    await this.runLocalTransition(() => pauseSyncSession());
    await this.worker;
  }

  private async handleBeforeLogout(): Promise<void> {
    this.identityGeneration += 1;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.abortController?.abort();
    this.abortController = null;
    this.currentFence = null;
    this.capabilities = null;
    this.rerunRequested = false;
    this.authorizationBlocked = false;
    await this.runLocalTransition(() => fenceSyncSession());
  }

  private async activateAccount(
    accountId: string,
    mode: "full" | "resume",
  ): Promise<void> {
    const generation = ++this.identityGeneration;
    this.authorizationBlocked = false;
    this.abortController?.abort();
    this.abortController = null;
    this.currentFence = null;
    this.capabilities = null;
    await this.runLocalTransition(() => fenceSyncSession());
    if (this.stopped || generation !== this.identityGeneration) return;

    const fence = await this.runLocalTransition(() =>
      mode === "full"
        ? beginUserSyncSession(accountId)
        : resumeUserSyncSession(accountId),
    );
    if (this.stopped || generation !== this.identityGeneration) {
      await this.runLocalTransition(() => fenceSyncSession());
      return;
    }

    if (
      !(await this.runLocalTransition(async () => {
        if (!(await prepareVisibleRowsForFullSync(fence))) return false;
        return adoptVisibleRows(fence);
      }))
    ) {
      return;
    }
    if (this.stopped || generation !== this.identityGeneration) {
      await this.runLocalTransition(() => fenceSyncSession());
      return;
    }

    this.currentFence = fence;
    this.abortController = new AbortController();
    this.wake();
  }

  private scheduleDebouncedWake(): void {
    if (this.stopped || this.authorizationBlocked || !this.currentFence) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.wake();
    }, EDIT_DEBOUNCE_MS);
  }

  private async runWorker(): Promise<void> {
    while (this.rerunRequested && !this.stopped) {
      this.rerunRequested = false;
      const fence = this.currentFence;
      const controller = this.abortController;
      if (!fence || !controller) return;

      try {
        await this.runIncrementalSync(fence, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || this.stopped) continue;
        if (
          error instanceof SettingsSyncHttpError &&
          (error.status === 401 || error.status === 403)
        ) {
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
    fence: SyncFence,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.capabilities) {
      const capabilities = await this.client.bootstrap(fence.accountId, signal);
      if (signal.aborted || this.currentFence !== fence) return;
      this.capabilities = capabilities;
    }
    if (this.capabilities.collections.length === 0) return;
    await this.pushUntilDrained(fence, signal);
    await this.pullUntilCurrent(fence, signal);
  }

  private async pullUntilCurrent(
    fence: SyncFence,
    signal: AbortSignal,
  ): Promise<void> {
    const capabilities = this.capabilities;
    if (!capabilities) throw new Error("Settings sync is not bootstrapped");

    let changed = false;
    while (!signal.aborted) {
      const cursors = await this.runLocalTransition(() =>
        getPullCursors(fence, capabilities.collections),
      );
      if (cursors === null) return;
      const page = await this.client.pull(
        fence.scopeType,
        fence.scopeId,
        cursors,
        capabilities.pullLimit,
        signal,
      );
      if (
        !(await this.runLocalTransition(() =>
          applyPullPages(fence, page.collections),
        ))
      ) {
        return;
      }
      changed ||= page.collections.some(
        (collection) => collection.items.length > 0,
      );
      if (page.collections.every((collection) => !collection.hasMore)) break;
    }
    if (changed) this.notifyRenderers();
  }

  private async pushUntilDrained(
    fence: SyncFence,
    signal: AbortSignal,
  ): Promise<void> {
    const capabilities = this.capabilities;
    if (!capabilities) throw new Error("Settings sync is not bootstrapped");

    for (
      let round = 0;
      round < MAX_PUSH_ROUNDS_PER_WAKE && !signal.aborted;
      round++
    ) {
      const heads = await this.runLocalTransition(() =>
        capturePushHeads(fence, undefined, capabilities.collections),
      );
      if (heads.length === 0) return;
      const batch = this.buildPushBatch(
        heads,
        capabilities.maxPushBatch,
        capabilities.maxPushBytes,
      );

      const results = await this.client.push(batch.mutations, signal);
      if (
        results.some(
          (result) =>
            result.status === "error" && result.reason === "unauthorized_scope",
        )
      ) {
        throw new SettingsSyncHttpError("Unauthorized sync scope", 403);
      }
      if (
        !(await this.runLocalTransition(() =>
          applyPushResults(fence, batch.heads, results),
        ))
      ) {
        return;
      }
      if (results.some((result) => result.status !== "ok")) {
        this.notifyRenderers();
      }
    }

    if (
      await this.runLocalTransition(() =>
        hasPendingSyncWork(fence, undefined, capabilities.collections),
      )
    ) {
      this.rerunRequested = true;
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

  private notifyRenderers(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("settings-sync-updated");
      }
    }
  }

  private runLocalTransition<T>(callback: () => Promise<T>): Promise<T> {
    return this.localStateMutex.runExclusive(callback);
  }
}
