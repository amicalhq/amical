import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import type {
  AvailableSpeechModel,
  DownloadProgress,
} from "../../constants/models";
import type { Model } from "../../db/schema";
import type { ValidationResult } from "../../types/providers";
import { removeModel } from "../../db/models";

export const modelsRouter = createRouter({
  // Unified models fetching
  getModels: procedure
    .input(
      z.object({
        provider: z.string().optional(),
        type: z.enum(["speech", "language"]).optional(),
        selectable: z.boolean().optional().default(false),
      }),
    )
    .query(async ({ input, ctx }): Promise<Model[]> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not available");
      }

      // For speech models (local whisper)
      if (input.type === "speech") {
        // Return all available whisper models as Model type
        // We need to convert from AvailableSpeechModel to Model format
        const availableModels = modelService.getAvailableModels();
        const downloadedModels = await modelService.getDownloadedModels();

        // Map available models to Model format using downloaded data if available
        let models = availableModels.map((m) => {
          const downloaded = downloadedModels[m.id];
          if (downloaded) {
            // Include setup field from available model metadata
            return {
              ...downloaded,
              setup: m.setup,
            } as Model & { setup: "offline" | "api" };
          }
          // Create a partial Model for non-downloaded models
          return {
            id: m.id,
            name: m.name,
            provider: m.provider,
            type: "speech" as const,
            size: m.setup === "offline" ? m.sizeFormatted : "API",
            context: null,
            description: m.description,
            localPath: null,
            sizeBytes: null,
            checksum: null,
            downloadedAt: null,
            originalModel: null,
            speed: m.speed,
            accuracy: m.accuracy,
            createdAt: new Date(),
            updatedAt: new Date(),
            setup: m.setup,
          } as Model & { setup: "offline" | "api" };
        });

        // Apply selectable filtering for dropdown/combobox
        if (input.selectable) {
          // Check transcription API key status for API models
          const settingsService = ctx.serviceManager.getService("settingsService");
          const modelConfig = await settingsService?.getModelProvidersConfig();
          const apiKeyStatus: Record<string, boolean> = {
            OpenAI: !!modelConfig?.openAI?.apiKey,
            Groq: !!modelConfig?.groq?.apiKey,
            Grok: !!modelConfig?.grok?.apiKey,
          };

          models = models.filter((m) => {
            const model = m as Model & { setup: "offline" | "api" };
            // Filter API models by whether their provider's API key is configured
            if (model.setup === "api") {
              return apiKeyStatus[model.provider] ?? false;
            }
            // Filter local models that aren't downloaded
            return model.downloadedAt !== null;
          });
        }

        return models;
      }

      // For language models (provider models)
      let models = await modelService.getSyncedProviderModels();

      // Filter by provider if specified
      if (input.provider) {
        models = models.filter((m) => m.provider === input.provider);
      }

      // Filter by type if specified
      if (input.type) {
        models = models.filter((m) => {
          if (input.type === "language") {
            // Exclude Ollama models with "embed" in the name
            return !(
              m.provider === "Ollama" && m.name.toLowerCase().includes("embed")
            );
          }
          return true;
        });
      }

      return models;
    }),

  // Legacy endpoints (kept for backward compatibility)
  getAvailableModels: procedure.query(
    async ({ ctx }): Promise<AvailableSpeechModel[]> => {
      const modelService = ctx.serviceManager.getService("modelService");
      return modelService?.getAvailableModels() || [];
    },
  ),

  getDownloadedModels: procedure.query(
    async ({ ctx }): Promise<Record<string, Model>> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not available");
      }
      return await modelService.getDownloadedModels();
    },
  ),

  // Check if model is downloaded
  isModelDownloaded: procedure
    .input(z.object({ modelId: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      return modelService
        ? await modelService.isModelDownloaded(input.modelId)
        : false;
    }),

  // Get download progress
  getDownloadProgress: procedure
    .input(z.object({ modelId: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      return modelService?.getDownloadProgress(input.modelId) || null;
    }),

  // Get active downloads
  getActiveDownloads: procedure.query(
    async ({ ctx }): Promise<DownloadProgress[]> => {
      const modelService = ctx.serviceManager.getService("modelService");
      return modelService?.getActiveDownloads() || [];
    },
  ),

  // Get models directory
  getModelsDirectory: procedure.query(async ({ ctx }) => {
    const modelService = ctx.serviceManager.getService("modelService");
    return modelService?.getModelsDirectory() || "";
  }),

  // Transcription model selection methods
  isTranscriptionAvailable: procedure.query(async ({ ctx }) => {
    const modelService = ctx.serviceManager.getService("modelService");
    return modelService ? await modelService.isAvailable() : false;
  }),

  getTranscriptionModels: procedure.query(async ({ ctx }) => {
    const modelService = ctx.serviceManager.getService("modelService");
    return modelService
      ? await modelService.getAvailableModelsForTranscription()
      : [];
  }),

  getSelectedModel: procedure.query(async ({ ctx }) => {
    const modelService = ctx.serviceManager.getService("modelService");
    return modelService ? await modelService.getSelectedModel() : null;
  }),

  // Mutations
  downloadModel: procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.downloadModel(input.modelId);
    }),

  cancelDownload: procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return modelService.cancelDownload(input.modelId);
    }),

  deleteModel: procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return modelService.deleteModel(input.modelId);
    }),

  setSelectedModel: procedure
    .input(z.object({ modelId: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      await modelService.setSelectedModel(input.modelId);

      // Notify transcription service about model change (fire-and-forget to avoid blocking UI)
      const transcriptionService = ctx.serviceManager.getService(
        "transcriptionService",
      );
      if (transcriptionService) {
        transcriptionService.handleModelChange().catch((err) => {
          const logger = ctx.serviceManager.getLogger();
          logger?.main.error("Failed to handle model change:", err);
        });
      }

      return true;
    }),

  // Provider validation endpoints
  validateOpenRouterConnection: procedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ValidationResult> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.validateOpenRouterConnection(input.apiKey);
    }),

  validateOllamaConnection: procedure
    .input(z.object({ url: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ValidationResult> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.validateOllamaConnection(input.url);
    }),

  validateOpenAIConnection: procedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ValidationResult> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.validateOpenAIConnection(input.apiKey);
    }),

  validateAnthropicConnection: procedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ValidationResult> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.validateAnthropicConnection(input.apiKey);
    }),

  validateGoogleConnection: procedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ValidationResult> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.validateGoogleConnection(input.apiKey);
    }),

  // Transcription provider validation endpoints
  validateTranscriptionGroqConnection: procedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ValidationResult> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.validateTranscriptionGroqConnection(
        input.apiKey,
      );
    }),

  validateTranscriptionGrokConnection: procedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ValidationResult> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.validateTranscriptionGrokConnection(
        input.apiKey,
      );
    }),

  // Transcription provider status query
  getTranscriptionProviderStatus: procedure.query(async ({ ctx }) => {
    const settingsService = ctx.serviceManager.getService("settingsService");
    if (!settingsService) {
      throw new Error("SettingsService not available");
    }
    const modelConfig = await settingsService.getModelProvidersConfig();
    return {
      openAI: !!modelConfig?.openAI?.apiKey,
      groq: !!modelConfig?.groq?.apiKey,
      grok: !!modelConfig?.grok?.apiKey,
    };
  }),

  // Provider model fetching
  fetchOpenRouterModels: procedure
    .input(z.object({ apiKey: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.fetchOpenRouterModels(input.apiKey);
    }),

  fetchOllamaModels: procedure
    .input(z.object({ url: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.fetchOllamaModels(input.url);
    }),

  fetchOpenAIModels: procedure
    .input(z.object({ apiKey: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.fetchOpenAIModels(input.apiKey);
    }),

  fetchAnthropicModels: procedure
    .input(z.object({ apiKey: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.fetchAnthropicModels(input.apiKey);
    }),

  fetchGoogleModels: procedure
    .input(z.object({ apiKey: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.fetchGoogleModels(input.apiKey);
    }),

  // Provider model database sync
  getSyncedProviderModels: procedure.query(
    async ({ ctx }): Promise<Model[]> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.getSyncedProviderModels();
    },
  ),

  syncProviderModelsToDatabase: procedure
    .input(
      z.object({
        provider: z.string(),
        models: z.array(z.any()), // ProviderModel[]
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      await modelService.syncProviderModelsToDatabase(
        input.provider,
        input.models,
      );
      return true;
    }),

  // Remove provider model
  removeProviderModel: procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }

      // Find the model to get its provider
      const allModels = await modelService.getSyncedProviderModels();
      const model = allModels.find((m) => m.id === input.modelId);

      if (!model) {
        throw new Error(`Model not found: ${input.modelId}`);
      }

      await removeModel(model.provider, input.modelId);
      return true;
    }),

  // Remove provider endpoints
  removeOpenRouterProvider: procedure.mutation(async ({ ctx }) => {
    const modelService = ctx.serviceManager.getService("modelService");
    if (!modelService) {
      throw new Error("Model manager service not initialized");
    }

    // Remove all OpenRouter models from database
    await modelService.removeProviderModels("OpenRouter");

    // Clear OpenRouter config from settings
    const settingsService = ctx.serviceManager.getService("settingsService");
    if (settingsService) {
      const currentConfig = await settingsService.getModelProvidersConfig();
      const updatedConfig = { ...currentConfig };
      delete updatedConfig.openRouter;

      await settingsService.setModelProvidersConfig(updatedConfig);
    }

    return true;
  }),

  removeOllamaProvider: procedure.mutation(async ({ ctx }) => {
    const modelService = ctx.serviceManager.getService("modelService");
    if (!modelService) {
      throw new Error("Model manager service not initialized");
    }

    // Remove all Ollama models from database
    await modelService.removeProviderModels("Ollama");

    // Clear Ollama config from settings
    const settingsService = ctx.serviceManager.getService("settingsService");
    if (settingsService) {
      const currentConfig = await settingsService.getModelProvidersConfig();
      const updatedConfig = { ...currentConfig };
      delete updatedConfig.ollama;

      await settingsService.setModelProvidersConfig(updatedConfig);
    }

    return true;
  }),

  removeOpenAIProvider: procedure.mutation(async ({ ctx }) => {
    const modelService = ctx.serviceManager.getService("modelService");
    if (!modelService) {
      throw new Error("Model manager service not initialized");
    }

    await modelService.removeProviderModels("OpenAI");

    const settingsService = ctx.serviceManager.getService("settingsService");
    if (settingsService) {
      const currentConfig = await settingsService.getModelProvidersConfig();
      const updatedConfig = { ...currentConfig };
      delete updatedConfig.openAI;

      await settingsService.setModelProvidersConfig(updatedConfig);

      ctx.serviceManager
        .getService("transcriptionService")
        ?.clearApiProviderCache();

      const { AVAILABLE_MODELS } = await import("../../constants/models");
      const selectedModelId = await modelService.getSelectedModel();
      if (selectedModelId) {
        const model = AVAILABLE_MODELS.find((m) => m.id === selectedModelId);
        if (model?.setup === "api" && model.provider === "OpenAI") {
          await modelService.setSelectedModel(null);
        }
      }
    }

    return true;
  }),

  removeGroqProvider: procedure.mutation(async ({ ctx }) => {
    const settingsService = ctx.serviceManager.getService("settingsService");
    if (!settingsService) {
      throw new Error("SettingsService not available");
    }

    const currentConfig = await settingsService.getModelProvidersConfig();
    const updatedConfig = { ...currentConfig };
    delete updatedConfig.groq;
    await settingsService.setModelProvidersConfig(updatedConfig);

    ctx.serviceManager
      .getService("transcriptionService")
      ?.clearApiProviderCache();

    const modelService = ctx.serviceManager.getService("modelService");
    const { AVAILABLE_MODELS } = await import("../../constants/models");
    const selectedModelId = await modelService?.getSelectedModel();
    if (selectedModelId) {
      const model = AVAILABLE_MODELS.find((m) => m.id === selectedModelId);
      if (model?.setup === "api" && model.provider === "Groq") {
        await modelService?.setSelectedModel(null);
      }
    }

    return true;
  }),

  removeGrokProvider: procedure.mutation(async ({ ctx }) => {
    const settingsService = ctx.serviceManager.getService("settingsService");
    if (!settingsService) {
      throw new Error("SettingsService not available");
    }

    const currentConfig = await settingsService.getModelProvidersConfig();
    const updatedConfig = { ...currentConfig };
    delete updatedConfig.grok;
    await settingsService.setModelProvidersConfig(updatedConfig);

    ctx.serviceManager
      .getService("transcriptionService")
      ?.clearApiProviderCache();

    const modelService = ctx.serviceManager.getService("modelService");
    const { AVAILABLE_MODELS } = await import("../../constants/models");
    const selectedModelId = await modelService?.getSelectedModel();
    if (selectedModelId) {
      const model = AVAILABLE_MODELS.find((m) => m.id === selectedModelId);
      if (model?.setup === "api" && model.provider === "Grok") {
        await modelService?.setSelectedModel(null);
      }
    }

    return true;
  }),

  removeAnthropicProvider: procedure.mutation(async ({ ctx }) => {
    const modelService = ctx.serviceManager.getService("modelService");
    if (!modelService) {
      throw new Error("Model manager service not initialized");
    }

    await modelService.removeProviderModels("Anthropic");

    const settingsService = ctx.serviceManager.getService("settingsService");
    if (settingsService) {
      const currentConfig = await settingsService.getModelProvidersConfig();
      const updatedConfig = { ...currentConfig };
      delete updatedConfig.anthropic;

      await settingsService.setModelProvidersConfig(updatedConfig);
    }

    return true;
  }),

  removeGoogleProvider: procedure.mutation(async ({ ctx }) => {
    const modelService = ctx.serviceManager.getService("modelService");
    if (!modelService) {
      throw new Error("Model manager service not initialized");
    }

    await modelService.removeProviderModels("Google");

    const settingsService = ctx.serviceManager.getService("settingsService");
    if (settingsService) {
      const currentConfig = await settingsService.getModelProvidersConfig();
      const updatedConfig = { ...currentConfig };
      delete updatedConfig.google;

      await settingsService.setModelProvidersConfig(updatedConfig);
    }

    return true;
  }),

  // Subscriptions using Observables
  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // Modern Node.js (20+) adds Symbol.asyncDispose to async generators natively,
  // which conflicts with electron-trpc's attempt to add the same symbol.
  // While Observables are deprecated in tRPC, they work without this conflict.
  // TODO: Remove this workaround when electron-trpc is updated to handle native Symbol.asyncDispose
  // eslint-disable-next-line deprecation/deprecation
  onDownloadProgress: procedure.subscription(({ ctx }) => {
    return observable<{ modelId: string; progress: DownloadProgress }>(
      (emit) => {
        const modelService = ctx.serviceManager.getService("modelService");
        if (!modelService) {
          throw new Error("Model manager service not initialized");
        }

        const handleDownloadProgress = (
          modelId: string,
          progress: DownloadProgress,
        ) => {
          emit.next({ modelId, progress });
        };

        modelService.on("download-progress", handleDownloadProgress);

        // Cleanup function
        return () => {
          modelService?.off("download-progress", handleDownloadProgress);
        };
      },
    );
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onDownloadComplete: procedure.subscription(({ ctx }) => {
    return observable<{
      modelId: string;
      downloadedModel: Model;
    }>((emit) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }

      const handleDownloadComplete = (
        modelId: string,
        downloadedModel: Model,
      ) => {
        emit.next({ modelId, downloadedModel });
      };

      modelService.on("download-complete", handleDownloadComplete);

      // Cleanup function
      return () => {
        modelService?.off("download-complete", handleDownloadComplete);
      };
    });
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onDownloadError: procedure.subscription(({ ctx }) => {
    return observable<{ modelId: string; error: string }>((emit) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }

      const handleDownloadError = (modelId: string, error: Error) => {
        emit.next({ modelId, error: error.message });
      };

      modelService.on("download-error", handleDownloadError);

      // Cleanup function
      return () => {
        modelService?.off("download-error", handleDownloadError);
      };
    });
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onDownloadCancelled: procedure.subscription(({ ctx }) => {
    return observable<{ modelId: string }>((emit) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }

      const handleDownloadCancelled = (modelId: string) => {
        emit.next({ modelId });
      };

      modelService.on("download-cancelled", handleDownloadCancelled);

      // Cleanup function
      return () => {
        modelService?.off("download-cancelled", handleDownloadCancelled);
      };
    });
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onModelDeleted: procedure.subscription(({ ctx }) => {
    return observable<{ modelId: string }>((emit) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }

      const handleModelDeleted = (modelId: string) => {
        emit.next({ modelId });
      };

      modelService.on("model-deleted", handleModelDeleted);

      // Cleanup function
      return () => {
        modelService?.off("model-deleted", handleModelDeleted);
      };
    });
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onSelectionChanged: procedure.subscription(({ ctx }) => {
    return observable<{
      oldModelId: string | null;
      newModelId: string | null;
      reason:
        | "manual"
        | "auto-first-download"
        | "auto-after-deletion"
        | "cleared";
      modelType: "speech" | "language";
    }>((emit) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }

      const handleSelectionChanged = (
        oldModelId: string | null,
        newModelId: string | null,
        reason:
          | "manual"
          | "auto-first-download"
          | "auto-after-deletion"
          | "cleared",
        modelType: "speech" | "language",
      ) => {
        emit.next({ oldModelId, newModelId, reason, modelType });
      };

      modelService.on("selection-changed", handleSelectionChanged);

      // Cleanup function
      return () => {
        modelService?.off("selection-changed", handleSelectionChanged);
      };
    });
  }),
});
