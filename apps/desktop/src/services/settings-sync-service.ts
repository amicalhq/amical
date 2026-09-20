import { BrowserWindow } from "electron";
import { Context, Effect, Layer, Scope } from "effect";

import { logger } from "../main/logger";
import { down, orDiePreservingCause, up } from "../main/runtime/layer-helpers";
import {
  AppScopeTag,
  AuthServiceTag,
  SettingsSyncServiceTag,
} from "../main/runtime/tags";
import type { AuthService } from "./auth-service";
import { SettingsSyncClient } from "./settings-sync-client";
import type { SyncClient } from "./settings-sync-runner";
import { SettingsSyncSupervisor } from "./settings-sync-supervisor";
import type {
  SettingsSyncFlushFailed,
  SettingsSyncLifecycleError,
} from "./settings-sync-errors";

export class SettingsSyncService {
  private constructor(private readonly supervisor: SettingsSyncSupervisor) {}

  private static make(
    authService: AuthService,
    client?: SyncClient,
    context: Context.Context<never> = Context.empty(),
  ): Effect.Effect<SettingsSyncService> {
    return SettingsSyncSupervisor.make(
      authService,
      client ?? new SettingsSyncClient(authService),
      notifyRenderers,
      context,
    ).pipe(Effect.map((supervisor) => new SettingsSyncService(supervisor)));
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
      const context = yield* Effect.context<never>();
      const service = yield* SettingsSyncService.make(
        authService,
        undefined,
        context,
      );
      yield* Scope.addFinalizer(
        appScope,
        Effect.sync(() =>
          logger.main.info("Shutting down settings sync service..."),
        ).pipe(
          Effect.andThen(service.shutdown().pipe(orDiePreservingCause)),
          Effect.tap(down("settingsSyncService")),
        ),
      );
      yield* Effect.uninterruptible(
        service.initialize().pipe(orDiePreservingCause),
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

  initialize(): Effect.Effect<void, SettingsSyncLifecycleError> {
    return this.supervisor.initialize();
  }

  wake(): void {
    this.supervisor.wake();
  }

  flush(): Effect.Effect<void, SettingsSyncFlushFailed> {
    return this.supervisor.flush();
  }

  shutdown(): Effect.Effect<void, SettingsSyncLifecycleError> {
    return this.supervisor.shutdown();
  }
}

function notifyRenderers(): void {
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
      window.webContents.send("notes:bodyChanged", {});
    } catch (error) {
      logger.main.warn("Failed to notify renderer of settings sync update", {
        error,
        windowId: window.id,
      });
    }
  }
}
