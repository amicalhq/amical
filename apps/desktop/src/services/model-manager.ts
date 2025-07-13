import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { app } from "electron";
import {
  Model,
  DownloadProgress,
  ModelManagerState,
  AVAILABLE_MODELS,
} from "../constants/models";
import { DownloadedModel } from "../db/schema";
import {
  getDownloadedModelsRecord,
  createDownloadedModel,
  deleteDownloadedModel,
  validateDownloadedModels,
  validateModelFile,
  getValidDownloadedModels,
} from "../db/downloaded-models";
import { logger } from "../main/logger";

interface ModelManagerEvents {
  "download-progress": (modelId: string, progress: DownloadProgress) => void;
  "download-complete": (
    modelId: string,
    downloadedModel: DownloadedModel,
  ) => void;
  "download-error": (modelId: string, error: Error) => void;
  "download-cancelled": (modelId: string) => void;
  "model-deleted": (modelId: string) => void;
}

class ModelManagerService extends EventEmitter {
  private state: ModelManagerState;
  private modelsDirectory: string;

  constructor() {
    super();
    this.state = {
      activeDownloads: new Map(),
    };

    // Create models directory in app data
    this.modelsDirectory = path.join(app.getPath("userData"), "models");
    this.ensureModelsDirectory();
  }

  // Type-safe event emitter methods
  on<U extends keyof ModelManagerEvents>(
    event: U,
    listener: ModelManagerEvents[U],
  ): this {
    return super.on(event, listener);
  }

  emit<U extends keyof ModelManagerEvents>(
    event: U,
    ...args: Parameters<ModelManagerEvents[U]>
  ): boolean {
    return super.emit(event, ...args);
  }

  off<U extends keyof ModelManagerEvents>(
    event: U,
    listener: ModelManagerEvents[U],
  ): this {
    return super.off(event, listener);
  }

  once<U extends keyof ModelManagerEvents>(
    event: U,
    listener: ModelManagerEvents[U],
  ): this {
    return super.once(event, listener);
  }

  // Initialize and validate models on startup
  async initialize(): Promise<void> {
    try {
      const validation = await validateDownloadedModels();

      if (validation.cleaned > 0) {
        logger.main.info("Cleaned up missing model records", {
          cleaned: validation.cleaned,
          valid: validation.valid.length,
          missing: validation.missing.map((m) => ({
            id: m.id,
            path: m.localPath,
          })),
        });
      }

      logger.main.info("Model manager initialized", {
        validModels: validation.valid.length,
        cleanedRecords: validation.cleaned,
      });
    } catch (error) {
      logger.main.error("Error initializing model manager", { error });
    }
  }

  private ensureModelsDirectory(): void {
    if (!fs.existsSync(this.modelsDirectory)) {
      fs.mkdirSync(this.modelsDirectory, { recursive: true });
      logger.main.info("Created models directory", {
        path: this.modelsDirectory,
      });
    }
  }

  // Get all available models from manifest
  getAvailableModels(): Model[] {
    return AVAILABLE_MODELS;
  }

  // Get downloaded models from database
  async getDownloadedModels(): Promise<Record<string, DownloadedModel>> {
    return await getDownloadedModelsRecord();
  }

  // Get only valid downloaded models (files that exist on disk)
  async getValidDownloadedModels(): Promise<Record<string, DownloadedModel>> {
    const validModels = await getValidDownloadedModels();
    const record: Record<string, DownloadedModel> = {};

    for (const model of validModels) {
      record[model.id] = model;
    }

    return record;
  }

  // Check if a model is downloaded and file exists
  async isModelDownloaded(modelId: string): Promise<boolean> {
    return await validateModelFile(modelId);
  }

  // Get download progress for a model
  getDownloadProgress(modelId: string): DownloadProgress | null {
    return this.state.activeDownloads.get(modelId) || null;
  }

  // Get all active downloads
  getActiveDownloads(): DownloadProgress[] {
    return Array.from(this.state.activeDownloads.values());
  }

