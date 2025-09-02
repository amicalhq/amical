import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { app } from "electron";
import { createRouter, procedure } from "../trpc";
import type { ValidationResult } from "../../types/providers";

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

// Validation schemas
const OpenRouterValidationSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
});

const OllamaValidationSchema = z.object({
  url: z.string().url("Invalid URL format"),
});

// Provider models schemas
const ProviderModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  size: z.string().optional(),
  context: z.string(),
  description: z.string().optional(),
  originalModel: z.any().optional(),
});

const SyncModelsSchema = z.object({
  provider: z.string(),
  models: z.array(ProviderModelSchema),
});

const DefaultModelSchema = z.object({
  modelId: z.string().optional(),
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

  // Validate OpenRouter connection
  validateOpenRouterConnection: procedure
    .input(OpenRouterValidationSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        const result = await settingsService.validateOpenRouterConnection(
          input.apiKey,
        );

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("OpenRouter validation result:", {
            success: result.success,
          });
        }

        return result;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error validating OpenRouter connection:", error);
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        } as ValidationResult;
      }
    }),

  // Validate Ollama connection
  validateOllamaConnection: procedure
    .input(OllamaValidationSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        const result = await settingsService.validateOllamaConnection(
          input.url,
        );

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Ollama validation result:", {
            success: result.success,
          });
        }

        return result;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error validating Ollama connection:", error);
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        } as ValidationResult;
      }
    }),

  // Fetch OpenRouter models
  fetchOpenRouterModels: procedure
    .input(OpenRouterValidationSchema)
    .query(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        const models = await settingsService.fetchOpenRouterModels(
          input.apiKey,
        );

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Fetched OpenRouter models:", {
            count: models.length,
          });
        }

        return models;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error fetching OpenRouter models:", error);
        }
        throw error;
      }
    }),

  // Fetch Ollama models
  fetchOllamaModels: procedure
    .input(OllamaValidationSchema)
    .query(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        const models = await settingsService.fetchOllamaModels(input.url);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Fetched Ollama models:", { count: models.length });
        }

        return models;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error fetching Ollama models:", error);
        }
        throw error;
      }
    }),

  // Get all synced provider models
  getSyncedProviderModels: procedure.query(async ({ ctx }) => {
    try {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }

      return await settingsService.getSyncedProviderModels();
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.error("Error getting synced provider models:", error);
      }
      throw error;
    }
  }),

  // Sync provider models to database
  syncProviderModels: procedure
    .input(SyncModelsSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        await settingsService.syncProviderModelsToDatabase(
          input.provider,
          input.models,
        );

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Synced provider models to database:", {
            provider: input.provider,
            count: input.models.length,
          });
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error syncing provider models:", error);
        }
        throw error;
      }
    }),

  // Remove provider model
  removeProviderModel: procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        await settingsService.removeProviderModel(input.modelId);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Removed provider model:", {
            modelId: input.modelId,
          });
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error removing provider model:", error);
        }
        throw error;
      }
    }),

  // Get default language model
  getDefaultLanguageModel: procedure.query(async ({ ctx }) => {
    try {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }

      const result = await settingsService.getDefaultLanguageModel();
      return result || "";
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.error("Error getting default language model:", error);
      }
      return "";
    }
  }),

  // Set default language model
  setDefaultLanguageModel: procedure
    .input(DefaultModelSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        await settingsService.setDefaultLanguageModel(input.modelId);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Set default language model:", {
            modelId: input.modelId,
          });
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting default language model:", error);
        }
        throw error;
      }
    }),

  // Get default embedding model
  getDefaultEmbeddingModel: procedure.query(async ({ ctx }) => {
    try {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }

      const result = await settingsService.getDefaultEmbeddingModel();
      return result || "";
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.error("Error getting default embedding model:", error);
      }
      return "";
    }
  }),

  // Set default embedding model
  setDefaultEmbeddingModel: procedure
    .input(DefaultModelSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const settingsService =
          ctx.serviceManager.getService("settingsService");
        if (!settingsService) {
          throw new Error("SettingsService not available");
        }

        await settingsService.setDefaultEmbeddingModel(input.modelId);

        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.info("Set default embedding model:", {
            modelId: input.modelId,
          });
        }

        return true;
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        if (logger) {
          logger.main.error("Error setting default embedding model:", error);
        }
        throw error;
      }
    }),

  // Remove OpenRouter provider
  removeOpenRouterProvider: procedure.mutation(async ({ ctx }) => {
    try {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }

      await settingsService.removeOpenRouterProvider();

      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.info("OpenRouter provider removed");
      }
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.error("Error removing OpenRouter provider:", error);
      }
      throw error;
    }
  }),

  // Remove Ollama provider
  removeOllamaProvider: procedure.mutation(async ({ ctx }) => {
    try {
      const settingsService = ctx.serviceManager.getService("settingsService");
      if (!settingsService) {
        throw new Error("SettingsService not available");
      }

      await settingsService.removeOllamaProvider();

      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.info("Ollama provider removed");
      }
    } catch (error) {
      const logger = ctx.serviceManager.getLogger();
      if (logger) {
        logger.main.error("Error removing Ollama provider:", error);
      }
      throw error;
    }
  }),

  // Get app version
  getAppVersion: procedure.query(() => {
    return app.getVersion();
  }),
});
