import { SyncIdSchema } from "@amical/api-contracts/apps/v1";
import { observable } from "@trpc/server/observable";
import { createRouter, procedure } from "../trpc";
import { z } from "zod";
import { logger } from "@/main/logger";
import { getMainFeatureFlagState } from "@/main/utils/feature-flags";
import { NOTE_WINDOW_FEATURE_FLAG } from "@/utils/feature-flags";
import type { WidgetFeedItem } from "@/types/widget-feed";

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

  // Linux only: the pill's rectangle in the widget window (see
  // reportWidgetHitArea in the widget renderer).
  setHitArea: procedure
    .input(
      z.object({
        x: z.number(),
        y: z.number(),
        width: z.number().nonnegative(),
        height: z.number().nonnegative(),
      }),
    )
    .mutation(({ ctx, input }) => {
      ctx.services.windowManager.setWidgetHitArea(input);
      return true;
    }),

  openNotesWindow: procedure
    .input(
      z
        .object({
          noteId: SyncIdSchema.optional(),
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

  // The notification card's item.
  feedItem: procedure.subscription(({ ctx }) => {
    return observable<{ item: WidgetFeedItem | null }>((emit) => {
      const widgetFeedService = ctx.services.widgetFeedService;
      const push = () => emit.next({ item: widgetFeedService.get() });
      const unsubscribe = widgetFeedService.onChange(push);
      push();
      return unsubscribe;
    });
  }),

  markFeedDisplayed: procedure
    .input(z.object({ itemId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.services.widgetFeedService.markDisplayed(input.itemId),
    ),

  closeFeedItem: procedure
    .input(z.object({ itemId: z.string(), clicked: z.boolean() }))
    .mutation(({ ctx, input }) =>
      ctx.services.widgetFeedService.close(input.itemId, input.clicked),
    ),

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
