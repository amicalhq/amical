import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import type { Context } from "../context";
import type {
  AvailableWhisperModel,
  DownloadProgress,
} from "../../constants/models";
import type { AppSettingsData, Model } from "../../db/schema";
import type { ValidationResult } from "../../types/providers";
import { removeModel } from "../../db/models";
import {
  REMOTE_PROVIDERS,
  type RemoteProvider,
} from "../../constants/remote-providers";
import {
  PROVIDER_TYPES,
  getSystemProviderInstanceId,
} from "../../constants/provider-types";
import {
  findModelBySelectionValue,
  type ModelSelectionType,
} from "../../utils/model-selection";

type ProviderConfigKey = keyof NonNullable<
  AppSettingsData["modelProvidersConfig"]
>;

const remoteProviderSchema = z.enum([
  REMOTE_PROVIDERS.openRouter,
  REMOTE_PROVIDERS.ollama,
  REMOTE_PROVIDERS.openAICompatible,
]);

const syncedProviderModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  providerType: z.string(),
  providerInstanceId: z.string(),
  provider: z.string(),
  size: z.string().optional().nullable(),
  context: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  originalModel: z.unknown().optional().nullable(),
});

async function removeProviderEndpoint(
  ctx: Context,
  provider: RemoteProvider,
  configKey: ProviderConfigKey,
): Promise<true> {
  const modelService = ctx.serviceManager.getService("modelService");
  if (!modelService) {
    throw new Error("Model manager service not initialized");
  }

  await modelService.removeProviderModels(provider);

  const settingsService = ctx.serviceManager.getService("settingsService");
  if (settingsService) {
    const currentConfig = await settingsService.getModelProvidersConfig();
    const updatedConfig = { ...currentConfig };
    delete updatedConfig[configKey];
    await settingsService.setModelProvidersConfig(updatedConfig);
  }

  return true;
}

