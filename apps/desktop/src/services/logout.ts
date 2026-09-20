import { app, BrowserWindow } from "electron";
import { Effect } from "effect";
import type { ServiceMap } from "../main/managers/service-manager";
import { logger } from "../main/logger";
import { clearUserData, hasPendingUserData } from "../db/user-data";
import { deleteAudioFilesForTranscriptions } from "../utils/audio-file-cleanup";
import { runAuthEffect } from "./auth-service";

type LogoutServices = Pick<
  ServiceMap,
  "authService" | "settingsSyncService" | "activityReportingService"
>;

export function getLogoutStatus(): { hasPendingChanges: boolean } {
  return { hasPendingChanges: hasPendingUserData() };
}

// The renderer shows progress before this bounded attempt to sync saved changes.
export async function syncBeforeLogout(
  services: LogoutServices,
): Promise<{ synced: boolean }> {
  if (!hasPendingUserData()) return { synced: true };

  await Effect.runPromise(
    Effect.all(
      [
        services.settingsSyncService.flush(),
        services.activityReportingService.flush(),
      ].map((work: Effect.Effect<void, unknown>) =>
        work.pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              logger.main.warn("Could not finish syncing before logout", {
                cause,
              });
            }),
          ),
        ),
      ),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.timeoutOrElse({
        duration: 15_000,
        orElse: () => Effect.void,
      }),
    ),
  );
  return { synced: !hasPendingUserData() };
}

// Called only once the renderer has finished syncing or the user chose discard.
// Restart resets renderer caches and drops unfinished app work.
export async function logoutAndClearUserData(
  services: Pick<LogoutServices, "authService">,
): Promise<{ success: true }> {
  let audio: ReturnType<typeof clearUserData> = [];
  try {
    await runAuthEffect(
      services.authService.logout(false, () => {
        audio = clearUserData();
      }),
    );
  } catch (error) {
    const state = await runAuthEffect(services.authService.getAuthState());
    if (state?.isAuthenticated)
      services.authService.emit("authenticated", state);
    throw error;
  }
  await deleteAudioFilesForTranscriptions(audio);
  // Explicit logout has already cleared local data. Editors must not veto
  // this restart, but normal app.quit() cleanup should still run.
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.once("will-prevent-unload", (event) =>
      event.preventDefault(),
    );
  }
  if (app.isPackaged && process.env.NODE_ENV !== "development") app.relaunch();
  app.quit();
  return { success: true };
}
