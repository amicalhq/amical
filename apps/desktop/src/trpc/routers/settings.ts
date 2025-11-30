import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { app } from "electron";
import { createRouter, procedure } from "../trpc";
import { dbPath, closeDatabase } from "../../db";
import * as fs from "fs/promises";

// FormatterConfig schema
const FormatterConfigSchema = z.object({
  model: z.string(), // Model ID from synced models
  enabled: z.boolean(),
});

// Shortcut schema
const SetShortcutSchema = z.object({
  type: z.enum(["pushToTalk", "toggleRecording"]),
  shortcut: z.string(),
});

// Model providers schemas
const OpenRouterConfigSchema = z.object({
  apiKey: z.string(),
});

const OllamaConfigSchema = z.object({
  url: z.string().url().or(z.literal("")),
});

const ModelProvidersConfigSchema = z.object({
  openRouter: OpenRouterConfigSchema.optional(),
  ollama: OllamaConfigSchema.optional(),
});

const DictationSettingsSchema = z.object({
  autoDetectEnabled: z.boolean(),
  selectedLanguage: z.string().min(1), // Must be valid when autoDetectEnabled is false
});

const AppPreferencesSchema = z.object({
  launchAtLogin: z.boolean().optional(),
  minimizeToTray: z.boolean().optional(),
  showWidgetWhileInactive: z.boolean().optional(),
});

const UIThemeSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
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
          logger?.main.info("Shortcut updated", input);
        }

        // Notify shortcut manager to reload shortcuts
        const shortcutManager =
          ctx.serviceManager.getService("shortcutManager");
        if (shortcutManager) {
          await shortcutManager.reloadShortcuts();
          if (logger) {
            logger.main.info("Shortcut manager notified of shortcut change");
          }
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

  // Get app version
  getAppVersion: procedure.query(() => {
    return app.getVersion();
  }),

  // Get dictation settings
  getDictationSettings: procedure.query(async ({ ctx }) => {
    try {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }

      const allSettings = await settingsService.getAllSettings();
      return (
        allSettings.dictation || {
          autoDetectEnabled: true,
          selectedLanguage: "en",
        }
      );
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.error("Error getting dictation settings:", error);
      }
      return {
        autoDetectEnabled: true,
        selectedLanguage: "en",
      };
    }
  }),

  // Set dictation settings
  setDictationSettings: procedure
    .input(DictationSettingsSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        // Validation: if autoDetectEnabled is false, ensure selectedLanguage is valid
        if (
          !input.autoDetectEnabled &&
          (!input.selectedLanguage || input.selectedLanguage === "auto")
        ) {
          throw new Error(
            "Selected language must be specified when auto-detect is disabled",
          );
        }

        // Set default to "en" if switching from auto-detect enabled to disabled with invalid language
        let selectedLanguage = input.selectedLanguage;
        if (
          !input.autoDetectEnabled &&
          (!selectedLanguage || selectedLanguage === "auto")
        ) {
          selectedLanguage = "en";
        }

        const dictationSettings = {
          autoDetectEnabled: input.autoDetectEnabled,
          selectedLanguage,
        };

        await settingsService.setDictationSettings(dictationSettings);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Dictation settings updated:", dictationSettings);
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting dictation settings:", error);
        }
        throw error;
      }
    }),

  // Get model providers configuration
  getModelProvidersConfig: procedure.query(async ({ ctx }) => {
    try {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }
      return await settingsService.getModelProvidersConfig();
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.error("Error getting model providers config:", error);
      }
      return null;
    }
  }),

  // Set model providers configuration
  setModelProvidersConfig: procedure
    .input(ModelProvidersConfigSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }
        await settingsService.setModelProvidersConfig(input);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Model providers configuration updated");
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting model providers config:", error);
        }
        throw error;
      }
    }),

  // Set OpenRouter configuration
  setOpenRouterConfig: procedure
    .input(OpenRouterConfigSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }
        await settingsService.setOpenRouterConfig(input);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("OpenRouter configuration updated");
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting OpenRouter config:", error);
        }
        throw error;
      }
    }),

  // Set Ollama configuration
  setOllamaConfig: procedure
    .input(OllamaConfigSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }
        await settingsService.setOllamaConfig(input);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Ollama configuration updated");
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting Ollama config:", error);
        }
        throw error;
      }
    }),

  // Get data path
  getDataPath: procedure.query(() => {
    return app.getPath("userData");
  }),

  // Get app preferences (launch at login, minimize to tray, etc.)
  getPreferences: procedure.query(async ({ ctx }) => {
    const settingsService = ctx.serviceManager.getService("settingsService");
    if (!settingsService) {
      throw new Error("SettingsService not available");
    }
    return await settingsService.getPreferences();
  }),

  // Update app preferences
  updatePreferences: procedure
    .input(AppPreferencesSchema)
    .mutation(async ({ input, ctx }) => {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }

      await settingsService.setPreferences(input);
      // Window updates are handled via settings events in AppManager

      return true;
    }),

  // Update UI theme
  updateUITheme: procedure
    .input(UIThemeSchema)
    .mutation(async ({ input, ctx }) => {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }

      // Get current UI settings
      const currentUISettings = await settingsService.getUISettings();

      // Update with new theme
      await settingsService.setUISettings({
        ...currentUISettings,
        theme: input.theme,
      });
      // Window updates are handled via settings events in AppManager

      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.info("UI theme updated", { theme: input.theme });
      }

      return true;
    }),

  // Get telemetry settings
  getTelemetrySettings: procedure.query(async ({ ctx }) => {
    try {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }
      return await settingsService.getTelemetrySettings();
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.error("Error getting telemetry settings:", error);
      }
      return { enabled: true };
    }
  }),

  // Update telemetry settings
  updateTelemetrySettings: procedure
    .input(
      z.object({
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const telemetryService =
          ctx.serviceManager.getService("telemetryService");
        if (!telemetryService) {
          throw new Error("TelemetryService not available");
        }

        // Update the telemetry service state
        await telemetryService.setEnabled(input.enabled);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Telemetry settings updated", {
            enabled: input.enabled,
          });
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error updating telemetry settings:", error);
        }
        throw error;
      }
    }),

  // Reset app - deletes all data and restarts
  resetApp: procedure.mutation(async ({ ctx }) => {
    try {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.info("Resetting app - deleting all data");
      }

      // Close database connection before deleting the file
      if (logger) {
        logger.main.info("Closing database connection before reset");
      }
      await closeDatabase();

      // Add a small delay to ensure the connection is fully closed on Windows
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Delete the database file
      await fs.unlink(dbPath);

      // Handle restart differently in development vs production
      if (process.env.NODE_ENV === "development" || !app.isPackaged) {
        //! restarting will not work properly in dev mode
        app.quit();
      } else {
        // Production mode: relaunch the app
        app.relaunch();
        app.quit();
      }

      return { success: true };
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.error("Error resetting app:", error);
      }
      throw new Error("Failed to reset app");
    }
  }),
});
// This comment prevents prettier from removing the trailing newline
