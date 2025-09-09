import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import type {
  AvailableWhisperModel,
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
        type: z.enum(["speech", "language", "embedding"]).optional(),
        downloadedOnly: z.boolean().optional().default(false),
      }),
    )
    .query(async ({ input, ctx }): Promise<Model[]> => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not available");
      }

      // For speech models (local whisper)
      if (input.type === "speech") {
        if (input.downloadedOnly) {
          const downloadedModels =
            await modelManagerService.getDownloadedModels();
          return Object.values(downloadedModels);
        }
        // Return all available whisper models as Model type
        // We need to convert from AvailableWhisperModel to Model format
        const availableModels = modelManagerService.getAvailableModels();
        const downloadedModels =
          await modelManagerService.getDownloadedModels();

        // Map available models to Model format using downloaded data if available
        return availableModels.map((m) => {
          const downloaded = downloadedModels[m.id];
          if (downloaded) {
            return downloaded;
          }
          // Create a partial Model for non-downloaded models
          return {
            id: m.id,
            name: m.name,
            provider: m.provider,
            type: "speech" as const,
            size: m.sizeFormatted,
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
          } as Model;
        });
      }

      // For language/embedding models (provider models)
      let models = await modelManagerService.getSyncedProviderModels();

      // Filter by provider if specified
      if (input.provider) {
        models = models.filter((m) => m.provider === input.provider);
      }

      // Filter by type if specified
      if (input.type) {
        models = models.filter((m) => {
          if (input.type === "embedding") {
            return (
              m.provider === "Ollama" && m.name.toLowerCase().includes("embed")
            );
          }
          // For language models, exclude embedding models
          return !(
            m.provider === "Ollama" && m.name.toLowerCase().includes("embed")
          );
        });
      }

      return models;
    }),

  // Legacy endpoints (kept for backward compatibility)
  getAvailableModels: procedure.query(
    async ({ ctx }): Promise<AvailableWhisperModel[]> => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      return modelManagerService?.getAvailableModels() || [];
    },
  ),

  getDownloadedModels: procedure.query(
    async ({ ctx }): Promise<Record<string, Model>> => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not available");
      }
      return await modelManagerService.getDownloadedModels();
    },
  ),

  // Check if model is downloaded
  isModelDownloaded: procedure
    .input(z.object({ modelId: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      return modelManagerService
        ? await modelManagerService.isModelDownloaded(input.modelId)
        : false;
    }),

  // Get download progress
  getDownloadProgress: procedure
    .input(z.object({ modelId: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      return modelManagerService?.getDownloadProgress(input.modelId) || null;
    }),

  // Get active downloads
  getActiveDownloads: procedure.query(
    async ({ ctx }): Promise<DownloadProgress[]> => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      return modelManagerService?.getActiveDownloads() || [];
    },
  ),

  // Get models directory
  getModelsDirectory: procedure.query(async ({ ctx }) => {
    const modelManagerService = ctx.serviceManager.getService(
      "modelManagerService",
    );
    return modelManagerService?.getModelsDirectory() || "";
  }),

  // Transcription model selection methods
  isTranscriptionAvailable: procedure.query(async ({ ctx }) => {
    const modelManagerService = ctx.serviceManager.getService(
      "modelManagerService",
    );
    return modelManagerService
      ? await modelManagerService.isAvailable()
      : false;
  }),

  getTranscriptionModels: procedure.query(async ({ ctx }) => {
    const modelManagerService = ctx.serviceManager.getService(
      "modelManagerService",
    );
    return modelManagerService
      ? await modelManagerService.getAvailableModelsForTranscription()
      : [];
  }),

  getSelectedModel: procedure.query(async ({ ctx }) => {
    const modelManagerService = ctx.serviceManager.getService(
      "modelManagerService",
    );
    return modelManagerService
      ? await modelManagerService.getSelectedModel()
      : null;
  }),

  // Mutations
  downloadModel: procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelManagerService.downloadModel(input.modelId);
    }),

  cancelDownload: procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return modelManagerService.cancelDownload(input.modelId);
    }),

  deleteModel: procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return modelManagerService.deleteModel(input.modelId);
    }),

  setSelectedModel: procedure
    .input(z.object({ modelId: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      await modelManagerService.setSelectedModel(input.modelId);

      // Notify transcription service about model change
      const transcriptionService = ctx.serviceManager.getService(
        "transcriptionService",
      );
      if (transcriptionService) {
        await transcriptionService.handleModelChange();
      }

      return true;
    }),

  // Provider validation endpoints
  validateOpenRouterConnection: procedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ValidationResult> => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelManagerService.validateOpenRouterConnection(
        input.apiKey,
      );
    }),

  validateOllamaConnection: procedure
    .input(z.object({ url: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ValidationResult> => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelManagerService.validateOllamaConnection(input.url);
    }),

  // Provider model fetching
  fetchOpenRouterModels: procedure
    .input(z.object({ apiKey: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelManagerService.fetchOpenRouterModels(input.apiKey);
    }),

  fetchOllamaModels: procedure
    .input(z.object({ url: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelManagerService.fetchOllamaModels(input.url);
    }),

  // Provider model database sync
  getSyncedProviderModels: procedure.query(
    async ({ ctx }): Promise<Model[]> => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelManagerService.getSyncedProviderModels();
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
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      await modelManagerService.syncProviderModelsToDatabase(
        input.provider,
        input.models,
      );
      return true;
    }),

  // Unified default model management
  getDefaultModel: procedure
    .input(
      z.object({
        type: z.enum(["speech", "language", "embedding"]),
      }),
    )
    .query(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      switch (input.type) {
        case "speech":
          return await modelManagerService.getSelectedModel();
        case "language":
          return await modelManagerService.getDefaultLanguageModel();
        case "embedding":
          return await modelManagerService.getDefaultEmbeddingModel();
      }
    }),

  setDefaultModel: procedure
    .input(
      z.object({
        type: z.enum(["speech", "language", "embedding"]),
        modelId: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      switch (input.type) {
        case "speech":
          await modelManagerService.setSelectedModel(input.modelId);
          // Notify transcription service about model change
          const transcriptionService = ctx.serviceManager.getService(
            "transcriptionService",
          );
          if (transcriptionService) {
            await transcriptionService.handleModelChange();
          }
          break;
        case "language":
          await modelManagerService.setDefaultLanguageModel(input.modelId);
          break;
        case "embedding":
          await modelManagerService.setDefaultEmbeddingModel(input.modelId);
          break;
      }
      return true;
    }),

  // Legacy endpoints (kept for backward compatibility, can be removed later)
  getDefaultLanguageModel: procedure.query(async ({ ctx }) => {
    const modelManagerService = ctx.serviceManager.getService(
      "modelManagerService",
    );
    if (!modelManagerService) {
      throw new Error("Model manager service not initialized");
    }
    return await modelManagerService.getDefaultLanguageModel();
  }),

  setDefaultLanguageModel: procedure
    .input(z.object({ modelId: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      await modelManagerService.setDefaultLanguageModel(input.modelId);
      return true;
    }),

  getDefaultEmbeddingModel: procedure.query(async ({ ctx }) => {
    const modelManagerService = ctx.serviceManager.getService(
      "modelManagerService",
    );
    if (!modelManagerService) {
      throw new Error("Model manager service not initialized");
    }
    return await modelManagerService.getDefaultEmbeddingModel();
  }),

  setDefaultEmbeddingModel: procedure
    .input(z.object({ modelId: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      await modelManagerService.setDefaultEmbeddingModel(input.modelId);
      return true;
    }),

  // Remove provider model
  removeProviderModel: procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      // Find the model to get its provider
      const allModels = await modelManagerService.getSyncedProviderModels();
      const model = allModels.find((m) => m.id === input.modelId);

      if (!model) {
        throw new Error(`Model not found: ${input.modelId}`);
      }

      await removeModel(model.provider, input.modelId);
      return true;
    }),

  // Remove provider endpoints
  removeOpenRouterProvider: procedure.mutation(async ({ ctx }) => {
    const modelManagerService = ctx.serviceManager.getService(
      "modelManagerService",
    );
    if (!modelManagerService) {
      throw new Error("Model manager service not initialized");
    }

    // Remove all OpenRouter models from database
    await modelManagerService.removeProviderModels("OpenRouter");

    // Clear OpenRouter config from settings
    const settingsService = ctx.serviceManager.getService("settingsService");
    if (settingsService) {
      const currentConfig = await settingsService.getModelProvidersConfig();
      const updatedConfig = { ...currentConfig };
      delete updatedConfig.openRouter;

      // Clear default if it's an OpenRouter model
      const allModels = await modelManagerService.getSyncedProviderModels();
      const openRouterModels = allModels.filter(
        (m) => m.provider === "OpenRouter",
      );
      if (
        currentConfig?.defaultLanguageModel &&
        openRouterModels.some(
          (m) => m.id === currentConfig.defaultLanguageModel,
        )
      ) {
        updatedConfig.defaultLanguageModel = undefined;
      }

      await settingsService.setModelProvidersConfig(updatedConfig);
    }

    return true;
  }),

  removeOllamaProvider: procedure.mutation(async ({ ctx }) => {
    const modelManagerService = ctx.serviceManager.getService(
      "modelManagerService",
    );
    if (!modelManagerService) {
      throw new Error("Model manager service not initialized");
    }

    // Remove all Ollama models from database
    await modelManagerService.removeProviderModels("Ollama");

    // Clear Ollama config from settings
    const settingsService = ctx.serviceManager.getService("settingsService");
    if (settingsService) {
      const currentConfig = await settingsService.getModelProvidersConfig();
      const updatedConfig = { ...currentConfig };
      delete updatedConfig.ollama;

      // Clear defaults if they're Ollama models
      const allModels = await modelManagerService.getSyncedProviderModels();
      const ollamaModels = allModels.filter((m) => m.provider === "Ollama");

      if (
        currentConfig?.defaultLanguageModel &&
        ollamaModels.some((m) => m.id === currentConfig.defaultLanguageModel)
      ) {
        updatedConfig.defaultLanguageModel = undefined;
      }

      if (
        currentConfig?.defaultEmbeddingModel &&
        ollamaModels.some((m) => m.id === currentConfig.defaultEmbeddingModel)
      ) {
        updatedConfig.defaultEmbeddingModel = undefined;
      }

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
        const modelManagerService = ctx.serviceManager.getService(
          "modelManagerService",
        );
        if (!modelManagerService) {
          throw new Error("Model manager service not initialized");
        }

        const handleDownloadProgress = (
          modelId: string,
          progress: DownloadProgress,
        ) => {
          emit.next({ modelId, progress });
        };

        modelManagerService.on("download-progress", handleDownloadProgress);

        // Cleanup function
        return () => {
          modelManagerService?.off("download-progress", handleDownloadProgress);
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
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      const handleDownloadComplete = (
        modelId: string,
        downloadedModel: Model,
      ) => {
        emit.next({ modelId, downloadedModel });
      };

      modelManagerService.on("download-complete", handleDownloadComplete);

      // Cleanup function
      return () => {
        modelManagerService?.off("download-complete", handleDownloadComplete);
      };
    });
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onDownloadError: procedure.subscription(({ ctx }) => {
    return observable<{ modelId: string; error: string }>((emit) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      const handleDownloadError = (modelId: string, error: Error) => {
        emit.next({ modelId, error: error.message });
      };

      modelManagerService.on("download-error", handleDownloadError);

      // Cleanup function
      return () => {
        modelManagerService?.off("download-error", handleDownloadError);
      };
    });
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onDownloadCancelled: procedure.subscription(({ ctx }) => {
    return observable<{ modelId: string }>((emit) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      const handleDownloadCancelled = (modelId: string) => {
        emit.next({ modelId });
      };

      modelManagerService.on("download-cancelled", handleDownloadCancelled);

      // Cleanup function
      return () => {
        modelManagerService?.off("download-cancelled", handleDownloadCancelled);
      };
    });
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onModelDeleted: procedure.subscription(({ ctx }) => {
    return observable<{ modelId: string }>((emit) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      const handleModelDeleted = (modelId: string) => {
        emit.next({ modelId });
      };

      modelManagerService.on("model-deleted", handleModelDeleted);

      // Cleanup function
      return () => {
        modelManagerService?.off("model-deleted", handleModelDeleted);
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
      modelType: "speech" | "language" | "embedding";
    }>((emit) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
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
        modelType: "speech" | "language" | "embedding",
      ) => {
        emit.next({ oldModelId, newModelId, reason, modelType });
      };

      modelManagerService.on("selection-changed", handleSelectionChanged);

      // Cleanup function
      return () => {
        modelManagerService?.off("selection-changed", handleSelectionChanged);
      };
    });
  }),
});
