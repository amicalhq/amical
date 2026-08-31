import { ipcMain } from "electron";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberId,
  Option,
  Queue,
  Runtime,
  Scope,
} from "effect";

import { logger } from "../main/logger";
import type { AuthService, AuthState } from "./auth-service";
import {
  SettingsSyncRunner,
  type SyncAttemptResult,
  type SyncClient,
} from "./settings-sync-runner";
import {
  SettingsSyncDependencyFailure,
  SettingsSyncScopeRejected,
  type SettingsSyncAttemptError,
  type SettingsSyncLifecycleError,
} from "./settings-sync-errors";
import {
  AccessForbidden,
  AuthenticationRequired,
} from "../types/errors/cloud-request";
import {
  adoptVisibleRows,
  beginUserSyncSession,
  clearSyncState,
  deactivateOrganizationSyncScopes,
  hasResumableUserSyncState,
  pauseSyncSession,
  prepareVisibleRowsForFullSync,
  reconcileSyncScopes,
  registerLocalSyncMutationHandler,
  resumeUserSyncSession,
  type SyncContext,
} from "../db/sync";

const POLL_INTERVAL_MS = 5 * 60_000;
const EDIT_DEBOUNCE_MS = 750;

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
      ack: Deferred.Deferred<void, SettingsSyncLifecycleError>;
    }
  | { _tag: "Wake"; epoch: number }
  | { _tag: "LocalMutation" }
  | { _tag: "Authenticated"; epoch: number; accountId: string }
  | { _tag: "TokenRefreshed"; epoch: number; accountId: string }
  | { _tag: "LoggedOut" }
  | {
      _tag: "BeforeLogout";
      epoch: number;
      ack: Deferred.Deferred<void, SettingsSyncLifecycleError>;
    }
  | {
      _tag: "AttemptFinished";
      id: number;
      epoch: number;
      exit: Exit.Exit<SyncAttemptResult, SettingsSyncAttemptError>;
    }
  | {
      _tag: "Shutdown";
      epoch: number;
      ack: Deferred.Deferred<void, SettingsSyncLifecycleError>;
    };

