import { z } from "zod";
import { observable } from "@trpc/server/observable";
import { createRouter, procedure } from "../trpc";
import type { UpdatePrompt } from "../../main/services/update-prompt";

export const updaterRouter = createRouter({
  // Pushes the current pending update prompt (or null) to the renderer.
  // eslint-disable-next-line deprecation/deprecation
  updatePrompt: procedure.subscription(({ ctx }) => {
    return observable<UpdatePrompt | null>((emit) => {
      const service = ctx.serviceManager.getService("autoUpdaterService");
      if (!service) {
        throw new Error("Auto-updater service not available");
      }
      emit.next(service.getUpdatePrompt());
      const handler = () => emit.next(service.getUpdatePrompt());
      service.on("update-prompt-changed", handler);
      return () => {
        service.off("update-prompt-changed", handler);
      };
    });
  }),

  dismissUpdatePrompt: procedure.mutation(({ ctx }) => {
    ctx.serviceManager.getService("autoUpdaterService")?.dismissUpdatePrompt();
    return { success: true };
  }),

  checkForUpdates: procedure
    .input(
      z.object({ userInitiated: z.boolean().optional().default(false) }).optional(),
    )
    .mutation(async ({ input, ctx }) => {
      const service = ctx.serviceManager.getService("autoUpdaterService");
      if (!service) throw new Error("Auto-updater service not available");
      await service.checkForUpdates(input?.userInitiated ?? false);
      return { success: true };
    }),

  quitAndInstall: procedure.mutation(({ ctx }) => {
    const service = ctx.serviceManager.getService("autoUpdaterService");
    if (!service) throw new Error("Auto-updater service not available");
    service.quitAndInstall();
    return { success: true };
  }),
});
