import { BrowserWindow, ipcMain } from "electron";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberId,
  Layer,
  Option,
  Queue,
  Ref,
  Runtime,
  Scope,
} from "effect";

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

type AttemptResult = { rebootstrap: boolean };

type LifecyclePhase = "stopped" | "starting" | "running" | "stopping";

type RunningAttempt = {
  id: number;
  epoch: number;
  fiber: Fiber.RuntimeFiber<void, never>;
};

type SupervisorState = {
  epoch: number;
  context: SyncContext | null;
  attempt: RunningAttempt | null;
  debounce: Fiber.RuntimeFiber<void, never> | null;
  rerunRequested: boolean;
  authorizationBlocked: boolean;
  authenticationRefreshAttempted: boolean;
  nextAttemptId: number;
};

type ControlEvent =
  | {
      _tag: "Initialize";
      epoch: number;
      authState: AuthState | null;
      ack: Deferred.Deferred<void, unknown>;
    }
  | { _tag: "Wake"; epoch: number }
  | { _tag: "LocalMutation" }
  | { _tag: "Authenticated"; epoch: number; accountId: string }
  | { _tag: "TokenRefreshed"; epoch: number; accountId: string }
  | { _tag: "LoggedOut" }
  | {
      _tag: "BeforeLogout";
      epoch: number;
      ack: Deferred.Deferred<void, unknown>;
    }
  | {
      _tag: "AttemptFinished";
      id: number;
      epoch: number;
      exit: Exit.Exit<AttemptResult, unknown>;
    }
  | {
      _tag: "Shutdown";
      epoch: number;
      ack: Deferred.Deferred<void, unknown>;
    };

class SyncScopeAuthorizationError extends Error {
  constructor(readonly context: SyncContext) {
    super(`Axis rejected the active ${context.scopeType} sync scope`);
  }
}

export class SettingsSyncService {
  private lifecyclePhase: LifecyclePhase = "stopped";
  private lifecycleGeneration = 0;
  private lifecycleIntent = 0;
  private desiredRunning = false;
  private runResourcesClosed = false;
  private supervisorStarted = false;
  private boundaryEpoch = 0;
  private activeAccountId: string | null = null;
  private wakeAdmissionOpen = false;
  private wakeEventQueued = false;
  private localMutationEventQueued = false;
  private localMutationEpoch = 0;
  private localMutationDeadline = 0;
  private currentAttemptId: number | null = null;
  private currentAttemptFiber: Fiber.RuntimeFiber<void, never> | null = null;
  private currentDebounceFiber: Fiber.RuntimeFiber<void, never> | null = null;
  private initializePromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private unregisterBeforeLogout: (() => void) | null = null;
  private unregisterLocalMutation: (() => void) | null = null;

  private readonly onExternalWake = () => this.wake();

  private readonly onLoggedOut = () => {
    if (!this.initialized || this.stopping) return;
    this.offer({ _tag: "LoggedOut" });
  };

  private readonly onAuthenticated = (authState: AuthState) => {
    const accountId = authState.userInfo?.sub;
    if (!accountId || !this.initialized || this.stopping) return;
    const epoch = this.fenceBoundary(true, false);
    this.offer({ _tag: "Authenticated", epoch, accountId });
  };

  private readonly onTokenRefreshed = (authState: AuthState) => {
    const accountId = authState.userInfo?.sub;
    if (
      !accountId ||
      accountId !== this.activeAccountId ||
      !this.initialized ||
      this.stopping
    ) {
      return;
    }
    const epoch = this.fenceBoundary(false, false);
    this.offer({ _tag: "TokenRefreshed", epoch, accountId });
  };

  private constructor(
    private readonly authService: AuthService,
    private readonly client: SyncClient,
    private readonly runtime: Runtime.Runtime<never>,
    private serviceScope: Scope.CloseableScope,
    private events: Queue.Queue<ControlEvent>,
    private readonly dbSemaphore: Effect.Semaphore,
    private supervisorDone: Deferred.Deferred<void>,
  ) {}

  private static make(
    authService: AuthService,
    client?: SyncClient,
    runtime: Runtime.Runtime<never> = Runtime.defaultRuntime,
  ): Effect.Effect<SettingsSyncService> {
    return Effect.gen(function* () {
      const serviceScope = yield* Scope.make();
      const events = yield* Queue.unbounded<ControlEvent>();
      const dbSemaphore = yield* Effect.makeSemaphore(1);
      const supervisorDone = yield* Deferred.make<void>();
      return new SettingsSyncService(
        authService,
        client ?? new SettingsSyncClient(authService),
        runtime,
        serviceScope,
        events,
        dbSemaphore,
        supervisorDone,
      );
    });
  }

