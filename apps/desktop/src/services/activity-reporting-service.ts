import {
  Cause,
  Effect,
  Exit,
  Fiber,
  FiberId,
  Layer,
  Runtime,
  Scope,
} from "effect";

import {
  activateActivityMaterializationAccount,
  captureActivityRows,
  materializeCompletedDictationActivity,
  materializeCompletedDictationActivities,
  removeActivityRows,
} from "../db/activity-outbox";
import { transcriptionEvents } from "../db/transcription-events";
import { logger } from "../main/logger";
import { down, up } from "../main/runtime/layer-helpers";
import {
  ActivityReportingServiceTag,
  AppScopeTag,
  AuthServiceTag,
} from "../main/runtime/tags";
import {
  ACTIVITY_MAX_BATCH_SIZE,
  ACTIVITY_MAX_REQUEST_BYTES,
  activityRequestBytes,
  type DictationActivity,
} from "../types/activity";
import {
  AccessForbidden,
  AuthenticationRequired,
} from "../types/errors/cloud-request";
import type { AuthService, AuthState } from "./auth-service";
import { ActivityReportingClient } from "./activity-reporting-client";
import {
  ActivityReportingContractFailure,
  ActivityReportingDependencyFailure,
  type ActivityReportingClientError,
} from "./activity-reporting-errors";

const POLL_INTERVAL_MS = 5 * 60_000;

type ActivityClient = Pick<ActivityReportingClient, "submit">;
type ActivityRows = Awaited<ReturnType<typeof captureActivityRows>>;
type ActivityAttemptError = ActivityReportingClientError;

export function buildActivityBatch(
  activities: readonly DictationActivity[],
): DictationActivity[] {
  const batch: DictationActivity[] = [];

  for (const activity of activities) {
    if (batch.length >= ACTIVITY_MAX_BATCH_SIZE) break;
    const candidate = [...batch, activity];
    if (activityRequestBytes(candidate) > ACTIVITY_MAX_REQUEST_BYTES) {
      if (batch.length === 0) {
        throw new Error("Valid singleton activity exceeds server body cap");
      }
      break;
    }
    batch.push(activity);
  }

  if (batch.length === 0) {
    throw new Error("Unable to construct an activity batch");
  }
  return batch;
}

export class ActivityReportingService {
  private initialized = false;
  private stopped = false;
  private currentAccountId: string | null = null;
  private worker: Fiber.RuntimeFiber<void, never> | null = null;
  private currentWorkerId: number | null = null;
  private nextWorkerId = 1;
  private boundaryEpoch = 0;
  private rerunRequested = false;
  private authorizationBlocked = false;
  private authenticationRefreshAttempted = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private unregisterBeforeLogout: (() => void) | null = null;

  private readonly onTranscriptionSettled = (transcriptionId: number) => {
    if (!this.initialized || this.stopped) return;
    this.forkScoped(
      this.db(() =>
        materializeCompletedDictationActivity(transcriptionId),
      ).pipe(
        Effect.tap(() => Effect.sync(() => this.wake())),
        Effect.catchAll((error) =>
          Effect.sync(() => {
            logger.main.error(
              "Failed to materialize settled transcription activity",
              { transcriptionId, error },
            );
          }),
        ),
        this.logBackgroundDefect(
          "Activity settlement materialization failed unexpectedly",
        ),
      ),
    );
  };

