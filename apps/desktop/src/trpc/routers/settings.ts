import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import { z } from "zod";
import { SettingsService } from "../../services/settings-service";

const t = initTRPC.create({
  isServer: true,
  transformer: superjson,
});

// FormatterConfig schema
const FormatterConfigSchema = z.object({
  provider: z.literal("openrouter"),
  model: z.string(),
  apiKey: z.string(),
  enabled: z.boolean(),
});

// We'll need to access these from the main process
declare global {
  var transcriptionService: any;
  var settingsService: any;
  var logger: any;
  var appManager: any;
  var shortcutManager: any;
}

// Shortcut schema
const SetShortcutSchema = z.object({
  type: z.enum(["pushToTalk", "toggleRecording"]),
  shortcut: z.string(),
});
export const settingsRouter = t.router({
  // Get formatter configuration
  getFormatterConfig: t.procedure.query(async () => {
    try {
      if (!globalThis.settingsService) {
        throw new Error("SettingsService not available");
      }
      return await globalThis.settingsService.getFormatterConfig();
    } catch (error) {
      if (globalThis.logger) {
        globalThis.logger.transcription.error(
          "Error getting formatter config:",
          error,
        );
      }
      return null;
    }
  }),

  // Set formatter configuration
  setFormatterConfig: t.procedure
    .input(FormatterConfigSchema)
    .mutation(async ({ input }) => {
      try {
        if (!globalThis.settingsService) {
          throw new Error("SettingsService not available");
        }
        await globalThis.settingsService.setFormatterConfig(input);

        // Update transcription service with new formatter configuration
        if (globalThis.transcriptionService) {
          globalThis.transcriptionService.configureFormatter(input);
          if (globalThis.logger) {
            globalThis.logger.transcription.info(
              "Formatter configuration updated",
            );
          }
        }

        return true;
      } catch (error) {
        if (globalThis.logger) {
          globalThis.logger.transcription.error(
            "Error setting formatter config:",
            error,
          );
        }
        throw error;
      }
    }),
  // Get shortcuts configuration
  getShortcuts: t.procedure.query(async () => {
    try {
      if (!globalThis.settingsService) {
        throw new Error("SettingsService not available");
      }
      return await globalThis.settingsService.getShortcuts();
    } catch (error) {
      if (globalThis.logger) {
        globalThis.logger.main.error("Error getting shortcuts:", error);
      }
      return {};
    }
  }),

  // Set individual shortcut
  setShortcut: t.procedure
    .input(SetShortcutSchema)
    .mutation(async ({ input }) => {
      try {
        if (!globalThis.settingsService) {
          throw new Error("SettingsService not available");
        }

        // Get current shortcuts and update the specific one
        const currentShortcuts =
          await globalThis.settingsService.getShortcuts();
        const updatedShortcuts = {
          ...currentShortcuts,
          [input.type]: input.shortcut,
        };

        await globalThis.settingsService.setShortcuts(updatedShortcuts);

        if (globalThis.logger) {
          globalThis.logger.main.info("Shortcut updated", input);
        }

        // Notify shortcut manager to reload shortcuts
        if (globalThis.shortcutManager) {
          await globalThis.shortcutManager.reloadShortcuts();
          globalThis.logger.main.info(
            "Shortcut manager notified of shortcut change",
          );
        }

        return true;
      } catch (error) {
        if (globalThis.logger) {
          globalThis.logger.main.error("Error setting shortcut:", error);
        }
        throw error;
      }
    }),

  // Active keys subscription for shortcut recording
  activeKeysUpdates: t.procedure.subscription(() => {
    return observable<string[]>((emit) => {
      if (!globalThis.shortcutManager) {
        globalThis.logger?.main.warn(
          "ShortcutManager not available for activeKeys subscription",
        );
        emit.next([]);
        return () => {};
      }

      // Emit initial state
      emit.next(globalThis.shortcutManager.getActiveKeys());

      // Set up listener for changes
      const handleActiveKeysChanged = (keys: string[]) => {
        emit.next(keys);
      };

      globalThis.shortcutManager.on(
        "activeKeysChanged",
        handleActiveKeysChanged,
      );

      // Cleanup function
      return () => {
        globalThis.shortcutManager.off(
          "activeKeysChanged",
          handleActiveKeysChanged,
        );
      };
    });
  }),
});
