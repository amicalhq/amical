import { createRouter, procedure } from "../trpc";
import { z } from "zod";
import { logger } from "@/main/logger";
import { getMainFeatureFlagState } from "@/main/utils/feature-flags";
import { NOTE_WINDOW_FEATURE_FLAG } from "@/utils/feature-flags";

export const widgetRouter = createRouter({
  setVisible: procedure
    .input(z.object({ visible: z.boolean() }))
    .mutation(({ ctx, input }) => {
      const windowManager = ctx.services.windowManager;

      if (input.visible) {
        windowManager.showWidget();
      } else {
        windowManager.hideWidget();
      }
      return true;
    }),

  setIgnoreMouseEvents: procedure
    .input(
      z.object({
        ignore: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const windowManager = ctx.services.windowManager;
      windowManager.setWidgetIgnoreMouseEvents(input.ignore);
      logger.main.debug("Set widget ignore mouse events", input);
      return true;
    }),

  openNotesWindow: procedure
    .input(
      z
        .object({
          noteId: z.number().int().positive().optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const windowManager = ctx.services.windowManager;
      const featureFlagService = ctx.services.featureFlagService;
      const noteWindowFlag = await getMainFeatureFlagState(
        featureFlagService,
        NOTE_WINDOW_FEATURE_FLAG,
      );

      if (!noteWindowFlag.enabled) {
        logger.main.info("Skipped opening notes window: feature disabled", {
          flagKey: NOTE_WINDOW_FEATURE_FLAG,
          flagValue: noteWindowFlag.value,
          noteId: input?.noteId,
        });
        return false;
      }

      windowManager.openNotesWindow(input?.noteId);
      logger.main.info("Opened notes window", {
        noteId: input?.noteId,
      });
      return true;
    }),

  closeNotesWindow: procedure.mutation(({ ctx }) => {
    const windowManager = ctx.services.windowManager;
    windowManager.closeNotesWindow();
    logger.main.info("Closed notes window");
    return true;
  }),

  // Navigate to a route in the main window (show and focus it first)
  navigateMainWindow: procedure
    .input(
      z.object({
        route: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const windowManager = ctx.services.windowManager;
      await windowManager.navigateMainWindow(input.route);

      logger.main.info("Navigated main window", {
        route: input.route,
      });
      return true;
    }),
});