export class SettingsSyncSupervisor {
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
  private initializeCompletion: Deferred.Deferred<
    void,
    SettingsSyncLifecycleError
  > | null = null;
  private shutdownCompletion: Deferred.Deferred<
    void,
    SettingsSyncLifecycleError
  > | null = null;
  private unregisterBeforeLogout: (() => void) | null = null;
  private unregisterLocalMutation: (() => void) | null = null;
  private readonly runner: SettingsSyncRunner;

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
    private readonly notifyRenderers: () => void,
  ) {
    this.runner = new SettingsSyncRunner(
      client,
      (effect) => this.withDb(effect),
      notifyRenderers,
    );
  }

  static make(
    authService: AuthService,
    client: SyncClient,
    notifyRenderers: () => void,
    runtime: Runtime.Runtime<never> = Runtime.defaultRuntime,
  ): Effect.Effect<SettingsSyncSupervisor> {
    return Effect.gen(function* () {
      const serviceScope = yield* Scope.make();
      const events = yield* Queue.unbounded<ControlEvent>();
      const dbSemaphore = yield* Effect.makeSemaphore(1);
      const supervisorDone = yield* Deferred.make<void>();
      return new SettingsSyncSupervisor(
        authService,
        client,
        runtime,
        serviceScope,
        events,
        dbSemaphore,
        supervisorDone,
        notifyRenderers,
      );
    });
  }

  initialize(): Effect.Effect<void, SettingsSyncLifecycleError> {
    return Effect.uninterruptible(
      Effect.gen(this, function* () {
        if (this.desiredRunning && this.initializeCompletion) {
          return yield* Deferred.await(this.initializeCompletion);
        }
        if (this.lifecyclePhase === "running") return;

        this.desiredRunning = true;
        const intent = ++this.lifecycleIntent;
        const waitForShutdown =
          this.lifecyclePhase === "stopping" ? this.shutdownCompletion : null;
        const completion = yield* Deferred.make<
          void,
          SettingsSyncLifecycleError
        >();
        this.initializeCompletion = completion;

        const start = Effect.suspend(() => {
          if (
            !this.desiredRunning ||
            intent !== this.lifecycleIntent ||
            this.lifecyclePhase !== "stopped"
          ) {
            return Effect.void;
          }
          return this.prepareServiceRun().pipe(
            Effect.flatMap((generation) => this.runInitialization(generation)),
          );
        });
        const operation = waitForShutdown
          ? Deferred.await(waitForShutdown).pipe(Effect.zipRight(start))
          : start;
        const exit = yield* Effect.exit(operation);
        yield* Deferred.done(completion, exit);
        if (this.initializeCompletion === completion) {
          this.initializeCompletion = null;
        }
        return yield* Deferred.await(completion);
      }),
    );
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

  shutdown(): Effect.Effect<void, SettingsSyncLifecycleError> {
    return Effect.uninterruptible(
      Effect.gen(this, function* () {
        this.desiredRunning = false;
        this.lifecycleIntent += 1;
        this.initializeCompletion = null;
        if (this.lifecyclePhase === "stopping") {
          if (this.shutdownCompletion) {
            return yield* Deferred.await(this.shutdownCompletion);
          }
          return;
        }
        if (this.lifecyclePhase === "stopped") return;

        const completion = yield* Deferred.make<
          void,
          SettingsSyncLifecycleError
        >();
        this.shutdownCompletion = completion;
        const generation = this.lifecycleGeneration;
        this.lifecyclePhase = "stopping";
        this.unregisterListeners();
        const epoch = this.fenceBoundary(true, true);
        const operation = this.supervisorStarted
          ? Effect.gen(this, function* () {
              const ack = yield* Deferred.make<
                void,
                SettingsSyncLifecycleError
              >();
              yield* Queue.offer(this.events, { _tag: "Shutdown", epoch, ack });
              yield* Effect.raceFirst(
                Deferred.await(ack),
                Deferred.await(this.supervisorDone),
              );
            }).pipe(Effect.ensuring(Scope.close(this.serviceScope, Exit.void)))
          : Scope.close(this.serviceScope, Exit.void);
        const exit = yield* Effect.scoped(
          Effect.gen(function* () {
            const operationFiber = yield* Effect.forkScoped(
              Effect.interruptible(operation),
            );
            return yield* Fiber.await(operationFiber);
          }),
        );
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
        yield* Deferred.done(completion, exit);
        if (this.shutdownCompletion === completion) {
          this.shutdownCompletion = null;
        }
        return yield* Deferred.await(completion);
      }),
    );
  }

  private prepareServiceRun(): Effect.Effect<number> {
    return Effect.gen(this, function* () {
      if (this.runResourcesClosed) {
        this.serviceScope = yield* Scope.make();
        this.events = yield* Queue.unbounded<ControlEvent>();
        this.supervisorDone = yield* Deferred.make<void>();
        this.runResourcesClosed = false;
      }

      this.lifecycleGeneration += 1;
      this.lifecyclePhase = "starting";
      this.supervisorStarted = false;
      this.wakeEventQueued = false;
      this.localMutationEventQueued = false;
      return this.lifecycleGeneration;
    });
  }

  private runInitialization(
    generation: number,
  ): Effect.Effect<void, SettingsSyncLifecycleError> {
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

      const authState = yield* this.fromAuthentication(
        this.authService.getAuthState(),
      );
      if (
        !this.lifecycleIsCurrent(generation, "running") ||
        initialEpoch !== this.boundaryEpoch
      ) {
        return;
      }

      const ack = yield* Deferred.make<void, SettingsSyncLifecycleError>();
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

  private handleBeforeLogout(): Effect.Effect<
    void,
    SettingsSyncLifecycleError
  > {
    if (this.stopping || !this.initialized) return Effect.void;
    const epoch = this.fenceBoundary(true, true);
    return Effect.gen(this, function* () {
      const ack = yield* Deferred.make<void, SettingsSyncLifecycleError>();
      yield* Queue.offer(this.events, { _tag: "BeforeLogout", epoch, ack });
      yield* Effect.raceFirst(
        Deferred.await(ack),
        Deferred.await(this.supervisorDone).pipe(
          Effect.zipRight(this.db(() => clearSyncState())),
          Effect.tap(() => Effect.sync(() => this.notifyRenderers())),
        ),
      );
    });
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
      const organizationDeactivated = yield* this.withDb(
        Effect.sync(() => deactivateOrganizationSyncScopes()),
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
    if (error instanceof SettingsSyncScopeRejected) {
      this.wakeAdmissionOpen = false;
      logger.main.warn(
        "Cloud rejected the active user sync scope; waiting for auth change",
        { error },
      );
      return Effect.succeed({
        ...completed,
        rerunRequested: false,
        authorizationBlocked: true,
      });
    }
    if (error instanceof AuthenticationRequired) {
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
    if (error instanceof AccessForbidden) {
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
            Effect.zipRight(this.runner.run(context)),
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
      this.fromAuthentication(this.authService.refreshTokenIfNeeded(true)),
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
  ): Effect.Effect<SyncContext | null, SettingsSyncLifecycleError> {
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

      const adopted = yield* this.withDb(
        Effect.gen(this, function* () {
          const prepared = yield* this.fromPromise(
            () => prepareVisibleRowsForFullSync(context),
            "database",
          );
          if (!prepared) return false;
          return yield* this.fromPromise(
            () => adoptVisibleRows(context),
            "database",
          );
        }),
      );
      if (!adopted || !this.boundaryIsCurrent(epoch)) {
        if (!this.boundaryIsCurrent(epoch)) pauseSyncSession();
        return null;
      }
      return context;
    });
  }

  private removeAllOrganizationScopes(
    context: SyncContext,
  ): Effect.Effect<boolean, SettingsSyncLifecycleError> {
    return this.withDb(
      Effect.gen(this, function* () {
        const hadActiveOrganization = deactivateOrganizationSyncScopes();
        const reconciled = yield* this.fromPromise(
          () =>
            reconcileSyncScopes(context.accountId, [
              {
                scopeType: "user",
                scopeId: context.accountId,
                role: null,
                canWrite: true,
                latestSyncVersion: 0,
              },
            ]),
          "database",
        );
        return (
          hadActiveOrganization || Boolean(reconciled?.organizationChanged)
        );
      }),
    );
  }

  private pollLoop(): Effect.Effect<never> {
    return Effect.async<never>(() => {
      const timer = setInterval(() => this.wake(), POLL_INTERVAL_MS);
      timer.unref?.();
      return Effect.sync(() => clearInterval(timer));
    });
  }

  private db<T>(
    callback: () => Promise<T>,
  ): Effect.Effect<T, SettingsSyncLifecycleError> {
    return this.withDb(this.fromPromise(callback, "database"));
  }

  private withDb<T, E>(effect: Effect.Effect<T, E>): Effect.Effect<T, E> {
    return this.dbSemaphore.withPermits(1)(Effect.uninterruptible(effect));
  }

  private fromPromise<T>(
    callback: () => Promise<T>,
    dependency: "authentication" | "database",
  ): Effect.Effect<T, SettingsSyncLifecycleError> {
    return Effect.tryPromise({
      try: callback,
      catch: (cause) =>
        new SettingsSyncDependencyFailure({
          message: `Settings sync ${dependency} operation failed`,
          dependency,
          cause,
        }),
    });
  }

  private fromAuthentication<T, E>(
    effect: Effect.Effect<T, E>,
  ): Effect.Effect<T, SettingsSyncLifecycleError> {
    return effect.pipe(
      Effect.mapError(
        (cause) =>
          new SettingsSyncDependencyFailure({
            message: "Settings sync authentication operation failed",
            dependency: "authentication",
            cause,
          }),
      ),
    );
  }

  private boundaryIsCurrent(epoch: number): boolean {
    return !this.stopping && epoch === this.boundaryEpoch;
  }

  private offer(event: ControlEvent): void {
    Runtime.runSync(this.runtime, Queue.offer(this.events, event));
  }

  private runBoundary<T, E>(effect: Effect.Effect<T, E>): Promise<T> {
    return Runtime.runPromiseExit(this.runtime)(effect).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      throw Cause.squash(exit.cause);
    });
  }
}