export const modelsRouter = createRouter({
  // Unified models fetching
  getModels: procedure
    .input(
      z.object({
        provider: z.string().optional(),
        type: z.enum(["speech", "language", "embedding"]).optional(),
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
        // We need to convert from AvailableWhisperModel to Model format
        const availableModels = modelService.getAvailableModels();
        const downloadedModels = await modelService.getDownloadedModels();

        // Check authentication status for cloud model filtering
        const authService = ctx.serviceManager.getService("authService");
        const isAuthenticated = await authService.isAuthenticated();

        // Map available models to Model format using downloaded data if available
        let models = availableModels.map((m) => {
          const downloaded = downloadedModels[m.id];
          if (downloaded) {
            // Include setup field from available model metadata
            return {
              ...downloaded,
              providerType:
                m.id === "amical-cloud"
                  ? PROVIDER_TYPES.amical
                  : PROVIDER_TYPES.localWhisper,
              providerInstanceId:
                m.id === "amical-cloud"
                  ? getSystemProviderInstanceId(PROVIDER_TYPES.amical)
                  : getSystemProviderInstanceId(PROVIDER_TYPES.localWhisper),
              provider: m.provider,
              setup: m.setup,
            } as Model & { setup: "offline" | "cloud" };
          }
          // Create a partial Model for non-downloaded models
          return {
            id: m.id,
            providerType:
              m.id === "amical-cloud"
                ? PROVIDER_TYPES.amical
                : PROVIDER_TYPES.localWhisper,
            providerInstanceId:
              m.id === "amical-cloud"
                ? getSystemProviderInstanceId(PROVIDER_TYPES.amical)
                : getSystemProviderInstanceId(PROVIDER_TYPES.localWhisper),
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
            setup: m.setup,
          } as Model & { setup: "offline" | "cloud" };
        });

        // Apply selectable filtering for dropdown/combobox
        if (input.selectable) {
          models = models.filter((m) => {
            const model = m as Model & { setup: "offline" | "cloud" };
            // Filter cloud models if not authenticated
            if (model.setup === "cloud") {
              return isAuthenticated;
            }
            // Filter local models that aren't downloaded
            return model.downloadedAt !== null;
          });
        }

        return models;
      }

      // For language/embedding models (provider models)
      let models = await modelService.getSyncedProviderModels();

      // Filter by provider if specified
      if (input.provider) {
        models = models.filter((m) => m.provider === input.provider);
      }

      // Filter by type if specified
      if (input.type) {
        models = models.filter((m) => m.type === input.type);
      }

      return models;
    }),

  // Legacy endpoints (kept for backward compatibility)
  getAvailableModels: procedure.query(
    async ({ ctx }): Promise<AvailableWhisperModel[]> => {
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
        await transcriptionService.handleModelChange();
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

  validateOpenAICompatibleConnection: procedure
    .input(z.object({ baseURL: z.string().url(), apiKey: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ValidationResult> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.validateOpenAICompatibleConnection(
        input.baseURL,
        input.apiKey,
      );
    }),

  validateOpenAIWhisperConnection: procedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ValidationResult> => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.validateOpenAIWhisperConnection(input.apiKey);
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

  fetchOpenAICompatibleModels: procedure
    .input(z.object({ baseURL: z.string().url(), apiKey: z.string() }))
    .query(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      return await modelService.fetchOpenAICompatibleModels(
        input.baseURL,
        input.apiKey,
      );
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
        provider: remoteProviderSchema,
        models: z.array(syncedProviderModelSchema),
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

  // Unified default model management
  getDefaultModel: procedure
    .input(
      z.object({
        type: z.enum(["speech", "language", "embedding"]),
      }),
    )
    .query(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }

      switch (input.type) {
        case "speech":
          return await modelService.getSelectedModel();
        case "language":
          return await modelService.getDefaultLanguageModel();
        case "embedding":
          return await modelService.getDefaultEmbeddingModel();
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
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }

      switch (input.type) {
        case "speech": {
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
          break;
        }
        case "language":
          await modelService.setDefaultLanguageModel(input.modelId);
          break;
        case "embedding":
          await modelService.setDefaultEmbeddingModel(input.modelId);
          break;
      }
      return true;
    }),

  // Legacy endpoints (kept for backward compatibility, can be removed later)
  getDefaultLanguageModel: procedure.query(async ({ ctx }) => {
    const modelService = ctx.serviceManager.getService("modelService");
    if (!modelService) {
      throw new Error("Model manager service not initialized");
    }
    return await modelService.getDefaultLanguageModel();
  }),

  setDefaultLanguageModel: procedure
    .input(z.object({ modelId: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      await modelService.setDefaultLanguageModel(input.modelId);
      return true;
    }),

  getDefaultEmbeddingModel: procedure.query(async ({ ctx }) => {
    const modelService = ctx.serviceManager.getService("modelService");
    if (!modelService) {
      throw new Error("Model manager service not initialized");
    }
    return await modelService.getDefaultEmbeddingModel();
  }),

  setDefaultEmbeddingModel: procedure
    .input(z.object({ modelId: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const modelService = ctx.serviceManager.getService("modelService");
      if (!modelService) {
        throw new Error("Model manager service not initialized");
      }
      await modelService.setDefaultEmbeddingModel(input.modelId);
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
      const model = findModelBySelectionValue(allModels, input.modelId);

      if (!model) {
        throw new Error(`Model not found: ${input.modelId}`);
      }

      await removeModel(
        model.providerInstanceId,
        model.type as ModelSelectionType,
        model.id,
      );
      return true;
    }),

  // Remove provider endpoints
  removeOpenRouterProvider: procedure.mutation(({ ctx }) =>
    removeProviderEndpoint(ctx, REMOTE_PROVIDERS.openRouter, "openRouter"),
  ),

  removeOllamaProvider: procedure.mutation(({ ctx }) =>
    removeProviderEndpoint(ctx, REMOTE_PROVIDERS.ollama, "ollama"),
  ),

  removeOpenAICompatibleProvider: procedure.mutation(({ ctx }) =>
    removeProviderEndpoint(
      ctx,
      REMOTE_PROVIDERS.openAICompatible,
      "openAICompatible",
    ),
  ),

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
      modelType: "speech" | "language" | "embedding";
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
        modelType: "speech" | "language" | "embedding",
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
