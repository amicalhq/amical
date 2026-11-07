import { app, shell } from "electron";
import { z } from "zod";
import { observable } from "@trpc/server/observable";
import { createRouter, procedure } from "../trpc";
import type { UpdateState } from "../../main/services/auto-updater";
import type { UpdatePrompt } from "../../main/services/update-prompt";

interface UpdateStateUpdate {
  state: UpdateState;
}

export const updaterRouter = createRouter({
  updateRequirement: procedure.subscription(({ ctx }) => {
    const remoteConfig = ctx.services.remoteConfigService;
    const recording = ctx.services.recordingLifecycle;
    const getState = () => ({
      requirement: remoteConfig.getUpdateRequirement(),
      recordingActive:
        recording.getSnapshot().projection.publicState !== "idle",
    });
    return observable<ReturnType<typeof getState>>((emit) => {
      const push = () => emit.next(getState());
      const offConfig = remoteConfig.onChange(push);
      const offRecording = recording.onSnapshot(push);
      push();
      return () => {
        offConfig();
        offRecording();
      };
    });
  }),
  openDownloadPage: procedure.mutation(async () => {
    await shell.openExternal("https://amical.ai/download");
  }),
  quit: procedure.mutation(() => {
    app.quit();
  }),
  // Pushes the current pending update prompt (or null) to the renderer.
  // eslint-disable-next-line deprecation/deprecation
  updatePrompt: procedure.subscription(({ ctx }) => {
    return observable<UpdatePrompt | null>((emit) => {
      const service = ctx.services.autoUpdaterService;
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
    ctx.services.autoUpdaterService?.dismissUpdatePrompt();
    return { success: true };
  }),

  checkForUpdates: procedure
    .input(
      z
        .object({ userInitiated: z.boolean().optional().default(false) })
        .optional(),
    )
    .mutation(async ({ input, ctx }) => {
      const service = ctx.services.autoUpdaterService;
      if (!service) throw new Error("Auto-updater service not available");
      // Policy refresh must not delay a download when the config endpoint is offline.
      void ctx.services.remoteConfigService.refresh();
      await service.checkForUpdates(input?.userInitiated ?? false);
      return { success: true };
    }),

  onUpdateStateChange: procedure.subscription(({ ctx }) => {
    return observable<UpdateStateUpdate>((emit) => {
      const service = ctx.services.autoUpdaterService;
      if (!service) {
        emit.next({ state: "not-available" });
        return () => {};
      }

      const push = () => emit.next({ state: service.getUpdateState() });
      push();
      service.on("state-changed", push);
      return () => {
        service.off("state-changed", push);
      };
    });
  }),

  quitAndInstall: procedure.mutation(({ ctx }) => {
    const service = ctx.services.autoUpdaterService;
    if (!service) throw new Error("Auto-updater service not available");
    service.quitAndInstall();
    return { success: true };
  }),
});