  /**
   * The graph awaits local account binding before any window is created.
   * Token refresh and sync I/O run in scoped background fibers.
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
      const runtime = yield* Effect.runtime<never>();
      const service = yield* SettingsSyncService.make(
        authService,
        undefined,
        runtime,
      );
      yield* addRelease(
        appScope,
        "Shutting down settings sync service...",
        "settingsSyncService",
        () => service.shutdown(),
      );
      yield* Effect.uninterruptible(
        service.initializeEffect().pipe(Effect.orDie),
      );
      logger.main.info("Settings sync service created");
      up("settingsSyncService");
      return service;
    }),
  );

  static createForTests(
    authService: AuthService,
    client?: SyncClient,
  ): SettingsSyncService {
    return Effect.runSync(SettingsSyncService.make(authService, client));
  }

  initialize(): Promise<void> {
    if (
      (this.lifecyclePhase === "starting" ||
        this.lifecyclePhase === "running") &&
      this.initializePromise
    ) {
      return this.initializePromise;
    }
    if (this.lifecyclePhase === "running") return Promise.resolve();
    if (
      this.lifecyclePhase === "stopping" &&
      this.desiredRunning &&
      this.initializePromise
    ) {
      return this.initializePromise;
    }

    this.desiredRunning = true;
    const intent = ++this.lifecycleIntent;
    const waitForShutdown =
      this.lifecyclePhase === "stopping" ? this.shutdownPromise : null;
    const start = (): Promise<void> => {
      if (
        !this.desiredRunning ||
        intent !== this.lifecycleIntent ||
        this.lifecyclePhase !== "stopped"
      ) {
        return Promise.resolve();
      }
      const generation = this.prepareServiceRun();
      return this.runBoundary(this.runInitialization(generation));
    };
    const operation = waitForShutdown ? waitForShutdown.then(start) : start();
    const initializePromise = operation.finally(() => {
      if (this.initializePromise === initializePromise) {
        this.initializePromise = null;
      }
    });
    this.initializePromise = initializePromise;
    return initializePromise;
  }

  wake(): void {
    if (
      !this.initialized ||
      this.stopping ||
      !this.wakeAdmissionOpen ||
      this.wakeEventQueued
    ) {
      return;
    }
    this.wakeEventQueued = true;
    this.offer({ _tag: "Wake", epoch: this.boundaryEpoch });
  }

  shutdown(): Promise<void> {
    this.desiredRunning = false;
    this.lifecycleIntent += 1;
    this.initializePromise = null;
    if (this.lifecyclePhase === "stopping") {
      return this.shutdownPromise ?? Promise.resolve();
    }
    if (this.lifecyclePhase === "stopped") return Promise.resolve();

    const generation = this.lifecycleGeneration;
    this.lifecyclePhase = "stopping";
    this.unregisterListeners();
    const epoch = this.fenceBoundary(true, true);
    const shutdownEffect = this.supervisorStarted
      ? Effect.gen(this, function* () {
          const ack = yield* Deferred.make<void, unknown>();
          yield* Queue.offer(this.events, { _tag: "Shutdown", epoch, ack });
          yield* Effect.raceFirst(
            Deferred.await(ack),
            Deferred.await(this.supervisorDone),
          );
        }).pipe(Effect.ensuring(Scope.close(this.serviceScope, Exit.void)))
      : Scope.close(this.serviceScope, Exit.void);
    const shutdownPromise = this.runBoundary(shutdownEffect).finally(() => {
      if (
        generation === this.lifecycleGeneration &&
        this.lifecyclePhase === "stopping"
      ) {
        this.lifecyclePhase = "stopped";
        this.runResourcesClosed = true;
        this.supervisorStarted = false;
        this.currentAttemptFiber = null;
        this.currentAttemptId = null;
        this.currentDebounceFiber = null;
        this.activeAccountId = null;
        this.wakeAdmissionOpen = false;
      }
      if (this.shutdownPromise === shutdownPromise) {
        this.shutdownPromise = null;
      }
    });
    this.shutdownPromise = shutdownPromise;
    return shutdownPromise;
  }

  private initializeEffect(): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      if (this.initialized) return Effect.void;
      this.desiredRunning = true;
      this.lifecycleIntent += 1;
      const generation = this.prepareServiceRun();
      return this.runInitialization(generation);
    });
  }

  private prepareServiceRun(): number {
    if (this.runResourcesClosed) {
      this.serviceScope = Runtime.runSync(this.runtime, Scope.make());
      this.events = Runtime.runSync(
        this.runtime,
        Queue.unbounded<ControlEvent>(),
      );
      this.supervisorDone = Runtime.runSync(
        this.runtime,
        Deferred.make<void>(),
      );
      this.runResourcesClosed = false;
    }

    this.lifecycleGeneration += 1;
    this.lifecyclePhase = "starting";
    this.supervisorStarted = false;
    this.wakeEventQueued = false;
    this.localMutationEventQueued = false;
    return this.lifecycleGeneration;
  }

  private runInitialization(generation: number): Effect.Effect<void, unknown> {
    return Effect.gen(this, function* () {
      if (!this.lifecycleIsCurrent(generation, "starting")) return;

      const initialEpoch = this.boundaryEpoch;
      const events = this.events;
      const serviceScope = this.serviceScope;
      const supervisorDone = this.supervisorDone;
      this.registerListeners();

      yield* Effect.forkIn(
        Effect.interruptible(
          this.supervisorLoop(events).pipe(
            Effect.ensuring(
              Deferred.succeed(supervisorDone, undefined).pipe(Effect.asVoid),
            ),
          ),
        ),
        serviceScope,
      );
      if (!this.lifecycleIsCurrent(generation, "starting")) return;
      this.supervisorStarted = true;
      yield* Effect.forkIn(Effect.interruptible(this.pollLoop()), serviceScope);
      if (!this.lifecycleIsCurrent(generation, "starting")) return;
      this.lifecyclePhase = "running";

      const authState = yield* this.fromPromise(() =>
        this.authService.getAuthState(),
      );
      if (
        !this.lifecycleIsCurrent(generation, "running") ||
        initialEpoch !== this.boundaryEpoch
      ) {
        return;
      }

      const ack = yield* Deferred.make<void, unknown>();
      yield* Queue.offer(events, {
        _tag: "Initialize",
        epoch: initialEpoch,
        authState,
        ack,
      });
      yield* Deferred.await(ack);
    });
  }

  private lifecycleIsCurrent(
    generation: number,
    phase: "starting" | "running",
  ): boolean {
    return (
      this.desiredRunning &&
      generation === this.lifecycleGeneration &&
      this.lifecyclePhase === phase
    );
  }

  private get initialized(): boolean {
    return (
      this.lifecyclePhase === "starting" || this.lifecyclePhase === "running"
    );
  }

  private get stopping(): boolean {
    return this.lifecyclePhase === "stopping";
  }

  private registerListeners(): void {
    this.unregisterBeforeLogout = this.authService.registerBeforeLogoutHandler(
      () => this.handleBeforeLogout(),
    );
    this.authService.on("authenticated", this.onAuthenticated);
    this.authService.on("logged-out", this.onLoggedOut);
    this.authService.on("token-refreshed", this.onTokenRefreshed);
    this.unregisterLocalMutation = registerLocalSyncMutationHandler(() => {
      if (!this.initialized || this.stopping || !this.wakeAdmissionOpen) return;
      this.localMutationEpoch = this.boundaryEpoch;
      this.localMutationDeadline = Date.now() + EDIT_DEBOUNCE_MS;
      if (this.localMutationEventQueued) return;
      this.localMutationEventQueued = true;
      this.offer({ _tag: "LocalMutation" });
    });
    ipcMain.on("settings-sync-wake", this.onExternalWake);
  }

  private unregisterListeners(): void {
    this.authService.off("authenticated", this.onAuthenticated);
    this.authService.off("logged-out", this.onLoggedOut);
    this.authService.off("token-refreshed", this.onTokenRefreshed);
    ipcMain.removeListener("settings-sync-wake", this.onExternalWake);
    this.unregisterBeforeLogout?.();
    this.unregisterLocalMutation?.();
    this.unregisterBeforeLogout = null;
    this.unregisterLocalMutation = null;
  }

  private handleBeforeLogout(): Promise<void> {
    if (this.stopping || !this.initialized) return Promise.resolve();
    const epoch = this.fenceBoundary(true, true);
    const ack = Runtime.runSync(this.runtime, Deferred.make<void, unknown>());
    this.offer({ _tag: "BeforeLogout", epoch, ack });
    return this.runBoundary(
      Effect.raceFirst(
        Deferred.await(ack),
        Deferred.await(this.supervisorDone).pipe(
          Effect.zipRight(this.db(() => clearSyncState())),
          Effect.tap(() => Effect.sync(() => this.notifyRenderers())),
        ),
      ),
    );
  }

  private fenceBoundary(pause: boolean, cancelDebounce: boolean): number {
    this.boundaryEpoch += 1;
    this.wakeAdmissionOpen = false;
    this.currentAttemptFiber?.unsafeInterruptAsFork(FiberId.none);
    if (cancelDebounce) {
      this.currentDebounceFiber?.unsafeInterruptAsFork(FiberId.none);
      this.currentDebounceFiber = null;
    }
    if (pause) {
      this.activeAccountId = null;
      pauseSyncSession();
    }
    return this.boundaryEpoch;
  }

  private supervisorLoop(
    events: Queue.Queue<ControlEvent>,
  ): Effect.Effect<void> {
    const initialState: SupervisorState = {
      epoch: this.boundaryEpoch,
      context: null,
      attempt: null,
      debounce: null,
      rerunRequested: false,
      authorizationBlocked: false,
      authenticationRefreshAttempted: false,
      nextAttemptId: 1,
    };
    const loop = (state: SupervisorState): Effect.Effect<void> =>
      Queue.take(events).pipe(
        Effect.flatMap((event) =>
          Effect.exit(this.handleEvent(state, event)).pipe(
            Effect.flatMap((exit) => {
              if (Exit.isSuccess(exit)) {
                return exit.value._tag === "Stop"
                  ? Effect.void
                  : loop(exit.value.state);
              }
              if (Cause.isInterrupted(exit.cause)) {
                return Effect.failCause(exit.cause);
              }
              return this.recoverSupervisorEvent(state, event, exit.cause).pipe(
                Effect.flatMap(loop),
              );
            }),
          ),
        ),
      );
    return loop(initialState);
  }

  private recoverSupervisorEvent(
    state: SupervisorState,
    event: ControlEvent,
    cause: Cause.Cause<never>,
  ): Effect.Effect<SupervisorState> {
    return Effect.gen(this, function* () {
      logger.main.error("Settings sync supervisor event failed", {
        error: Cause.squash(cause),
        event: event._tag,
      });

      if (
        this.currentAttemptId !== null &&
        this.currentAttemptId !== state.attempt?.id
      ) {
        this.currentAttemptFiber?.unsafeInterruptAsFork(FiberId.none);
        this.currentAttemptId = null;
        this.currentAttemptFiber = null;
      }

      if (event._tag === "Initialize" || event._tag === "BeforeLogout") {
        yield* Deferred.failCause(event.ack, cause);
      } else if (event._tag === "Shutdown") {
        yield* Deferred.failCause(event.ack, cause);
      }

      switch (event._tag) {
        case "Authenticated":
        case "BeforeLogout":
          return {
            ...state,
            epoch: event.epoch,
            context: null,
            attempt: null,
            rerunRequested: false,
          };
        case "TokenRefreshed":
          return {
            ...state,
            epoch: event.epoch,
            attempt: null,
            rerunRequested: false,
            authorizationBlocked: true,
          };
        case "AttemptFinished":
          return { ...state, attempt: null, rerunRequested: false };
        default:
          return state;
      }
    });
  }

  private handleEvent(
    state: SupervisorState,
    event: ControlEvent,
  ): Effect.Effect<
    { _tag: "Continue"; state: SupervisorState } | { _tag: "Stop" }
  > {
    switch (event._tag) {
      case "Initialize":
        return this.handleInitialize(state, event).pipe(
          Effect.map((next) => ({ _tag: "Continue" as const, state: next })),
        );
      case "Wake":
        return this.handleWake(state, event.epoch).pipe(
          Effect.map((next) => ({ _tag: "Continue" as const, state: next })),
        );
      case "LocalMutation":
        return this.handleLocalMutation(state).pipe(
          Effect.map((next) => ({ _tag: "Continue" as const, state: next })),
        );
      case "Authenticated":
        return this.handleAuthenticated(state, event).pipe(
          Effect.map((next) => ({ _tag: "Continue" as const, state: next })),
        );
      case "TokenRefreshed":
        return this.handleTokenRefreshed(state, event).pipe(
          Effect.map((next) => ({ _tag: "Continue" as const, state: next })),
        );
      case "LoggedOut":
        if (this.stopping) {
          return Effect.succeed({ _tag: "Continue" as const, state });
        }
        return Effect.sync(() => this.notifyRenderers()).pipe(
          Effect.as({ _tag: "Continue" as const, state }),
        );
      case "BeforeLogout":
        return this.handleBeforeLogoutEvent(state, event).pipe(
          Effect.map((next) => ({ _tag: "Continue" as const, state: next })),
        );
      case "AttemptFinished":
        return this.handleAttemptFinished(state, event).pipe(
          Effect.map((next) => ({ _tag: "Continue" as const, state: next })),
        );
      case "Shutdown":
        return this.handleShutdownEvent(state, event).pipe(
          Effect.as({ _tag: "Stop" as const }),
        );
    }
  }

  private handleInitialize(
    state: SupervisorState,
    event: Extract<ControlEvent, { _tag: "Initialize" }>,
  ): Effect.Effect<SupervisorState> {
    if (
      event.epoch !== state.epoch ||
      event.epoch !== this.boundaryEpoch ||
      this.stopping
    ) {
      return Deferred.succeed(event.ack, undefined).pipe(Effect.as(state));
    }

    const transition = Effect.gen(this, function* () {
      const accountId =
        event.authState?.isAuthenticated && event.authState.userInfo?.sub
          ? event.authState.userInfo.sub
          : null;
      if (!accountId) {
        yield* this.db(() => clearSyncState());
        this.notifyRenderers();
        return state;
      }

      const canResume = yield* this.db(() =>
        hasResumableUserSyncState(accountId),
      );
      const context = yield* this.activateAccount(
        accountId,
        canResume ? "resume" : "full",
        event.epoch,
      );
      if (!context) return state;
      this.activeAccountId = accountId;
      this.wakeAdmissionOpen = true;
      return yield* this.startAttempt({
        ...state,
        context,
        authorizationBlocked: false,
        authenticationRefreshAttempted: false,
      });
    });

    return Effect.exit(transition).pipe(
      Effect.tap((exit) =>
        Deferred.done(
          event.ack,
          Exit.map(exit, () => undefined),
        ),
      ),
      Effect.map((exit) => (Exit.isSuccess(exit) ? exit.value : state)),
    );
  }

  private handleAuthenticated(
    state: SupervisorState,
    event: Extract<ControlEvent, { _tag: "Authenticated" }>,
  ): Effect.Effect<SupervisorState> {
    if (this.stopping || event.epoch !== this.boundaryEpoch) {
      return Effect.succeed(state);
    }
    const transition = Effect.gen(this, function* () {
      let next = yield* this.interruptAttempt(state);
      next = {
        ...next,
        epoch: event.epoch,
        context: null,
        rerunRequested: false,
        authorizationBlocked: false,
        authenticationRefreshAttempted: false,
      };
      const context = yield* this.activateAccount(
        event.accountId,
        "full",
        event.epoch,
      );
      if (!context) return next;
      this.activeAccountId = event.accountId;
      this.wakeAdmissionOpen = true;
      return yield* this.startAttempt({ ...next, context });
    });

    return Effect.exit(transition).pipe(
      Effect.map((exit) => {
        if (Exit.isSuccess(exit)) return exit.value;
        logger.main.error(
          "Failed to start settings sync after login",
          Cause.squash(exit.cause),
        );
        return {
          ...state,
          epoch: event.epoch,
          context: null,
          attempt: null,
          rerunRequested: false,
        };
      }),
    );
  }

  private handleTokenRefreshed(
    state: SupervisorState,
    event: Extract<ControlEvent, { _tag: "TokenRefreshed" }>,
  ): Effect.Effect<SupervisorState> {
    if (
      this.stopping ||
      event.epoch !== this.boundaryEpoch ||
      !state.context ||
      state.context.accountId !== event.accountId
    ) {
      return Effect.succeed(state);
    }

    const transition = Effect.gen(this, function* () {
      const interrupted = yield* this.interruptAttempt(state);
      const organizationDeactivated = yield* this.db(async () =>
        deactivateOrganizationSyncScopes(),
      );
      if (organizationDeactivated) this.notifyRenderers();
      if (event.epoch !== this.boundaryEpoch || this.stopping) {
        return {
          ...interrupted,
          epoch: event.epoch,
          attempt: null,
          rerunRequested: false,
        };
      }
      this.wakeAdmissionOpen = true;
      return yield* this.startAttempt({
        ...interrupted,
        epoch: event.epoch,
        rerunRequested: false,
        authorizationBlocked: false,
      });
    });

    return Effect.exit(transition).pipe(
      Effect.map((exit) => {
        if (Exit.isSuccess(exit)) return exit.value;
        logger.main.error(
          "Failed to restart settings sync after token refresh",
          {
            error: Cause.squash(exit.cause),
          },
        );
        return {
          ...state,
          epoch: event.epoch,
          attempt: null,
          rerunRequested: false,
        };
      }),
    );
  }

  private handleBeforeLogoutEvent(
    state: SupervisorState,
    event: Extract<ControlEvent, { _tag: "BeforeLogout" }>,
  ): Effect.Effect<SupervisorState> {
    const cleanup = Effect.gen(this, function* () {
      let next = yield* this.interruptAttempt(state);
      next = yield* this.interruptDebounce(next);
      yield* this.db(() => clearSyncState());
      return {
        ...next,
        epoch: event.epoch,
        context: null,
        attempt: null,
        rerunRequested: false,
        authorizationBlocked: false,
        authenticationRefreshAttempted: false,
      };
    });

    return Effect.exit(cleanup).pipe(
      Effect.tap((exit) =>
        Deferred.done(
          event.ack,
          Exit.map(exit, () => undefined),
        ),
      ),
      Effect.map((exit) =>
        Exit.isSuccess(exit)
          ? exit.value
          : {
              ...state,
              epoch: event.epoch,
              context: null,
              attempt: null,
              rerunRequested: false,
            },
      ),
    );
  }

  private handleShutdownEvent(
    state: SupervisorState,
    event: Extract<ControlEvent, { _tag: "Shutdown" }>,
  ): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const next = yield* this.interruptAttempt(state);
      yield* this.interruptDebounce(next);
      pauseSyncSession();
      this.currentAttemptFiber = null;
      this.currentAttemptId = null;
      this.currentDebounceFiber = null;
      this.activeAccountId = null;
      this.wakeAdmissionOpen = false;
      yield* Deferred.succeed(event.ack, undefined);
    });
  }

  private handleWake(
    state: SupervisorState,
    epoch: number,
  ): Effect.Effect<SupervisorState> {
    this.wakeEventQueued = false;
    if (
      epoch !== state.epoch ||
      epoch !== this.boundaryEpoch ||
      !state.context ||
      state.authorizationBlocked ||
      this.stopping
    ) {
      return Effect.succeed(state);
    }
    if (state.attempt) {
      return Effect.succeed({ ...state, rerunRequested: true });
    }
    return this.startAttempt(state);
  }

  private handleLocalMutation(
    state: SupervisorState,
  ): Effect.Effect<SupervisorState> {
    this.localMutationEventQueued = false;
    const epoch = this.localMutationEpoch;
    const remainingDelay = Math.max(0, this.localMutationDeadline - Date.now());
    if (
      epoch !== state.epoch ||
      epoch !== this.boundaryEpoch ||
      !state.context ||
      state.authorizationBlocked ||
      this.stopping
    ) {
      return Effect.succeed(state);
    }

    return Effect.gen(this, function* () {
      const withoutPrevious = yield* this.interruptDebounce(state);
      const fiber = yield* Effect.forkIn(
        Effect.sleep(remainingDelay).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.currentDebounceFiber = null;
            }),
          ),
          Effect.tap(() => Effect.sync(() => this.wake())),
        ),
        this.serviceScope,
      );
      this.currentDebounceFiber = fiber;
      return { ...withoutPrevious, debounce: fiber };
    });
  }

  private handleAttemptFinished(
    state: SupervisorState,
    event: Extract<ControlEvent, { _tag: "AttemptFinished" }>,
  ): Effect.Effect<SupervisorState> {
    if (
      !state.attempt ||
      state.attempt.id !== event.id ||
      state.attempt.epoch !== event.epoch ||
      event.epoch !== state.epoch ||
      event.epoch !== this.boundaryEpoch
    ) {
      return Effect.succeed(state);
    }

    if (this.currentAttemptId === event.id) {
      this.currentAttemptId = null;
      this.currentAttemptFiber = null;
    }
    const completed = { ...state, attempt: null };
    if (Exit.isInterrupted(event.exit)) {
      return Effect.succeed(completed);
    }
    if (Exit.isSuccess(event.exit)) {
      const next = {
        ...completed,
        authenticationRefreshAttempted: false,
        rerunRequested:
          completed.rerunRequested || event.exit.value.rebootstrap,
      };
      return next.rerunRequested
        ? this.startAttempt({ ...next, rerunRequested: false })
        : Effect.succeed(next);
    }

    const errorOption = Cause.failureOption(event.exit.cause);
    const error = Option.isSome(errorOption)
      ? errorOption.value
      : Cause.squash(event.exit.cause);
    if (error instanceof SyncScopeAuthorizationError) {
      this.wakeAdmissionOpen = false;
      logger.main.warn(
        "Axis rejected the active user sync scope; waiting for auth change",
        { error },
      );
      return Effect.succeed({
        ...completed,
        rerunRequested: false,
        authorizationBlocked: true,
      });
    }
    if (error instanceof SettingsSyncHttpError && error.status === 401) {
      this.wakeAdmissionOpen = false;
      logger.main.warn(
        "Settings sync authentication failed; waiting for auth change",
        { error },
      );
      const blocked = {
        ...completed,
        rerunRequested: false,
        authorizationBlocked: true,
      };
      if (blocked.authenticationRefreshAttempted) {
        return Effect.succeed(blocked);
      }
      return this.startAuthenticationRefresh({
        ...blocked,
        authenticationRefreshAttempted: true,
      });
    }
    if (error instanceof SettingsSyncHttpError && error.status === 403) {
      return Effect.exit(
        this.removeAllOrganizationScopes(completed.context!),
      ).pipe(
        Effect.flatMap((cleanupExit) => {
          if (Exit.isFailure(cleanupExit)) {
            logger.main.warn(
              "Settings sync attempt failed; durable work retained",
              { error: Cause.squash(cleanupExit.cause) },
            );
            return completed.rerunRequested
              ? this.startAttempt({ ...completed, rerunRequested: false })
              : Effect.succeed(completed);
          }
          if (cleanupExit.value) this.notifyRenderers();
          this.wakeAdmissionOpen = false;
          logger.main.warn(
            "Settings sync authorization failed; waiting for auth change",
            { error },
          );
          return Effect.succeed({
            ...completed,
            rerunRequested: false,
            authorizationBlocked: true,
          });
        }),
      );
    }

    logger.main.warn("Settings sync attempt failed; durable work retained", {
      error,
    });
    return completed.rerunRequested
      ? this.startAttempt({ ...completed, rerunRequested: false })
      : Effect.succeed(completed);
  }

  private startAttempt(state: SupervisorState): Effect.Effect<SupervisorState> {
    if (!state.context || this.stopping) return Effect.succeed(state);
    const id = state.nextAttemptId;
    const epoch = state.epoch;
    const context = state.context;
    return Effect.gen(this, function* () {
      const startGate = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkIn(
        Effect.exit(
          Deferred.await(startGate).pipe(
            Effect.zipRight(this.runIncrementalSync(context)),
          ),
        ).pipe(
          Effect.flatMap((exit) =>
            Queue.offer(this.events, {
              _tag: "AttemptFinished" as const,
              id,
              epoch,
              exit,
            }),
          ),
          Effect.asVoid,
        ),
        this.serviceScope,
      );
      this.currentAttemptId = id;
      this.currentAttemptFiber = fiber;
      yield* Deferred.succeed(startGate, undefined);
      return {
        ...state,
        attempt: { id, epoch, fiber },
        nextAttemptId: id + 1,
      };
    });
  }

  private startAuthenticationRefresh(
    state: SupervisorState,
  ): Effect.Effect<SupervisorState> {
    const refresh = Effect.uninterruptible(
      this.fromPromise(() => this.authService.refreshTokenIfNeeded(true)),
    ).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.main.error("Settings sync authentication refresh failed", {
            error,
          });
        }),
      ),
    );
    return Effect.forkIn(refresh, this.serviceScope).pipe(Effect.as(state));
  }

  private interruptAttempt(
    state: SupervisorState,
  ): Effect.Effect<SupervisorState> {
    if (!state.attempt) return Effect.succeed(state);
    return Fiber.interrupt(state.attempt.fiber).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (this.currentAttemptId === state.attempt?.id) {
            this.currentAttemptId = null;
            this.currentAttemptFiber = null;
          }
        }),
      ),
      Effect.as({ ...state, attempt: null }),
    );
  }

  private interruptDebounce(
    state: SupervisorState,
  ): Effect.Effect<SupervisorState> {
    if (!state.debounce) return Effect.succeed(state);
    return Fiber.interrupt(state.debounce).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (this.currentDebounceFiber === state.debounce) {
            this.currentDebounceFiber = null;
          }
        }),
      ),
      Effect.as({ ...state, debounce: null }),
    );
  }

  private activateAccount(
    accountId: string,
    mode: "full" | "resume",
    epoch: number,
  ): Effect.Effect<SyncContext | null, unknown> {
    return Effect.gen(this, function* () {
      pauseSyncSession();
      if (mode === "full") {
        yield* this.db(() => clearSyncState());
        this.notifyRenderers();
      }
      if (!this.boundaryIsCurrent(epoch)) {
        pauseSyncSession();
        return null;
      }

      const context = yield* this.db(() =>
        mode === "full"
          ? beginUserSyncSession(accountId)
          : resumeUserSyncSession(accountId),
      );
      if (!this.boundaryIsCurrent(epoch)) {
        pauseSyncSession();
        return null;
      }

      const adopted = yield* this.db(async () => {
        if (!(await prepareVisibleRowsForFullSync(context))) return false;
        return adoptVisibleRows(context);
      });
      if (!adopted || !this.boundaryIsCurrent(epoch)) {
        if (!this.boundaryIsCurrent(epoch)) pauseSyncSession();
        return null;
      }
      return context;
    });
  }

  private runIncrementalSync(
    context: SyncContext,
  ): Effect.Effect<AttemptResult, unknown> {
    return Effect.gen(this, function* () {
      const capabilities = yield* this.request((signal) =>
        this.client.bootstrap(context.accountId, signal),
      );
      const reconciled = yield* this.db(() =>
        reconcileSyncScopes(context.accountId, capabilities.scopes),
      );
      if (!reconciled) return { rebootstrap: false };
      if (reconciled.organizationChanged || reconciled.capabilityChanged) {
        this.notifyRenderers();
      }
      if (capabilities.collections.length === 0) {
        return { rebootstrap: false };
      }

      const syncScope = (
        index: number,
      ): Effect.Effect<AttemptResult, unknown> => {
        const scopeContext = reconciled.contexts[index];
        if (!scopeContext) return Effect.succeed({ rebootstrap: false });
        const scope = capabilities.scopes.find(
          (candidate) =>
            candidate.scopeType === scopeContext.scopeType &&
            candidate.scopeId === scopeContext.scopeId,
        );
        if (!scope) return syncScope(index + 1);

        const transfer = scope.canWrite
          ? this.pushUntilDrained(scopeContext, capabilities).pipe(
              Effect.zipRight(
                this.pullUntilCurrent(scopeContext, capabilities),
              ),
            )
          : this.pullUntilCurrent(scopeContext, capabilities);

        return transfer.pipe(
          Effect.as<AttemptResult>({ rebootstrap: false }),
          Effect.catchAll((error) => {
            if (
              error instanceof SyncScopeAuthorizationError &&
              scopeContext.scopeType === "org"
            ) {
              return this.db(async () =>
                deactivateOrganizationSyncScopes(),
              ).pipe(
                Effect.tap((changed) =>
                  changed
                    ? Effect.sync(() => this.notifyRenderers())
                    : Effect.void,
                ),
                Effect.as<AttemptResult>({ rebootstrap: true }),
              );
            }
            if (
              scopeContext.scopeType === "org" &&
              error instanceof SettingsSyncHttpError &&
              error.status === 403
            ) {
              return this.db(() =>
                removeOrganizationSyncScope(scopeContext),
              ).pipe(
                Effect.tap((changed) =>
                  changed
                    ? Effect.sync(() => this.notifyRenderers())
                    : Effect.void,
                ),
                Effect.as<AttemptResult>({ rebootstrap: false }),
              );
            }
            return Effect.fail(error);
          }),
          Effect.flatMap((result) =>
            result.rebootstrap ? Effect.succeed(result) : syncScope(index + 1),
          ),
        );
      };

      return yield* syncScope(0);
    });
  }

  private pullUntilCurrent(
    context: SyncContext,
    capabilities: SyncBootstrap,
  ): Effect.Effect<void, unknown> {
    return Effect.gen(this, function* () {
      const changed = yield* Ref.make(false);
      const pullPage = (): Effect.Effect<void, unknown> =>
        this.db(() => getPullCursors(context, capabilities.collections)).pipe(
          Effect.flatMap((cursors) => {
            if (cursors === null) return Effect.void;
            return this.request((signal) =>
              this.client.pull(
                context.scopeType,
                context.scopeId,
                cursors,
                capabilities.pullLimit,
                signal,
              ),
            ).pipe(
              Effect.flatMap((page) =>
                this.db(() => applyPullPages(context, page.collections)).pipe(
                  Effect.flatMap((applied) => {
                    if (!applied) return Effect.void;
                    const pageChanged = page.collections.some(
                      (collection) => collection.items.length > 0,
                    );
                    const hasMore = page.collections.some(
                      (collection) => collection.hasMore,
                    );
                    return (
                      pageChanged ? Ref.set(changed, true) : Effect.void
                    ).pipe(Effect.zipRight(hasMore ? pullPage() : Effect.void));
                  }),
                ),
              ),
            );
          }),
        );

      yield* pullPage().pipe(
        Effect.onExit((exit) =>
          Exit.isInterrupted(exit)
            ? Effect.void
            : Ref.get(changed).pipe(
                Effect.tap((didChange) =>
                  didChange
                    ? Effect.sync(() => this.notifyRenderers())
                    : Effect.void,
                ),
                Effect.asVoid,
              ),
        ),
      );
    });
  }

  private pushUntilDrained(
    context: SyncContext,
    capabilities: SyncBootstrap,
  ): Effect.Effect<void, unknown> {
    const pushBatch = (): Effect.Effect<void, unknown> =>
      this.db(() =>
        capturePushHeads(context, undefined, capabilities.collections),
      ).pipe(
        Effect.flatMap((heads) => {
          if (heads.length === 0) return Effect.void;
          return Effect.try({
            try: () =>
              this.buildPushBatch(
                heads,
                capabilities.maxPushBatch,
                capabilities.maxPushBytes,
              ),
            catch: (error) => error,
          }).pipe(
            Effect.flatMap((batch) =>
              this.request((signal) =>
                this.client.push(batch.mutations, signal),
              ).pipe(Effect.map((results) => ({ batch, results }))),
            ),
            Effect.flatMap(({ batch, results }) => {
              if (
                results.some(
                  (result) =>
                    result.status === "error" &&
                    result.reason === "unauthorized_scope",
                )
              ) {
                return Effect.fail(new SyncScopeAuthorizationError(context));
              }
              return this.db(() =>
                applyPushResults(context, batch.heads, results),
              ).pipe(
                Effect.flatMap((applied) => {
                  if (!applied) return Effect.void;
                  if (results.some((result) => result.status !== "ok")) {
                    this.notifyRenderers();
                  }
                  return pushBatch();
                }),
              );
            }),
          );
        }),
      );
    return pushBatch();
  }

  private removeAllOrganizationScopes(
    context: SyncContext,
  ): Effect.Effect<boolean, unknown> {
    return this.db(async () => {
      const hadActiveOrganization = deactivateOrganizationSyncScopes();
      const reconciled = await reconcileSyncScopes(context.accountId, [
        {
          scopeType: "user",
          scopeId: context.accountId,
          role: null,
          canWrite: true,
          latestSyncVersion: 0,
        },
      ]);
      return hadActiveOrganization || Boolean(reconciled?.organizationChanged);
    });
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

  private pollLoop(): Effect.Effect<never> {
    return Effect.async<never>(() => {
      const timer = setInterval(() => this.wake(), POLL_INTERVAL_MS);
      timer.unref?.();
      return Effect.sync(() => clearInterval(timer));
    });
  }

  private db<T>(callback: () => Promise<T>): Effect.Effect<T, unknown> {
    return this.dbSemaphore.withPermits(1)(
      Effect.uninterruptible(this.fromPromise(callback)),
    );
  }

  private request<T>(
    callback: (signal: AbortSignal) => Promise<T>,
  ): Effect.Effect<T, unknown> {
    return Effect.tryPromise({ try: callback, catch: (error) => error });
  }

  private fromPromise<T>(
    callback: () => Promise<T>,
  ): Effect.Effect<T, unknown> {
    return Effect.tryPromise({ try: callback, catch: (error) => error });
  }

  private boundaryIsCurrent(epoch: number): boolean {
    return !this.stopping && epoch === this.boundaryEpoch;
  }

  private offer(event: ControlEvent): void {
    Runtime.runSync(this.runtime, Queue.offer(this.events, event));
  }

  private runBoundary<T>(effect: Effect.Effect<T, unknown>): Promise<T> {
    return Runtime.runPromiseExit(this.runtime)(effect).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      throw Cause.squash(exit.cause);
    });
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
        if (window.isDestroyed() || window.webContents.isDestroyed?.()) {
          continue;
        }
        window.webContents.send("settings-sync-updated");
      } catch (error) {
        logger.main.warn("Failed to notify renderer of settings sync update", {
          error,
          windowId: window.id,
        });
      }
    }
  }
}
