import { z } from "zod";
import { createRouter, procedure } from "../trpc";

export const updaterRouter = createRouter({
  // Check for updates (manual trigger)
  checkForUpdates: procedure
    .input(
      z
        .object({ userInitiated: z.boolean().optional().default(false) })
        .optional(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const autoUpdaterService =
          ctx.serviceManager.getService("autoUpdaterService");
        if (!autoUpdaterService) {
          throw new Error("Auto-updater service not available");
        }

        const userInitiated = input?.userInitiated ?? false;
        await autoUpdaterService.checkForUpdates(userInitiated);
        const logger = ctx.serviceManager.getLogger();
        logger?.updater.info("Update check initiated via tRPC", {
          userInitiated,
        });

        return { success: true };
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        logger?.updater.error("Error checking for updates via tRPC", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }),

  // Quit and install update
  quitAndInstall: procedure.mutation(async ({ ctx }) => {
    try {
      const autoUpdaterService =
        ctx.serviceManager.getService("autoUpdaterService");
      if (!autoUpdaterService) {
        throw new Error("Auto-updater service not available");
      }

      const logger = ctx.serviceManager.getLogger();
      logger?.updater.info("Quit and install initiated via tRPC");
      autoUpdaterService.quitAndInstall();

      return { success: true };
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      logger?.updater.error("Error quitting and installing via tRPC", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }),
});
