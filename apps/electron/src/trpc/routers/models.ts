import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import type { Model, DownloadedModel, DownloadProgress } from '../../constants/models';

const t = initTRPC.create({
  isServer: true,
  transformer: superjson,
});

// We'll need to import these services from the main process
// For now, we'll create placeholders and implement the actual logic
// by accessing the services from the main process

declare global {
  var modelManagerService: any;
  var localWhisperClient: any;
}

export const modelsRouter = t.router({
  // Get available models
  getAvailableModels: t.procedure.query(async (): Promise<Model[]> => {
    return globalThis.modelManagerService?.getAvailableModels() || [];
  }),

  // Get downloaded models
  getDownloadedModels: t.procedure.query(async (): Promise<Record<string, DownloadedModel>> => {
    return globalThis.modelManagerService ? await globalThis.modelManagerService.getDownloadedModels() : {};
  }),

  // Check if model is downloaded
  isModelDownloaded: t.procedure
    .input(z.object({ modelId: z.string() }))
    .query(async ({ input }) => {
      return globalThis.modelManagerService ? await globalThis.modelManagerService.isModelDownloaded(input.modelId) : false;
    }),

  // Get download progress
  getDownloadProgress: t.procedure
    .input(z.object({ modelId: z.string() }))
    .query(async ({ input }) => {
      return globalThis.modelManagerService?.getDownloadProgress(input.modelId) || null;
    }),

  // Get active downloads
  getActiveDownloads: t.procedure.query(async (): Promise<DownloadProgress[]> => {
    return globalThis.modelManagerService?.getActiveDownloads() || [];
  }),

  // Get models directory
  getModelsDirectory: t.procedure.query(async () => {
    return globalThis.modelManagerService?.getModelsDirectory() || '';
  }),

  // Local Whisper methods
  isLocalWhisperAvailable: t.procedure.query(async () => {
    return globalThis.localWhisperClient ? await globalThis.localWhisperClient.isAvailable() : false;
  }),

  getLocalWhisperModels: t.procedure.query(async () => {
    return globalThis.localWhisperClient ? await globalThis.localWhisperClient.getAvailableModels() : [];
  }),

  getSelectedModel: t.procedure.query(async () => {
    return globalThis.localWhisperClient ? globalThis.localWhisperClient.getSelectedModel() : null;
  }),

  // Mutations
  downloadModel: t.procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input }) => {
      if (!globalThis.modelManagerService) {
        throw new Error('Model manager service not initialized');
      }
      return await globalThis.modelManagerService.downloadModel(input.modelId);
    }),

  cancelDownload: t.procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input }) => {
      if (!globalThis.modelManagerService) {
        throw new Error('Model manager service not initialized');
      }
      return globalThis.modelManagerService.cancelDownload(input.modelId);
    }),

  deleteModel: t.procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input }) => {
      if (!globalThis.modelManagerService) {
        throw new Error('Model manager service not initialized');
      }
      return globalThis.modelManagerService.deleteModel(input.modelId);
    }),

  setSelectedModel: t.procedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input }) => {
      if (!globalThis.localWhisperClient) {
        throw new Error('Local whisper client not initialized');
      }
      return await globalThis.localWhisperClient.setSelectedModel(input.modelId);
    }),
}); 