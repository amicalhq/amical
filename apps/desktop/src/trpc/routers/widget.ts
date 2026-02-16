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
      const windowManager = ctx.serviceManager.getService("windowManager");
      if (!windowManager) {
        logger.main.error("Window manager service not available");
        return false;
      }

      windowManager.openNotesWindow(input?.noteId);
      logger.main.info("Opened notes window", {
        noteId: input?.noteId,
      });
      return true;
    }),

  closeNotesWindow: procedure.mutation(async ({ ctx }) => {
    const windowManager = ctx.serviceManager.getService("windowManager");
    if (!windowManager) {
      logger.main.error("Window manager service not available");
      return false;
    }

    windowManager.closeNotesWindow();

    // Closing the notes window should immediately return to normal visibility rules.
    const settingsService = ctx.serviceManager.getService("settingsService");
    const recordingManager = ctx.serviceManager.getService("recordingManager");
    const preferences = await settingsService.getPreferences();
    const isIdle = recordingManager.getState() === "idle";

    if (preferences.showWidgetWhileInactive || !isIdle) {
      windowManager.showWidget();
    } else {
      windowManager.hideWidget();
    }

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
      const windowManager = ctx.serviceManager.getService("windowManager");
      if (!windowManager) {
        logger.main.error("Window manager service not available");
        return false;
      }

      // Check if window already exists before creating
      const windowExisted = windowManager.getMainWindow() !== null;

      // Create or show main window, passing route for new window case
      // If window is being created fresh, the route is baked into the URL hash
      // to avoid race condition where renderer isn't ready for IPC events
      await windowManager.createOrShowMainWindow(input.route);

      // If window already existed, send navigation event via IPC
      // (renderer is already loaded and listening)
      if (windowExisted) {
        const mainWindow = windowManager.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("navigate", input.route);
        }
      }

      logger.main.info("Navigated main window", {
        route: input.route,
        windowExisted,
      });
      return true;
    }),
});
