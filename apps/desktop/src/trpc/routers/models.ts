import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import type { Model, DownloadProgress } from "../../constants/models";
import type { DownloadedModel } from "../../db/schema";

export const modelsRouter = createRouter({
  // Get available models
  getAvailableModels: procedure.query(async ({ ctx }): Promise<Model[]> => {
    const modelManagerService = ctx.serviceManager.getService(
      "modelManagerService",
    );
    return modelManagerService?.getAvailableModels() || [];
  }),

  // Get downloaded models
  getDownloadedModels: procedure.query(async ({ ctx }) => {
    const modelManagerService = ctx.serviceManager.getService(
      "modelManagerService",
    );
    if (!modelManagerService) {
      throw new Error("Model manager service not available");
    }
    return await modelManagerService.getDownloadedModels();
  }),

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
    return modelManagerService ? modelManagerService.getSelectedModel() : null;
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
      downloadedModel: DownloadedModel;
    }>((emit) => {
      const modelManagerService = ctx.serviceManager.getService(
        "modelManagerService",
      );
      if (!modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      const handleDownloadComplete = (
        modelId: string,
        downloadedModel: DownloadedModel,
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
      ) => {
        emit.next({ oldModelId, newModelId, reason });
      };

      modelManagerService.on("selection-changed", handleSelectionChanged);

      // Cleanup function
      return () => {
        modelManagerService?.off("selection-changed", handleSelectionChanged);
      };
    });
  }),
});
