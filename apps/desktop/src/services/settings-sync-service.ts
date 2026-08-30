import { BrowserWindow } from "electron";
import { Effect, Layer, Runtime, Scope } from "effect";

import { logger } from "../main/logger";
import { down, up } from "../main/runtime/layer-helpers";
import {
  AppScopeTag,
  AuthServiceTag,
  SettingsSyncServiceTag,
} from "../main/runtime/tags";
import type { AuthService } from "./auth-service";
import { SettingsSyncClient } from "./settings-sync-client";
import type { SyncClient } from "./settings-sync-runner";
import { SettingsSyncSupervisor } from "./settings-sync-supervisor";
import type { SettingsSyncLifecycleError } from "./settings-sync-errors";

export class SettingsSyncService {
  private constructor(private readonly supervisor: SettingsSyncSupervisor) {}

  private static make(
    authService: AuthService,
    client?: SyncClient,
    runtime: Runtime.Runtime<never> = Runtime.defaultRuntime,
  ): Effect.Effect<SettingsSyncService> {
    return SettingsSyncSupervisor.make(
      authService,
      client ?? new SettingsSyncClient(authService),
      notifyRenderers,
      runtime,
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
      const runtime = yield* Effect.runtime<never>();
      const service = yield* SettingsSyncService.make(
        authService,
        undefined,
        runtime,
      );
      yield* Scope.addFinalizer(
        appScope,
        Effect.sync(() =>
          logger.main.info("Shutting down settings sync service..."),
        ).pipe(
          Effect.zipRight(service.shutdown().pipe(Effect.orDie)),
          Effect.zipLeft(down("settingsSyncService")),
        ),
      );
      yield* Effect.uninterruptible(service.initialize().pipe(Effect.orDie));
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
    } catch (error) {
      logger.main.warn("Failed to notify renderer of settings sync update", {
        error,
        windowId: window.id,
      });
    }
  }
}
