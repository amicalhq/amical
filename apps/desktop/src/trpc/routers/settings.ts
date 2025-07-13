import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { createRouter, procedure } from "../trpc";

// FormatterConfig schema
const FormatterConfigSchema = z.object({
  provider: z.literal("openrouter"),
  model: z.string(),
  apiKey: z.string(),
  enabled: z.boolean(),
});

// Shortcut schema
const SetShortcutSchema = z.object({
  type: z.enum(["pushToTalk", "toggleRecording"]),
  shortcut: z.string(),
});

export const settingsRouter = createRouter({
  // Get all settings
  getSettings: procedure.query(async ({ ctx }) => {
    try {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }
      return await settingsService.getAllSettings();
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.error("Error getting settings:", error);
      }
      return {};
    }
  }),

  // Update transcription settings
  updateTranscriptionSettings: procedure
    .input(
      z.object({
        language: z.string().optional(),
        autoTranscribe: z.boolean().optional(),
        confidenceThreshold: z.number().optional(),
        enablePunctuation: z.boolean().optional(),
        enableTimestamps: z.boolean().optional(),
        preloadWhisperModel: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        // Check if preloadWhisperModel setting is changing
        const currentSettings =
          await settingsService.getTranscriptionSettings();
        const preloadChanged =
          input.preloadWhisperModel !== undefined &&
          currentSettings &&
          input.preloadWhisperModel !== currentSettings.preloadWhisperModel;

        // Merge with existing settings to provide all required fields
        const mergedSettings = {
          language: "en",
          autoTranscribe: true,
          confidenceThreshold: 0.5,
          enablePunctuation: true,
          enableTimestamps: false,
          ...currentSettings,
          ...input,
        };

        await settingsService.setTranscriptionSettings(mergedSettings);

        // Handle model preloading change
        if (preloadChanged) {
          const transcriptionService = ctx.serviceManager.getService(
            "transcriptionService",
          );
          if (transcriptionService) {
            await transcriptionService.handleModelChange();
          }
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error updating transcription settings:", error);
        }
        throw error;
      }
    }),

  // Get formatter configuration
  getFormatterConfig: procedure.query(async ({ ctx }) => {
    try {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }
      return await settingsService.getFormatterConfig();
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.transcription.error("Error getting formatter config:", error);
      }
      return null;
    }
  }),

  // Set formatter configuration
  setFormatterConfig: procedure
    .input(FormatterConfigSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }
        await settingsService.setFormatterConfig(input);

        // Update transcription service with new formatter configuration
        const transcriptionService = ctx.serviceManager.getService(
          "transcriptionService",
        );
        if (transcriptionService) {
          transcriptionService.configureFormatter(input);
          const logger = ctx.serviceManager.getLogger();
          if (logger) {
            logger.transcription.info("Formatter configuration updated");
          }
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.transcription.error("Error setting formatter config:", error);
        }
        throw error;
      }
    }),
  // Get shortcuts configuration
  getShortcuts: procedure.query(async ({ ctx }) => {
    const settingsService = ctx.serviceManager.getService("settingsService");
    if (!settingsService) {
      throw new Error("SettingsService not available");
    }
    return await settingsService.getShortcuts();
  }),
  // Set individual shortcut
  setShortcut: procedure
    .input(SetShortcutSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        // Get current shortcuts and update the specific one
        const currentShortcuts = await settingsService.getShortcuts();
        const updatedShortcuts = {
          ...currentShortcuts,
          [input.type]: input.shortcut,
        };

        await settingsService.setShortcuts(updatedShortcuts);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Shortcut updated", input);
        }

        // Notify shortcut manager to reload shortcuts
        const shortcutManager =
          ctx.serviceManager.getService("shortcutManager");
        if (shortcutManager) {
          await shortcutManager.reloadShortcuts();
          logger.main.info("Shortcut manager notified of shortcut change");
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting shortcut:", error);
        }
        throw error;
      }
    }),

  // Set shortcut recording state
  setShortcutRecordingState: procedure
    .input(z.boolean())
    .mutation(async ({ input, ctx }) => {
      try {
        const shortcutManager =
          ctx.serviceManager.getService("shortcutManager");
        if (!shortcutManager) {
          throw new Error("ShortcutManager not available");
        }

        shortcutManager.setIsRecordingShortcut(input);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Shortcut recording state updated", {
            isRecording: input,
          });
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting shortcut recording state:", error);
        }
        throw error;
      }
    }),

  // Active keys subscription for shortcut recording
  activeKeysUpdates: procedure.subscription(({ ctx }) => {
    return observable<string[]>((emit) => {
      const shortcutManager = ctx.serviceManager.getService("shortcutManager");
      const logger = ctx.serviceManager.getLogger();

      if (!shortcutManager) {
        logger?.main.warn(
          "ShortcutManager not available for activeKeys subscription",
        );
        emit.next([]);
        return () => {};
      }

      // Emit initial state
      emit.next(shortcutManager.getActiveKeys());

      // Set up listener for changes
      const handleActiveKeysChanged = (keys: string[]) => {
        emit.next(keys);
      };

      shortcutManager.on("activeKeysChanged", handleActiveKeysChanged);

      // Cleanup function
      return () => {
        shortcutManager.off("activeKeysChanged", handleActiveKeysChanged);
      };
    });
  }),

  // Set preferred microphone
  setPreferredMicrophone: procedure
    .input(
      z.object({
        deviceName: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        // Get current recording settings
        const currentSettings = await settingsService.getRecordingSettings();

        // Merge with new microphone preference
        const updatedSettings = {
          defaultFormat: "wav" as const,
          sampleRate: 16000 as const,
          autoStopSilence: false,
          silenceThreshold: 0.1,
          maxRecordingDuration: 300,
          ...currentSettings,
          preferredMicrophoneName: input.deviceName || undefined,
        };

        await settingsService.setRecordingSettings(updatedSettings);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Preferred microphone updated:", input.deviceName);
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting preferred microphone:", error);
        }
        throw error;
      }
    }),
});
