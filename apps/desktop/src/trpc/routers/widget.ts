import { createRouter, procedure } from "../trpc";
import { z } from "zod";
import { logger } from "@/main/logger";

export const widgetRouter = createRouter({
  setIgnoreMouseEvents: procedure
    .input(
      z.object({
        ignore: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const windowManager = ctx.serviceManager.getService("windowManager");
      if (!windowManager) {
        logger.main.error("Window manager service not available");
        return false;
      }

      const widgetWindow = windowManager.getWidgetWindow();
      widgetWindow!.setIgnoreMouseEvents(input.ignore, {
        forward: true,
      });
      logger.main.debug("Set widget ignore mouse events", input);
      return true;
    }),
});
