import { observable } from "@trpc/server/observable";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { app } from "electron";
import path from "node:path";
import { createRouter, procedure } from "../trpc";
import { dbPath, closeDatabase } from "../../db";
import type { ModeConfig } from "../../db/schema";
import * as fs from "fs/promises";

// FormatterConfig schema
const FormatterConfigSchema = z.object({
  enabled: z.boolean(),
  modelId: z.string().optional(),
  fallbackModelId: z.string().optional(),
});

// Shortcut schema (array of key names)
const SetShortcutSchema = z.object({
  type: z.enum(["pushToTalk", "toggleRecording"]),
  shortcut: z.array(z.string()),
});

// Model providers schemas
const OpenRouterConfigSchema = z.object({
  apiKey: z.string(),
});

const OllamaConfigSchema = z.object({
  url: z.string().url().or(z.literal("")),
});

const OpenAIConfigSchema = z.object({
  apiKey: z.string(),
});

const GroqConfigSchema = z.object({
  apiKey: z.string(),
});

const GrokConfigSchema = z.object({
  apiKey: z.string(),
});

const AnthropicConfigSchema = z.object({
  apiKey: z.string(),
});

const GoogleConfigSchema = z.object({
  apiKey: z.string(),
});

const ModelProvidersConfigSchema = z.object({
  openRouter: OpenRouterConfigSchema.optional(),
  ollama: OllamaConfigSchema.optional(),
  openAI: OpenAIConfigSchema.optional(),
  groq: GroqConfigSchema.optional(),
  grok: GrokConfigSchema.optional(),
  anthropic: AnthropicConfigSchema.optional(),
  google: GoogleConfigSchema.optional(),
});

const DictationSettingsSchema = z.object({
  autoDetectEnabled: z.boolean(),
  selectedLanguage: z.string().min(1), // Must be valid when autoDetectEnabled is false
});

// Mode schemas
const CreateModeSchema = z.object({
  name: z.string().min(1).max(50),
  dictation: z.object({
    autoDetectEnabled: z.boolean(),
    selectedLanguage: z.string(),
  }),
  formatterConfig: z.object({
    enabled: z.boolean(),
    modelId: z.string().optional(),
    fallbackModelId: z.string().optional(),
  }),
  customInstructions: z.string().max(2000).optional(),
  speechModelId: z.string().optional(),
  appBindings: z.array(z.string()).max(20).optional(),
});

const UpdateModeSchema = z.object({
  modeId: z.string().min(1),
  name: z.string().min(1).max(50).optional(),
  dictation: z
    .object({
      autoDetectEnabled: z.boolean(),
      selectedLanguage: z.string(),
    })
    .optional(),
  formatterConfig: z
    .object({
      enabled: z.boolean(),
      modelId: z.string().optional(),
      fallbackModelId: z.string().optional(),
    })
    .optional(),
  customInstructions: z.string().max(2000).optional().nullable(),
  speechModelId: z.string().optional().nullable(),
  appBindings: z.array(z.string()).max(20).optional().nullable(),
});

