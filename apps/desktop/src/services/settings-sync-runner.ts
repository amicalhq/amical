import { Effect, Exit, Ref } from "effect";

import {
  applyPullPages,
  applyPushResults,
  capturePushHeads,
  deactivateOrganizationSyncScopes,
  getPullCursors,
  reconcileSyncScopes,
  removeOrganizationSyncScope,
  type CapturedSyncHead,
  type SyncContext,
} from "../db/sync";
import {
  SettingsSyncClient,
  type SyncBootstrap,
  type SyncPushMutation,
} from "./settings-sync-client";
import {
  SettingsSyncContractFailure,
  SettingsSyncDependencyFailure,
  SettingsSyncScopeRejected,
  type SettingsSyncAttemptError,
} from "./settings-sync-errors";
import { AccessForbidden } from "../types/errors/cloud-request";

export type SyncClient = Pick<
  SettingsSyncClient,
  "bootstrap" | "pull" | "push"
>;

export type SyncAttemptResult = { rebootstrap: boolean };

type RunSyncDb = <T, E>(effect: Effect.Effect<T, E>) => Effect.Effect<T, E>;

export class SettingsSyncRunner {
  constructor(
    private readonly client: SyncClient,
    private readonly runDb: RunSyncDb,
    private readonly notifyRenderers: () => void,
  ) {}

  run(
    context: SyncContext,
  ): Effect.Effect<SyncAttemptResult, SettingsSyncAttemptError> {
    return Effect.gen(this, function* () {
      const capabilities = yield* this.client.bootstrap(context.accountId);
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
      ): Effect.Effect<SyncAttemptResult, SettingsSyncAttemptError> => {
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
          Effect.as<SyncAttemptResult>({ rebootstrap: false }),
          Effect.catchAll((error) => {
            if (
              error instanceof SettingsSyncScopeRejected &&
              scopeContext.scopeType === "org"
            ) {
              return this.dbSync(() => deactivateOrganizationSyncScopes()).pipe(
                Effect.tap((changed) =>
                  changed
                    ? Effect.sync(() => this.notifyRenderers())
                    : Effect.void,
                ),
                Effect.as<SyncAttemptResult>({ rebootstrap: true }),
              );
            }
            if (
              scopeContext.scopeType === "org" &&
              error instanceof AccessForbidden
            ) {
              return this.db(() =>
                removeOrganizationSyncScope(scopeContext),
              ).pipe(
                Effect.tap((changed) =>
                  changed
                    ? Effect.sync(() => this.notifyRenderers())
                    : Effect.void,
                ),
                Effect.as<SyncAttemptResult>({ rebootstrap: false }),
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
  ): Effect.Effect<void, SettingsSyncAttemptError> {
    return Effect.gen(this, function* () {
      const changed = yield* Ref.make(false);
      const pullPage = (): Effect.Effect<void, SettingsSyncAttemptError> =>
        this.db(() => getPullCursors(context, capabilities.collections)).pipe(
          Effect.flatMap((cursors) => {
            if (cursors === null) return Effect.void;
            return this.client
              .pull(
                context.scopeType,
                context.scopeId,
                cursors,
                capabilities.pullLimit,
              )
              .pipe(
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
                      ).pipe(
                        Effect.zipRight(hasMore ? pullPage() : Effect.void),
                      );
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
  ): Effect.Effect<void, SettingsSyncAttemptError> {
    const pushBatch = (): Effect.Effect<void, SettingsSyncAttemptError> =>
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
            catch: (error) =>
              new SettingsSyncContractFailure({
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to construct a settings sync push batch",
                operation: "push",
                phase: "batch",
                cause: error,
              }),
          }).pipe(
            Effect.flatMap((batch) =>
              this.client
                .push(batch.mutations)
                .pipe(Effect.map((results) => ({ batch, results }))),
            ),
            Effect.flatMap(({ batch, results }) => {
              if (
                results.some(
                  (result) =>
                    result.status === "error" &&
                    result.reason === "unauthorized_scope",
                )
              ) {
                return Effect.fail(
                  new SettingsSyncScopeRejected({
                    message: `Cloud rejected the active ${context.scopeType} sync scope`,
                    context,
                  }),
                );
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

  private db<T>(
    callback: () => Promise<T>,
  ): Effect.Effect<T, SettingsSyncDependencyFailure> {
    return this.runDb(
      Effect.tryPromise({
        try: callback,
        catch: (error) =>
          new SettingsSyncDependencyFailure({
            message: "Settings sync database operation failed",
            dependency: "database",
            cause: error,
          }),
      }),
    );
  }

  private dbSync<T>(
    callback: () => T,
  ): Effect.Effect<T, SettingsSyncDependencyFailure> {
    return this.runDb(
      Effect.try({
        try: callback,
        catch: (error) =>
          new SettingsSyncDependencyFailure({
            message: "Settings sync database operation failed",
            dependency: "database",
            cause: error,
          }),
      }),
    );
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
}
