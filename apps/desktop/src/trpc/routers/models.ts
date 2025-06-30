import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import { z } from "zod";
import type {
  Model,
  DownloadedModel,
  DownloadProgress,
} from "../../constants/models";

const t = initTRPC.create({
  isServer: true,
  transformer: superjson,
});

// We'll need to import these services from the main process
// For now, we'll create placeholders and implement the actual logic
// by accessing the services from the main process

declare global {
  var modelManagerService: any;
}

export const modelsRouter = t.router({
  // Get available models
  getAvailableModels: t.procedure.query(async (): Promise<Model[]> => {
    return globalThis.modelManagerService?.getAvailableModels() || [];
  }),

  // Get downloaded models
  getDownloadedModels: t.procedure.query(
    async (): Promise<Record<string, DownloadedModel>> => {
      return globalThis.modelManagerService
        ? await globalThis.modelManagerService.getDownloadedModels()
        : {};
    },
  ),

  // Check if model is downloaded
  isModelDownloaded: t.procedure
    .input(z.object({ modelId: z.string() }))
    .query(async ({ input }) => {
      return globalThis.modelManagerService
        ? await globalThis.modelManagerService.isModelDownloaded(input.modelId)
        : false;
    }),

  // Get download progress
  getDownloadProgress: t.procedure
    .input(z.object({ modelId: z.string() }))
    .query(async ({ input }) => {
      return (
        globalThis.modelManagerService?.getDownloadProgress(input.modelId) ||
        null
      );
    }),

  // Get active downloads
  getActiveDownloads: t.procedure.query(
    async (): Promise<DownloadProgress[]> => {
      return globalThis.modelManagerService?.getActiveDownloads() || [];
    },
  ),

  // Get models directory
  getModelsDirectory: t.procedure.query(async () => {
    return globalThis.modelManagerService?.getModelsDirectory() || "";
  }),

  // Transcription model selection methods
  isTranscriptionAvailable: t.procedure.query(async () => {
    return globalThis.modelManagerService
      ? await globalThis.modelManagerService.isAvailable()
      : false;
  }),

  getTranscriptionModels: t.procedure.query(async () => {
    return globalThis.modelManagerService
      ? await globalThis.modelManagerService.getAvailableModelsForTranscription()
      : [];
  }),

  getSelectedModel: t.procedure.query(async () => {
    return globalThis.modelManagerService
      ? globalThis.modelManagerService.getSelectedModel()
      : null;
  }),

  // Mutations
  downloadModel: t.procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input }) => {
      if (!globalThis.modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return await globalThis.modelManagerService.downloadModel(input.modelId);
    }),

  cancelDownload: t.procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input }) => {
      if (!globalThis.modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return globalThis.modelManagerService.cancelDownload(input.modelId);
    }),

  deleteModel: t.procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input }) => {
      if (!globalThis.modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return globalThis.modelManagerService.deleteModel(input.modelId);
    }),

  setSelectedModel: t.procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input }) => {
      if (!globalThis.modelManagerService) {
        throw new Error("Model manager service not initialized");
      }
      return await globalThis.modelManagerService.setSelectedModel(
        input.modelId,
      );
    }),

  // Subscriptions using Observables
  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // Modern Node.js (20+) adds Symbol.asyncDispose to async generators natively,
  // which conflicts with electron-trpc's attempt to add the same symbol.
  // While Observables are deprecated in tRPC, they work without this conflict.
  // TODO: Remove this workaround when electron-trpc is updated to handle native Symbol.asyncDispose
  // eslint-disable-next-line deprecation/deprecation
  onDownloadProgress: t.procedure.subscription(() => {
    return observable<{ modelId: string; progress: DownloadProgress }>(
      (emit) => {
        if (!globalThis.modelManagerService) {
          throw new Error("Model manager service not initialized");
        }

        const handleDownloadProgress = (
          modelId: string,
          progress: DownloadProgress,
        ) => {
          emit.next({ modelId, progress });
        };

        globalThis.modelManagerService.on(
          "download-progress",
          handleDownloadProgress,
        );

        // Cleanup function
        return () => {
          globalThis.modelManagerService?.off(
            "download-progress",
            handleDownloadProgress,
          );
        };
      },
    );
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onDownloadComplete: t.procedure.subscription(() => {
    return observable<{
      modelId: string;
      downloadedModel: DownloadedModel;
    }>((emit) => {
      if (!globalThis.modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      const handleDownloadComplete = (
        modelId: string,
        downloadedModel: DownloadedModel,
      ) => {
        emit.next({ modelId, downloadedModel });
      };

      globalThis.modelManagerService.on(
        "download-complete",
        handleDownloadComplete,
      );

      // Cleanup function
      return () => {
        globalThis.modelManagerService?.off(
          "download-complete",
          handleDownloadComplete,
        );
      };
    });
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onDownloadError: t.procedure.subscription(() => {
    return observable<{ modelId: string; error: string }>((emit) => {
      if (!globalThis.modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      const handleDownloadError = (modelId: string, error: Error) => {
        emit.next({ modelId, error: error.message });
      };

      globalThis.modelManagerService.on("download-error", handleDownloadError);

      // Cleanup function
      return () => {
        globalThis.modelManagerService?.off(
          "download-error",
          handleDownloadError,
        );
      };
    });
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onDownloadCancelled: t.procedure.subscription(() => {
    return observable<{ modelId: string }>((emit) => {
      if (!globalThis.modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      const handleDownloadCancelled = (modelId: string) => {
        emit.next({ modelId });
      };

      globalThis.modelManagerService.on(
        "download-cancelled",
        handleDownloadCancelled,
      );

      // Cleanup function
      return () => {
        globalThis.modelManagerService?.off(
          "download-cancelled",
          handleDownloadCancelled,
        );
      };
    });
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onModelDeleted: t.procedure.subscription(() => {
    return observable<{ modelId: string }>((emit) => {
      if (!globalThis.modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      const handleModelDeleted = (modelId: string) => {
        emit.next({ modelId });
      };

      globalThis.modelManagerService.on("model-deleted", handleModelDeleted);

      // Cleanup function
      return () => {
        globalThis.modelManagerService?.off(
          "model-deleted",
          handleModelDeleted,
        );
      };
    });
  }),
});