const AppPreferencesSchema = z.object({
  launchAtLogin: z.boolean().optional(),
  minimizeToTray: z.boolean().optional(),
  showWidgetWhileInactive: z.boolean().optional(),
  showInDock: z.boolean().optional(),
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

        // Handle model preloading change (fire-and-forget to avoid blocking UI)
        if (preloadChanged) {
          const transcriptionService = ctx.serviceManager.getService(
            "transcriptionService",
          );
          if (transcriptionService) {
            transcriptionService.handleModelChange().catch((err) => {
              const logger = ctx.serviceManager.getLogger();
              logger?.main.error("Failed to handle model change:", err);
            });
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
      const settingsService = ctx.serviceManager.getService("settingsService");
      await settingsService.setFormatterConfig(input);
      return true;
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
      const shortcutManager = ctx.serviceManager.getService("shortcutManager");
      if (!shortcutManager) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "ShortcutManager not available",
        });
      }

      const result = await shortcutManager.setShortcut(
        input.type,
        input.shortcut,
      );

      if (!result.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error || "Invalid shortcut",
        });
      }

      return { success: true, warning: result.warning };
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

  // Set OpenAI configuration
  setOpenAIConfig: procedure
    .input(OpenAIConfigSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }
        await settingsService.setOpenAIConfig(input);
        ctx.serviceManager
          .getService("transcriptionService")
          ?.clearApiProviderCache();

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("OpenAI configuration updated");
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting OpenAI config:", error);
        }
        throw error;
      }
    }),

  // Set Groq configuration
  setGroqConfig: procedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }
        await settingsService.setGroqConfig(input);

        ctx.serviceManager
          .getService("transcriptionService")
          ?.clearApiProviderCache();

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Groq configuration updated");
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting Groq config:", error);
        }
        throw error;
      }
    }),

  // Set Grok configuration
  setGrokConfig: procedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }
        await settingsService.setGrokConfig(input);

        ctx.serviceManager
          .getService("transcriptionService")
          ?.clearApiProviderCache();

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Grok configuration updated");
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting Grok config:", error);
        }
        throw error;
      }
    }),

  // Set Anthropic configuration
  setAnthropicConfig: procedure
    .input(AnthropicConfigSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }
        await settingsService.setAnthropicConfig(input);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Anthropic configuration updated");
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting Anthropic config:", error);
        }
        throw error;
      }
    }),

  // Set Google configuration
  setGoogleConfig: procedure
    .input(GoogleConfigSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }
        await settingsService.setGoogleConfig(input);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Google configuration updated");
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting Google config:", error);
        }
        throw error;
      }
    }),

  // Get data path
  getDataPath: procedure.query(() => {
    return app.getPath("userData");
  }),

  // Get log file path
  getLogFilePath: procedure.query(() => {
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
    return isDev
      ? path.join(app.getPath("userData"), "logs", "vox-dev.log")
      : path.join(app.getPath("logs"), "vox.log");
  }),

  // Get machine ID for display
  getMachineId: procedure.query(async ({ ctx }) => {
    const telemetryService = ctx.serviceManager.getService("telemetryService");
    return telemetryService?.getMachineId() ?? "";
  }),

  // Get telemetry config for renderer (PostHog surveys)
  getTelemetryConfig: procedure.query(async ({ ctx }) => {
    const telemetryService = ctx.serviceManager.getService("telemetryService");
    return {
      apiKey: process.env.POSTHOG_API_KEY || __BUNDLED_POSTHOG_API_KEY,
      host: process.env.POSTHOG_HOST || __BUNDLED_POSTHOG_HOST,
      machineId: telemetryService?.getMachineId() ?? "",
      enabled: telemetryService?.isEnabled() ?? false,
      feedbackSurveyId:
        process.env.FEEDBACK_SURVEY_ID || __BUNDLED_FEEDBACK_SURVEY_ID,
    };
  }),

  // Download log file via save dialog
  downloadLogFile: procedure.mutation(async () => {
    const { dialog, BrowserWindow } = await import("electron");
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
    const logPath = isDev
      ? path.join(app.getPath("userData"), "logs", "vox-dev.log")
      : path.join(app.getPath("logs"), "vox.log");

    const focusedWindow = BrowserWindow.getFocusedWindow();
    const saveOptions = {
      defaultPath: `amical-logs-${new Date().toISOString().split("T")[0]}.log`,
      filters: [{ name: "Log Files", extensions: ["log", "txt"] }],
    };
    const { filePath } = focusedWindow
      ? await dialog.showSaveDialog(focusedWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions);

    if (filePath) {
      await fs.copyFile(logPath, filePath);
      return { success: true, path: filePath };
    }
    return { success: false };
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

      // Theme is currently fixed to dark mode.
      await settingsService.setUISettings({
        ...currentUISettings,
        theme: "dark",
      });
      // Window updates are handled via settings events in AppManager

      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.info("UI theme update requested; forcing dark mode", {
          requestedTheme: input.theme,
          appliedTheme: "dark",
        });
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

  // Get all modes
  getModes: procedure.query(async ({ ctx }) => {
    const settingsService = ctx.serviceManager.getService("settingsService");
    if (!settingsService) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "SettingsService not available",
      });
    }
    return await settingsService.getModes();
  }),

  // Get active mode
  getActiveMode: procedure.query(async ({ ctx }) => {
    const settingsService = ctx.serviceManager.getService("settingsService");
    if (!settingsService) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "SettingsService not available",
      });
    }
    return await settingsService.getActiveMode();
  }),

  // Set active mode
  setActiveMode: procedure
    .input(z.object({ modeId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "SettingsService not available",
        });
      }
      try {
        await settingsService.setActiveMode(input.modeId);

        return true;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to set active mode",
        });
      }
    }),

  // Create a new mode
  createMode: procedure
    .input(CreateModeSchema)
    .mutation(async ({ input, ctx }) => {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "SettingsService not available",
        });
      }
      try {
        const createdMode = await settingsService.createMode(input);

        // Preload only needs refresh when speech model assignment changes.
        if (input.speechModelId !== undefined) {
          const transcriptionService = ctx.serviceManager.getService(
            "transcriptionService",
          );
          if (transcriptionService) {
            transcriptionService.handleModelChange().catch((err) => {
              const logger = ctx.serviceManager.getLogger();
              logger?.main.error("Failed to handle mode change:", err);
            });
          }
        }

        return createdMode;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to create mode",
        });
      }
    }),

  // Update an existing mode
  updateMode: procedure
    .input(UpdateModeSchema)
    .mutation(async ({ input, ctx }) => {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "SettingsService not available",
        });
      }
      const { modeId, ...updates } = input;
      // Build cleanUpdates from only the keys actually present in `updates`.
      // Zod strips absent optional fields, so Object.entries only yields
      // fields the caller explicitly provided. Convert null → undefined
      // to signal "clear this field" when spread over the existing mode.
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).map(([key, value]) => [
          key,
          value === null ? undefined : value,
        ]),
      ) as Partial<
        Pick<
          ModeConfig,
          | "name"
          | "dictation"
          | "formatterConfig"
          | "customInstructions"
          | "speechModelId"
          | "appBindings"
        >
      >;
      const shouldRefreshPreload = Object.prototype.hasOwnProperty.call(
        cleanUpdates,
        "speechModelId",
      );
      try {
        const updatedMode = await settingsService.updateMode(modeId, cleanUpdates);

        if (shouldRefreshPreload) {
          const transcriptionService = ctx.serviceManager.getService(
            "transcriptionService",
          );
          if (transcriptionService) {
            transcriptionService.handleModelChange().catch((err) => {
              const logger = ctx.serviceManager.getLogger();
              logger?.main.error("Failed to handle mode change:", err);
            });
          }
        }

        return updatedMode;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to update mode",
        });
      }
    }),

  // Delete a mode
  deleteMode: procedure
    .input(z.object({ modeId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "SettingsService not available",
        });
      }
      try {
        await settingsService.deleteMode(input.modeId);

        const transcriptionService = ctx.serviceManager.getService(
          "transcriptionService",
        );
        if (transcriptionService) {
          transcriptionService.handleModelChange().catch((err) => {
            const logger = ctx.serviceManager.getLogger();
            logger?.main.error("Failed to handle mode change:", err);
          });
        }

        return true;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to delete mode",
        });
      }
    }),

  // Reset app - deletes database and models, then restarts
  resetApp: procedure.mutation(async ({ ctx }) => {
    try {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.info("Resetting app - deleting database and models");
      }

      // Close database connection before deleting
      await closeDatabase();

      // Add a small delay to ensure the connection is fully closed on Windows
      await new Promise((resolve) => setTimeout(resolve, 100));

      const userDataPath = app.getPath("userData");

      // Delete database files (main db + WAL/SHM files)
      const dbFile = path.join(userDataPath, "amical.db");
      await fs.rm(dbFile, { force: true }).catch(() => {});
      await fs.rm(`${dbFile}-wal`, { force: true }).catch(() => {});
      await fs.rm(`${dbFile}-shm`, { force: true }).catch(() => {});

      // Delete models directory
      const modelsDir = path.join(userDataPath, "models");
      await fs.rm(modelsDir, { recursive: true, force: true }).catch(() => {});

      // In development, also delete the local db file if it exists
      if (process.env.NODE_ENV === "development" || !app.isPackaged) {
        try {
          await fs.unlink(dbPath);
        } catch {
          // Ignore if file doesn't exist
        }
      }

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

  getInstalledApps: procedure.query(async ({ ctx }) => {
    const service = ctx.serviceManager.getService("installedAppsService");
    return await service.getInstalledApps();
  }),
});
// This comment prevents prettier from removing the trailing newline