  private readonly onAuthenticated = (authState: AuthState) => {
    const accountId = authState.userInfo?.sub;
    if (!accountId || !this.initialized || this.stopped) return;
    const epoch = this.beginAccountBoundary();
    this.forkScoped(
      this.activateAccount(accountId, epoch).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            logger.main.error("Failed to activate activity reporting account", {
              error,
            });
          }),
        ),
        this.logBackgroundDefect(
          "Activity account activation failed unexpectedly",
        ),
      ),
    );
  };

  private readonly onTokenRefreshed = (authState: AuthState) => {
    const accountId = authState.userInfo?.sub;
    if (
      !this.authorizationBlocked ||
      !accountId ||
      accountId !== this.currentAccountId
    ) {
      return;
    }
    this.authorizationBlocked = false;
    this.wake();
  };

  private constructor(
    private readonly authService: AuthService,
    private readonly client: ActivityClient,
    private readonly runtime: Runtime.Runtime<never>,
    private serviceScope: Scope.CloseableScope,
    private readonly dbSemaphore: Effect.Semaphore,
  ) {}

  private static make(
    authService: AuthService,
    client?: ActivityClient,
    runtime: Runtime.Runtime<never> = Runtime.defaultRuntime,
  ): Effect.Effect<ActivityReportingService> {
    return Effect.gen(function* () {
      const serviceScope = yield* Scope.make();
      const dbSemaphore = yield* Effect.makeSemaphore(1);
      return new ActivityReportingService(
        authService,
        client ?? new ActivityReportingClient(authService),
        runtime,
        serviceScope,
        dbSemaphore,
      );
    });
  }

  static readonly Live: Layer.Layer<
    ActivityReportingServiceTag,
    never,
    AuthServiceTag | AppScopeTag
  > = Layer.effect(
    ActivityReportingServiceTag,
    Effect.gen(function* () {
      const authService = yield* AuthServiceTag;
      const appScope = yield* AppScopeTag;
      const runtime = yield* Effect.runtime<never>();
      const service = yield* ActivityReportingService.make(
        authService,
        undefined,
        runtime,
      );
      yield* Scope.addFinalizer(
        appScope,
        Effect.sync(() =>
          logger.main.info("Shutting down activity reporting service..."),
        ).pipe(
          Effect.zipRight(service.shutdown()),
          Effect.zipLeft(down("activityReportingService")),
        ),
      );
      yield* Effect.uninterruptible(service.initialize().pipe(Effect.orDie));
      logger.main.info("Activity reporting service created");
      up("activityReportingService");
      return service;
    }),
  );

  static createForTests(
    authService: AuthService,
    client?: ActivityClient,
  ): ActivityReportingService {
    return Effect.runSync(ActivityReportingService.make(authService, client));
  }

  initialize(): Effect.Effect<void, ActivityReportingDependencyFailure> {
    return Effect.gen(this, function* () {
      if (this.initialized) return;
      if (this.stopped) {
        this.serviceScope = yield* Scope.make();
      }
      this.initialized = true;
      this.stopped = false;

      this.unregisterBeforeLogout =
        this.authService.registerBeforeLogoutHandler(() =>
          this.handleBeforeLogout(),
        );
      this.authService.on("authenticated", this.onAuthenticated);
      this.authService.on("token-refreshed", this.onTokenRefreshed);
      transcriptionEvents.on(
        "transcription-settled",
        this.onTranscriptionSettled,
      );
      this.pollTimer = setInterval(() => this.wake(), POLL_INTERVAL_MS);
      this.pollTimer.unref?.();

      const authState = yield* this.authentication(
        this.authService.getAuthState(),
      );
      if (this.stopped || !this.initialized) return;
      if (authState?.isAuthenticated && authState.userInfo?.sub) {
        const epoch = this.beginAccountBoundary();
        return yield* this.activateAccount(authState.userInfo.sub, epoch);
      }
      this.currentAccountId = null;
      this.wake();
      return Effect.void;
    });
  }

  wake(): void {
    if (this.stopped || !this.initialized) return;
    this.rerunRequested = true;
    if (this.currentWorkerId !== null) return;

    const workerId = this.nextWorkerId++;
    this.currentWorkerId = workerId;
    const work = this.runWorker().pipe(
      Effect.onExit(() => Effect.sync(() => this.finishWorker(workerId))),
    );
    const fiber = Runtime.runFork(this.runtime)(work, {
      scope: this.serviceScope,
    });
    if (this.currentWorkerId === workerId) {
      this.worker = fiber;
    }
  }

  shutdown(): Effect.Effect<void> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        if (!this.initialized) return Effect.void;
        this.stopped = true;
        this.initialized = false;
        this.boundaryEpoch += 1;
        this.currentAccountId = null;
        this.authorizationBlocked = false;
        this.authenticationRefreshAttempted = false;
        this.rerunRequested = false;

        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = null;
        this.authService.off("authenticated", this.onAuthenticated);
        this.authService.off("token-refreshed", this.onTokenRefreshed);
        transcriptionEvents.off(
          "transcription-settled",
          this.onTranscriptionSettled,
        );
        this.unregisterBeforeLogout?.();
        this.unregisterBeforeLogout = null;

        return Scope.close(this.serviceScope, Exit.void).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.worker = null;
              this.currentWorkerId = null;
            }),
          ),
        );
      }),
    );
  }

  private handleBeforeLogout(): Effect.Effect<void> {
    const worker = this.worker;
    this.boundaryEpoch += 1;
    this.currentAccountId = null;
    this.authorizationBlocked = false;
    this.authenticationRefreshAttempted = false;
    this.rerunRequested = false;
    return worker ? Fiber.interrupt(worker).pipe(Effect.asVoid) : Effect.void;
  }

  private beginAccountBoundary(): number {
    this.boundaryEpoch += 1;
    this.currentAccountId = null;
    this.authorizationBlocked = false;
    this.authenticationRefreshAttempted = false;
    this.rerunRequested = false;
    this.worker?.unsafeInterruptAsFork(FiberId.none);
    return this.boundaryEpoch;
  }

  private activateAccount(
    accountId: string,
    epoch: number,
  ): Effect.Effect<void, ActivityReportingDependencyFailure> {
    return this.withDb(
      Effect.suspend(() => {
        if (!this.boundaryIsCurrent(epoch)) return Effect.succeed(false);
        return this.database(() =>
          activateActivityMaterializationAccount(accountId),
        ).pipe(
          Effect.map(() => {
            if (!this.boundaryIsCurrent(epoch)) return false;
            this.currentAccountId = accountId;
            this.authorizationBlocked = false;
            return true;
          }),
        );
      }),
    ).pipe(
      Effect.tap((activated) =>
        activated ? Effect.sync(() => this.wake()) : Effect.void,
      ),
      Effect.asVoid,
    );
  }

  private runWorker(): Effect.Effect<void, never> {
    const iteration = (): Effect.Effect<void, never> =>
      Effect.suspend(() => {
        const iterationEpoch = this.boundaryEpoch;
        let uploadAccountId: string | null = null;
        this.rerunRequested = false;
        return this.materializeUntilCaughtUp().pipe(
          Effect.flatMap(() => {
            const accountId = this.currentAccountId;
            const epoch = this.boundaryEpoch;
            if (!accountId || this.authorizationBlocked) return Effect.void;
            uploadAccountId = accountId;
            return this.reportUntilDrained(epoch, accountId).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  this.authenticationRefreshAttempted = false;
                }),
              ),
            );
          }),
          Effect.matchEffect({
            onFailure: (error) =>
              this.handleAttemptFailure(error, iterationEpoch, uploadAccountId),
            onSuccess: () =>
              iterationEpoch === this.boundaryEpoch &&
              this.rerunRequested &&
              !this.stopped
                ? iteration()
                : Effect.void,
          }),
          Effect.catchAllCause((cause) => {
            if (Cause.isInterruptedOnly(cause)) {
              return Effect.failCause(cause);
            }
            if (iterationEpoch === this.boundaryEpoch) {
              this.rerunRequested = false;
            }
            return Effect.sync(() => {
              logger.main.error("Activity reporting worker failed", {
                error: Cause.squash(cause),
              });
            });
          }),
        );
      });

    return iteration();
  }

  private handleAttemptFailure(
    error: ActivityAttemptError,
    epoch: number,
    accountId: string | null,
  ): Effect.Effect<void> {
    if (epoch !== this.boundaryEpoch || this.stopped) return Effect.void;
    this.rerunRequested = false;
    if (error instanceof AuthenticationRequired) {
      if (!accountId || accountId !== this.currentAccountId) {
        return Effect.void;
      }
      this.authorizationBlocked = true;
      if (
        error.meta?.httpStatus === 401 &&
        !this.authenticationRefreshAttempted
      ) {
        this.authenticationRefreshAttempted = true;
        this.forkScoped(
          this.authentication(this.authService.refreshTokenIfNeeded(true)).pipe(
            Effect.catchAll((refreshError) =>
              Effect.sync(() => {
                logger.main.error(
                  "Activity reporting authentication refresh failed",
                  { error: refreshError },
                );
              }),
            ),
          ),
        );
      }
      return Effect.sync(() => {
        logger.main.warn(
          "Activity reporting authentication failed; waiting for auth change",
          { error },
        );
      });
    }
    if (error instanceof AccessForbidden) {
      if (!accountId || accountId !== this.currentAccountId) {
        return Effect.void;
      }
      this.authorizationBlocked = true;
      return Effect.sync(() => {
        logger.main.warn(
          "Activity reporting authorization failed; waiting for auth change",
          { error },
        );
      });
    }
    return Effect.sync(() => {
      logger.main.warn(
        "Activity reporting attempt failed; durable work retained",
        { error },
      );
    });
  }

  private materializeUntilCaughtUp(): Effect.Effect<
    void,
    ActivityReportingDependencyFailure
  > {
    const scan = (): Effect.Effect<void, ActivityReportingDependencyFailure> =>
      this.db(() =>
        materializeCompletedDictationActivities(ACTIVITY_MAX_BATCH_SIZE),
      ).pipe(
        Effect.flatMap((result) =>
          result.advanced
            ? Effect.yieldNow().pipe(Effect.zipRight(Effect.suspend(scan)))
            : Effect.void,
        ),
      );

    return Effect.suspend(scan);
  }

  private reportUntilDrained(
    epoch: number,
    accountId: string,
  ): Effect.Effect<void, ActivityAttemptError> {
    const drain = (): Effect.Effect<void, ActivityAttemptError> =>
      this.findNextRows().pipe(
        Effect.flatMap((rows) => {
          if (rows.length === 0) return Effect.void;
          return Effect.try({
            try: () => buildActivityBatch(rows.map((row) => row.payload)),
            catch: (cause) =>
              new ActivityReportingContractFailure({
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Unable to construct an activity reporting batch",
                phase: "batch",
                cause,
              }),
          }).pipe(
            Effect.flatMap((activities) => {
              const submittedIds = activities.map(
                (activity) => activity.activityId,
              );
              return this.client.submit(activities).pipe(
                Effect.flatMap((result) =>
                  this.removeSubmittedRowsIfCurrent(
                    submittedIds,
                    epoch,
                    accountId,
                  ).pipe(
                    Effect.tap((removed) =>
                      removed && result === "invalid"
                        ? Effect.sync(() => {
                            logger.main.error(
                              "Axis rejected an activity batch; discarding batch",
                              { activityCount: submittedIds.length },
                            );
                          })
                        : Effect.void,
                    ),
                    Effect.flatMap((removed) =>
                      removed ? Effect.suspend(drain) : Effect.void,
                    ),
                  ),
                ),
              );
            }),
          );
        }),
      );

    return Effect.suspend(drain);
  }

  private findNextRows(): Effect.Effect<
    ActivityRows,
    ActivityReportingDependencyFailure
  > {
    const find = (): Effect.Effect<
      ActivityRows,
      ActivityReportingDependencyFailure
    > =>
      this.db(() => captureActivityRows(ACTIVITY_MAX_BATCH_SIZE)).pipe(
        Effect.flatMap((rows) => {
          if (rows.length > 0) return Effect.succeed(rows);
          return this.db(() =>
            materializeCompletedDictationActivities(ACTIVITY_MAX_BATCH_SIZE),
          ).pipe(
            Effect.flatMap((materialized) =>
              this.db(() => captureActivityRows(ACTIVITY_MAX_BATCH_SIZE)).pipe(
                Effect.flatMap((nextRows) => {
                  if (nextRows.length > 0 || !materialized.advanced) {
                    return Effect.succeed(nextRows);
                  }
                  return Effect.yieldNow().pipe(
                    Effect.zipRight(Effect.suspend(find)),
                  );
                }),
              ),
            ),
          );
        }),
      );

    return Effect.suspend(find);
  }

  private removeSubmittedRowsIfCurrent(
    activityIds: readonly string[],
    epoch: number,
    accountId: string,
  ): Effect.Effect<boolean, ActivityReportingDependencyFailure> {
    return this.withDb(
      Effect.suspend(() => {
        if (
          this.stopped ||
          epoch !== this.boundaryEpoch ||
          accountId !== this.currentAccountId
        ) {
          return Effect.succeed(false);
        }
        return this.database(() => removeActivityRows(activityIds)).pipe(
          Effect.as(true),
        );
      }),
    );
  }

  private db<T>(
    callback: () => Promise<T>,
  ): Effect.Effect<T, ActivityReportingDependencyFailure> {
    return this.withDb(this.database(callback));
  }

  private database<T>(
    callback: () => Promise<T>,
  ): Effect.Effect<T, ActivityReportingDependencyFailure> {
    return Effect.tryPromise({
      try: callback,
      catch: (cause) =>
        new ActivityReportingDependencyFailure({
          message: "Activity reporting database operation failed",
          dependency: "database",
          cause,
        }),
    });
  }

  private authentication<T, E>(
    effect: Effect.Effect<T, E>,
  ): Effect.Effect<T, ActivityReportingDependencyFailure> {
    return effect.pipe(
      Effect.mapError(
        (cause) =>
          new ActivityReportingDependencyFailure({
            message: "Activity reporting authentication operation failed",
            dependency: "authentication",
            cause,
          }),
      ),
    );
  }

  private withDb<T, E>(effect: Effect.Effect<T, E>): Effect.Effect<T, E> {
    return this.dbSemaphore.withPermits(1)(Effect.uninterruptible(effect));
  }

  private boundaryIsCurrent(epoch: number): boolean {
    return !this.stopped && epoch === this.boundaryEpoch;
  }

  private finishWorker(workerId: number): void {
    if (this.currentWorkerId !== workerId) return;
    this.currentWorkerId = null;
    this.worker = null;
    if (this.rerunRequested && this.initialized && !this.stopped) {
      queueMicrotask(() => this.wake());
    }
  }

  private forkScoped(effect: Effect.Effect<void, never>): void {
    Runtime.runFork(this.runtime)(effect, { scope: this.serviceScope });
  }

  private logBackgroundDefect(message: string) {
    return <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      effect.pipe(
        Effect.catchAllCause((cause) => {
          if (Cause.isInterruptedOnly(cause)) return Effect.failCause(cause);
          return Effect.sync(() => {
            logger.main.error(message, { error: Cause.squash(cause) });
          }).pipe(Effect.zipRight(Effect.failCause(cause)));
        }),
      );
  }
}