  // Download a model
  async downloadModel(modelId: string): Promise<void> {
    const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    if (await this.isModelDownloaded(modelId)) {
      throw new Error(`Model already downloaded: ${modelId}`);
    }

    if (this.state.activeDownloads.has(modelId)) {
      throw new Error(`Download already in progress: ${modelId}`);
    }

    const abortController = new AbortController();
    const downloadPath = path.join(this.modelsDirectory, model.filename);

    const progress: DownloadProgress = {
      modelId,
      progress: 0,
      status: "downloading",
      bytesDownloaded: 0,
      totalBytes: model.size,
      abortController,
    };

    this.state.activeDownloads.set(modelId, progress);
    this.emit("download-progress", modelId, progress);

    try {
      logger.main.info("Starting model download", {
        modelId,
        size: model.sizeFormatted,
        url: model.downloadUrl,
      });

      const response = await fetch(model.downloadUrl, {
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Failed to download: ${response.status} ${response.statusText}`,
        );
      }

      const totalBytes =
        parseInt(response.headers.get("content-length") || "0") || model.size;
      progress.totalBytes = totalBytes;

      const fileStream = fs.createWriteStream(downloadPath);
      let bytesDownloaded = 0;
      let lastProgressEmit = 0;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Failed to get response reader");
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        if (abortController.signal.aborted) {
          fileStream.close();
          fs.unlinkSync(downloadPath);
          throw new Error("Download cancelled");
        }

        fileStream.write(value);
        bytesDownloaded += value.length;

        progress.bytesDownloaded = bytesDownloaded;
        progress.progress = Math.round((bytesDownloaded / totalBytes) * 100);

        // Emit progress every 1% or 1MB to avoid too many events
        const progressPercent = progress.progress;
        if (
          progressPercent - lastProgressEmit >= 1 ||
          bytesDownloaded - (lastProgressEmit * totalBytes) / 100 >= 1024 * 1024
        ) {
          this.emit("download-progress", modelId, { ...progress });
          lastProgressEmit = progressPercent;
        }
      }

      fileStream.end();

      // Get actual file size (no validation against expected size)
      const stats = fs.statSync(downloadPath);
      logger.main.info("Download completed", {
        modelId,
        expectedSize: totalBytes,
        actualSize: stats.size,
        sizeDifference: Math.abs(stats.size - totalBytes),
      });

      // Verify checksum if provided
      if (model.checksum) {
        const fileChecksum = await this.calculateFileChecksum(downloadPath);
        if (fileChecksum !== model.checksum) {
          fs.unlinkSync(downloadPath);
          throw new Error(
            `Checksum mismatch. Expected: ${model.checksum}, Got: ${fileChecksum}`,
          );
        }
      }

      // Create downloaded model record in database
      const downloadedModel = await createDownloadedModel({
        id: model.id,
        name: model.name,
        type: model.type,
        localPath: downloadPath,
        downloadedAt: new Date(),
        size: stats.size,
        checksum: model.checksum,
      });

      // Clean up active download
      this.state.activeDownloads.delete(modelId);

      logger.main.info("Model download completed", {
        modelId,
        path: downloadPath,
        size: stats.size,
      });

      this.emit("download-complete", modelId, downloadedModel);
    } catch (error) {
      // Clean up on error
      this.state.activeDownloads.delete(modelId);

      if (fs.existsSync(downloadPath)) {
        fs.unlinkSync(downloadPath);
      }

      const err = error instanceof Error ? error : new Error(String(error));

      if (abortController.signal.aborted) {
        logger.main.info("Model download cancelled", { modelId });
        this.emit("download-cancelled", modelId);
      } else {
        logger.main.error("Model download failed", {
          modelId,
          error: err.message,
        });
        this.emit("download-error", modelId, err);
      }

      throw err;
    }
  }

  // Cancel a model download
  cancelDownload(modelId: string): void {
    const download = this.state.activeDownloads.get(modelId);
    if (!download) {
      throw new Error(`No active download found for model: ${modelId}`);
    }

    download.status = "cancelling";
    download.abortController?.abort();

    // Immediately remove from active downloads to prevent restart issues
    this.state.activeDownloads.delete(modelId);

    logger.main.info("Cancelled model download", { modelId });
    this.emit("download-cancelled", modelId);
  }

  // Delete a downloaded model
  async deleteModel(modelId: string): Promise<void> {
    const downloadedModels = await this.getDownloadedModels();
    const downloadedModel = downloadedModels[modelId];

    if (!downloadedModel) {
      throw new Error(`Model not found: ${modelId}`);
    }

    // Delete file
    if (fs.existsSync(downloadedModel.localPath)) {
      fs.unlinkSync(downloadedModel.localPath);
      logger.main.info("Deleted model file", {
        modelId,
        path: downloadedModel.localPath,
      });
    }

    // Remove from database
    await deleteDownloadedModel(modelId);

    this.emit("model-deleted", modelId);
  }

  // Calculate file checksum (SHA-1)
  private async calculateFileChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha1");
      const stream = fs.createReadStream(filePath);

      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  // Get models directory path
  getModelsDirectory(): string {
    return this.modelsDirectory;
  }

  // Validate and clean up stale model records (can be called periodically)
  async validateAndCleanup(): Promise<{ cleaned: number; valid: number }> {
    try {
      const validation = await validateDownloadedModels();

      if (validation.cleaned > 0) {
        logger.main.info("Periodic cleanup completed", {
          cleaned: validation.cleaned,
          valid: validation.valid.length,
        });
      }

      return {
        cleaned: validation.cleaned,
        valid: validation.valid.length,
      };
    } catch (error) {
      logger.main.error("Error during model validation cleanup", { error });
      return { cleaned: 0, valid: 0 };
    }
  }

  // Model selection for transcription (moved from LocalWhisperClient)
  private selectedModelId: string | null = null;

  // Check if any models are available for transcription
  async isAvailable(): Promise<boolean> {
    const downloadedModels = await this.getValidDownloadedModels();
    return Object.keys(downloadedModels).length > 0;
  }

  // Get available model IDs for transcription
  async getAvailableModelsForTranscription(): Promise<string[]> {
    const downloadedModels = await this.getValidDownloadedModels();
    return Object.keys(downloadedModels);
  }

  // Get currently selected model for transcription
  getSelectedModel(): string | null {
    return this.selectedModelId;
  }

  // Set selected model for transcription
  async setSelectedModel(modelId: string): Promise<void> {
    const downloadedModels = await this.getValidDownloadedModels();
    if (!downloadedModels[modelId]) {
      throw new Error(`Model not downloaded: ${modelId}`);
    }
    this.selectedModelId = modelId;
    logger.main.info("Selected model for transcription", { modelId });
  }

  // Get best available model path for transcription (used by WhisperProvider)
  async getBestAvailableModelPath(): Promise<string | null> {
    const downloadedModels = await this.getValidDownloadedModels();

    // If a specific model is selected and available, use it
    if (this.selectedModelId && downloadedModels[this.selectedModelId]) {
      return downloadedModels[this.selectedModelId].localPath;
    }

    // Otherwise, find the best available model (prioritize by quality)
    const preferredOrder = [
      "whisper-large-v3-turbo",
      "whisper-large-v1",
      "whisper-medium",
      "whisper-small",
      "whisper-base",
      "whisper-tiny",
    ];

    for (const modelId of preferredOrder) {
      const model = downloadedModels[modelId];
      if (model && fs.existsSync(model.localPath)) {
        return model.localPath;
      }
    }

    return null;
  }

  // Cleanup - cancel all active downloads
  cleanup(): void {
    logger.main.info("Cleaning up model downloads", {
      activeDownloads: this.state.activeDownloads.size,
    });

    for (const [modelId] of this.state.activeDownloads) {
      try {
        this.cancelDownload(modelId);
      } catch (error) {
        logger.main.warn("Error cancelling download during cleanup", {
          modelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export { ModelManagerService };
