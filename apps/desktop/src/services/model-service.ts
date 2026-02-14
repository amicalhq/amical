import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { app } from "electron";
import {
  AvailableWhisperModel,
  DownloadProgress,
  ModelManagerState,
  AVAILABLE_MODELS,
} from "../constants/models";
import { Model as DBModel, NewModel } from "../db/schema";
import {
  getModelsByProvider,
  getDownloadedWhisperModels,
  removeModel,
  modelExists,
  syncLocalWhisperModels,
  getAllModels,
  syncModelsForProvider,
  removeModelsForProvider,
  upsertModel,
  getModelById,
} from "../db/models";
import {
  ValidationResult,
  OpenRouterResponse,
  OllamaResponse,
  OpenRouterModel,
  OllamaModel,
} from "../types/providers";
import { SettingsService } from "./settings-service";
import { AuthService } from "./auth-service";
import { logger } from "../main/logger";
import { getUserAgent } from "../utils/http-client";

// Type for models fetched from external APIs
type FetchedModel = Pick<DBModel, "id" | "name" | "provider"> &
  Partial<DBModel>;

interface ModelManagerEvents {
  "download-progress": (modelId: string, progress: DownloadProgress) => void;
  "download-complete": (modelId: string, downloadedModel: DBModel) => void;
  "download-error": (modelId: string, error: Error) => void;
  "download-cancelled": (modelId: string) => void;
  "model-deleted": (modelId: string) => void;
  "selection-changed": (
    oldModelId: string | null,
    newModelId: string | null,
    reason:
      | "manual"
      | "auto-first-download"
      | "auto-after-deletion"
      | "cleared",
    modelType: "speech" | "language" | "embedding",
  ) => void;
}

class ModelService extends EventEmitter {
  private state: ModelManagerState;
  private modelsDirectory: string;
  private settingsService: SettingsService;
  private readonly localSpeechPreference = [
    "whisper-large-v3-turbo",
    "parakeet-ctc-0.6b-int8",
    "whisper-large-v3",
    "whisper-medium",
    "whisper-small",
    "whisper-base",
    "whisper-tiny",
  ];

  constructor(settingsService: SettingsService) {
    super();
    this.state = {
      activeDownloads: new Map(),
    };
    this.settingsService = settingsService;

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
      // Sync local speech models with filesystem
      const whisperModelsData = AVAILABLE_MODELS
        .filter((model) => model.setup === "offline" && !!model.filename)
        .map((model) => ({
          id: model.id,
          name: model.name,
          description: model.description,
          size: model.sizeFormatted,
          checksum: model.checksum,
          speed: model.speed,
          accuracy: model.accuracy,
          filename: model.filename,
        }));

      const syncResult = await syncLocalWhisperModels(
        this.modelsDirectory,
        whisperModelsData,
      );

      logger.main.info("Model manager initialized", {
        added: syncResult.added,
        updated: syncResult.updated,
        removed: syncResult.removed,
      });

      // Restore selected model from settings and validate availability
      const savedSelection = await this.settingsService.getDefaultSpeechModel();

      if (savedSelection) {
        // Validate the saved selection is still available
        const availableModel = AVAILABLE_MODELS.find(
          (m) => m.id === savedSelection,
        );

        // Check if it's a cloud model and user is authenticated
        if (availableModel?.setup === "cloud") {
          const authService = AuthService.getInstance();
          const isAuthenticated = await authService.isAuthenticated();

          if (!isAuthenticated) {
            // Cloud model selected but not authenticated - auto-switch to local model
            const downloadedModels = await this.getValidDownloadedModels();
            const downloadedModelIds = Object.keys(downloadedModels);

            if (downloadedModelIds.length > 0) {
              const newModelId =
                this.pickPreferredLocalModelId(downloadedModelIds);

              await this.applySpeechModelSelection(
                newModelId,
                "manual",
                savedSelection,
              );

              logger.main.info(
                "Auto-switched from cloud model to local model on startup (not authenticated)",
                {
                  from: savedSelection,
                  to: newModelId,
                },
              );
            } else {
              // No local models available
              await this.applySpeechModelSelection(
                null,
                "cleared",
                savedSelection,
              );
              logger.main.warn(
                "Cleared cloud model selection on startup - not authenticated and no local models available",
              );
            }
          }
        }
      } else {
        // No saved selection, check if we have downloaded models to auto-select
        const downloadedModels = await this.getValidDownloadedModels();
        const downloadedModelCount = Object.keys(downloadedModels).length;

        if (downloadedModelCount > 0) {
          // Auto-select the best available model using the preferred order
          const downloadedModelIds = Object.keys(downloadedModels);
          const candidateId =
            this.pickPreferredLocalModelId(downloadedModelIds);
          await this.applySpeechModelSelection(
            candidateId,
            "auto-first-download",
            null,
          );
          logger.main.info("Auto-selected speech model on initialization", {
            modelId: candidateId,
            availableModels: downloadedModelIds,
          });
        }
      }

      // Validate all default models after sync
      await this.validateAndClearInvalidDefaults();

      // Setup auth event listeners
      this.setupAuthEventListeners();
    } catch (error) {
      logger.main.error("Error initializing model manager", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Setup auth event listeners to handle logout
  private setupAuthEventListeners(): void {
    const authService = AuthService.getInstance();

    authService.on("logged-out", async () => {
      try {
        const selectedModelId = await this.getSelectedModel();

        if (selectedModelId) {
          // Check if the selected model is a cloud model
          const availableModel = AVAILABLE_MODELS.find(
            (m) => m.id === selectedModelId,
          );

          if (availableModel?.setup === "cloud") {
            // Cloud model selected but user logged out - auto-switch to first downloaded local model
            const downloadedModels = await this.getValidDownloadedModels();
            const downloadedModelIds = Object.keys(downloadedModels);

            if (downloadedModelIds.length > 0) {
              // Find the best local model from preferred order
              const newModelId =
                this.pickPreferredLocalModelId(downloadedModelIds);

              await this.applySpeechModelSelection(
                newModelId,
                "manual",
                selectedModelId,
              );

              logger.main.info(
                "Auto-switched from cloud model to local model after logout",
                {
                  from: selectedModelId,
                  to: newModelId,
                },
              );
            } else {
              // No local models available, clear selection
              await this.applySpeechModelSelection(
                null,
                "cleared",
                selectedModelId,
              );

              logger.main.warn(
                "Cleared cloud model selection after logout - no local models available",
              );
            }
          }
        }
      } catch (error) {
        logger.main.error("Error handling logout in model manager", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private ensureModelsDirectory(): void {
    if (!fs.existsSync(this.modelsDirectory)) {
      fs.mkdirSync(this.modelsDirectory, { recursive: true });
      logger.main.info("Created models directory", {
        path: this.modelsDirectory,
      });
    }
  }

  private pickPreferredLocalModelId(downloadedModelIds: string[]): string {
    for (const candidateId of this.localSpeechPreference) {
      if (downloadedModelIds.includes(candidateId)) {
        return candidateId;
      }
    }
    return downloadedModelIds[0];
  }

  // Get all available models from manifest
  getAvailableModels(): AvailableWhisperModel[] {
    return AVAILABLE_MODELS;
  }

  // Get downloaded models from database
  async getDownloadedModels(): Promise<Record<string, DBModel>> {
    const models = await getDownloadedWhisperModels();
    const record: Record<string, DBModel> = {};

    for (const model of models) {
      record[model.id] = model;
    }

    return record;
  }

  // Get only valid downloaded models (files that exist on disk)
  // Since we sync on init and only store downloaded models, all models in DB are valid
  async getValidDownloadedModels(): Promise<Record<string, DBModel>> {
    return this.getDownloadedModels();
  }

  // Check if a model is downloaded
  // Since we only store downloaded models, just check if it exists in DB
  async isModelDownloaded(modelId: string): Promise<boolean> {
    const models = await getModelsByProvider("local-whisper");
    return models.some((m) => m.id === modelId);
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

    if (model.setup === "cloud") {
      throw new Error(`Cloud model cannot be downloaded: ${modelId}`);
    }

    if (await this.isModelDownloaded(modelId)) {
      throw new Error(`Model already downloaded: ${modelId}`);
    }

    if (this.state.activeDownloads.has(modelId)) {
      throw new Error(`Download already in progress: ${modelId}`);
    }

    const abortController = new AbortController();
    const modelDirectory = path.join(this.modelsDirectory, model.id);
    fs.mkdirSync(modelDirectory, { recursive: true });

    const artifacts =
      model.artifacts && model.artifacts.length > 0
        ? model.artifacts
        : [
            {
              filename: model.filename,
              downloadUrl: model.downloadUrl,
              checksum: model.checksum,
              size: model.size,
            },
          ];
    const primaryArtifact =
      artifacts.find((artifact) => artifact.filename === model.filename) ||
      artifacts[0];
    const downloadPath = path.join(modelDirectory, primaryArtifact.filename);

    const progress: DownloadProgress = {
      modelId,
      progress: 0,
      status: "downloading",
      bytesDownloaded: 0,
      totalBytes: (() => {
        const artifactBytes = artifacts.reduce(
          (sum, artifact) => sum + (artifact.size || 0),
          0,
        );
        return artifactBytes > 0 ? artifactBytes : model.size;
      })(),
      abortController,
    };

    this.state.activeDownloads.set(modelId, progress);
    this.emit("download-progress", modelId, progress);

    try {
      logger.main.info("Starting model download", {
        modelId,
        size: model.sizeFormatted,
        artifacts: artifacts.map((artifact) => artifact.filename),
      });

      let bytesDownloaded = 0;
      let lastProgressEmit = 0;
      const localFiles: string[] = [];

      for (const artifact of artifacts) {
        const artifactPath = path.join(modelDirectory, artifact.filename);

        const response = await fetch(artifact.downloadUrl, {
          signal: abortController.signal,
          headers: {
            "User-Agent": getUserAgent(),
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to download ${artifact.filename}: ${response.status} ${response.statusText}`,
          );
        }

        const artifactBytes =
          parseInt(response.headers.get("content-length") || "0") ||
          artifact.size ||
          0;
        if (!artifact.size && artifactBytes > 0) {
          progress.totalBytes += artifactBytes;
        }

        const fileStream = fs.createWriteStream(artifactPath);
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error(`Failed to read ${artifact.filename}`);
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (abortController.signal.aborted) {
            fileStream.close();
            if (fs.existsSync(artifactPath)) {
              fs.unlinkSync(artifactPath);
            }
            throw new Error("Download cancelled");
          }

          fileStream.write(value);
          bytesDownloaded += value.length;
          progress.bytesDownloaded = bytesDownloaded;
          progress.progress =
            progress.totalBytes > 0
              ? Math.round((bytesDownloaded / progress.totalBytes) * 100)
              : 0;

          const progressPercent = progress.progress;
          if (
            progressPercent - lastProgressEmit >= 1 ||
            bytesDownloaded - (lastProgressEmit * progress.totalBytes) / 100 >=
              1024 * 1024
          ) {
            this.emit("download-progress", modelId, { ...progress });
            lastProgressEmit = progressPercent;
          }
        }

        await new Promise<void>((resolve, reject) => {
          fileStream.end(() => resolve());
          fileStream.on("error", reject);
        });

        if (artifact.checksum) {
          const fileChecksum = await this.calculateFileChecksum(
            artifactPath,
            artifact.checksum,
          );
          if (fileChecksum !== artifact.checksum.toLowerCase()) {
            fs.unlinkSync(artifactPath);
            throw new Error(
              `Checksum mismatch for ${artifact.filename}. Expected: ${artifact.checksum}, Got: ${fileChecksum}`,
            );
          }
        }

        localFiles.push(artifactPath);
      }

      const stats = fs.statSync(downloadPath);
      logger.main.info("Download completed", {
        modelId,
        fileCount: localFiles.length,
        primaryPath: downloadPath,
        actualSize: stats.size,
      });

      // Create/update model record in database with download info
      await upsertModel({
        id: model.id,
        provider: "local-whisper",
        name: model.name,
        type: "speech",
        size: model.sizeFormatted,
        description: model.description,
        checksum: model.checksum,
        speed: model.speed,
        accuracy: model.accuracy,
        localPath: downloadPath,
        sizeBytes: localFiles.reduce((sum, filePath) => {
          try {
            return sum + fs.statSync(filePath).size;
          } catch {
            return sum;
          }
        }, 0),
        downloadedAt: new Date(),
        context: null,
        originalModel: {
          localFiles,
          sourceUrl: model.sourceUrl || null,
        },
      });

      // Get the updated model from database
      const downloadedModel = await getModelsByProvider("local-whisper").then(
        (models) => models.find((m) => m.id === model.id),
      );

      if (!downloadedModel) {
        throw new Error("Failed to retrieve downloaded model from database");
      }

      // Clean up active download
      this.state.activeDownloads.delete(modelId);

      logger.main.info("Model download completed", {
        modelId,
        path: downloadPath,
        size: downloadedModel.sizeBytes,
      });

      // Auto-select if this is the first model
      const allDownloadedModels = await this.getValidDownloadedModels();
      const downloadedModelCount = Object.keys(allDownloadedModels).length;
      const currentSelection =
        await this.settingsService.getDefaultSpeechModel();

      if (downloadedModelCount === 1 && !currentSelection) {
        await this.applySpeechModelSelection(
          modelId,
          "auto-first-download",
          null,
        );
        logger.main.info("Auto-selected first downloaded model", { modelId });
      }

      this.emit("download-complete", modelId, downloadedModel);
    } catch (error) {
      // Clean up on error
      this.state.activeDownloads.delete(modelId);
      const modelDirectory = path.join(this.modelsDirectory, model.id);
      if (fs.existsSync(modelDirectory)) {
        fs.rmSync(modelDirectory, { recursive: true, force: true });
      }

      const err = error instanceof Error ? error : new Error(String(error));

      if (abortController.signal.aborted) {
        logger.main.info("Model download cancelled", { modelId });
        this.emit("download-cancelled", modelId);
        return; // Don't throw - it's an intentional cancellation
      } else {
        logger.main.error("Model download failed", {
          modelId,
          error: err.message,
        });
        this.emit("download-error", modelId, err);
        throw err; // Only throw for actual errors
      }
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
    const models = await getModelsByProvider("local-whisper");
    const downloadedModel = models.find((m) => m.id === modelId);

    if (!downloadedModel) {
      throw new Error(`Model not found: ${modelId}`);
    }

    // Check if this is the selected model BEFORE deletion
    const currentSelection = await this.settingsService.getDefaultSpeechModel();
    const wasSelected = currentSelection === modelId;

    // Delete file
    const localFiles =
      downloadedModel.originalModel &&
      typeof downloadedModel.originalModel === "object" &&
      Array.isArray(
        (downloadedModel.originalModel as { localFiles?: unknown }).localFiles,
      )
        ? (
            downloadedModel.originalModel as {
              localFiles: unknown[];
            }
          ).localFiles.filter(
            (value): value is string => typeof value === "string",
          )
        : downloadedModel.localPath
          ? [downloadedModel.localPath]
          : [];

    for (const localFile of localFiles) {
      if (fs.existsSync(localFile)) {
        fs.unlinkSync(localFile);
        logger.main.info("Deleted model file", {
          modelId,
          path: localFile,
        });
      }
    }

    const modelDirectory = path.join(this.modelsDirectory, modelId);
    if (fs.existsSync(modelDirectory)) {
      fs.rmSync(modelDirectory, { recursive: true, force: true });
    }

    // Remove the model record from database (we only store downloaded models)
    await removeModel(downloadedModel.provider, downloadedModel.id);

    // Handle selection update if needed
    if (wasSelected) {
      // Try to auto-select next best model
      const remainingModels = await this.getValidDownloadedModels();
      const remainingModelIds = Object.keys(remainingModels);
      const candidateId =
        remainingModelIds.length > 0
          ? this.pickPreferredLocalModelId(remainingModelIds)
          : null;

      let autoSelected = false;
      if (candidateId) {
        await this.applySpeechModelSelection(
          candidateId,
          "auto-after-deletion",
          modelId,
        );
        logger.main.info("Auto-selected new model after deletion", {
          oldModel: modelId,
          newModel: candidateId,
        });
        autoSelected = true;
      }

      if (!autoSelected) {
        // No models left, selection cleared
        await this.applySpeechModelSelection(null, "cleared", modelId);
        logger.main.info(
          "No models available for auto-selection after deletion",
        );
      }
    }

    this.emit("model-deleted", modelId);

    // Validate all default models after deletion
    await this.validateAndClearInvalidDefaults();
  }

  // Calculate file checksum (auto-detect algorithm from expected hash length)
  private async calculateFileChecksum(
    filePath: string,
    expectedChecksum?: string,
  ): Promise<string> {
    const algorithm =
      expectedChecksum && expectedChecksum.length === 64 ? "sha256" : "sha1";
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const stream = fs.createReadStream(filePath);

      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex").toLowerCase()));
      stream.on("error", reject);
    });
  }

  // Get models directory path
  getModelsDirectory(): string {
    return this.modelsDirectory;
  }

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
  async getSelectedModel(): Promise<string | null> {
    return (await this.settingsService.getDefaultSpeechModel()) || null;
  }

  private async syncFormatterConfigForSpeechChange(
    oldModelId: string | null,
    newModelId: string | null,
  ): Promise<void> {
    if (oldModelId === newModelId) {
      return;
    }

    const formatterConfig =
      (await this.settingsService.getFormatterConfig()) || { enabled: false };
    const currentModelId = formatterConfig.modelId;
    const fallbackModelId = formatterConfig.fallbackModelId;
    const isCloudSpeechModelId = (modelId: string | null | undefined) =>
      !!AVAILABLE_MODELS.find((m) => m.id === modelId && m.setup === "cloud");
    const movedToCloud = isCloudSpeechModelId(newModelId);
    const movedFromCloud = isCloudSpeechModelId(oldModelId);
    const usingCloudFormatting = currentModelId === "amical-cloud";

    let nextConfig = { ...formatterConfig };
    let updated = false;

    if (movedToCloud && !usingCloudFormatting) {
      if (currentModelId && currentModelId !== "amical-cloud") {
        nextConfig.fallbackModelId = currentModelId;
      } else if (!fallbackModelId) {
        const defaultLanguageModel =
          await this.settingsService.getDefaultLanguageModel();
        if (defaultLanguageModel) {
          nextConfig.fallbackModelId = defaultLanguageModel;
        }
      }

      nextConfig.modelId = "amical-cloud";
      nextConfig.enabled = true;
      updated = true;
    } else if (movedFromCloud && usingCloudFormatting) {
      const fallback =
        fallbackModelId ||
        (await this.settingsService.getDefaultLanguageModel());

      nextConfig.modelId =
        fallback && fallback !== "amical-cloud" ? fallback : undefined;
      updated = true;
    }

    if (updated) {
      await this.settingsService.setFormatterConfig(nextConfig);
    }
  }

  private async applySpeechModelSelection(
    modelId: string | null,
    reason:
      | "manual"
      | "auto-first-download"
      | "auto-after-deletion"
      | "cleared",
    oldModelId?: string | null,
  ): Promise<void> {
    const previousModelId = oldModelId ?? (await this.getSelectedModel());

    if (previousModelId === modelId) {
      return;
    }

    await this.settingsService.setDefaultSpeechModel(modelId || undefined);
    await this.syncFormatterConfigForSpeechChange(previousModelId, modelId);

    this.emit("selection-changed", previousModelId, modelId, reason, "speech");
    logger.main.info("Model selection changed", {
      from: previousModelId,
      to: modelId,
      reason,
    });
  }

  // Set selected model for transcription
  async setSelectedModel(modelId: string | null): Promise<void> {
    const oldModelId = await this.getSelectedModel();

    // If setting to a specific model, validate it exists
    if (modelId) {
      // Check if it's a cloud model
      const availableModel = AVAILABLE_MODELS.find((m) => m.id === modelId);

      if (availableModel?.setup === "cloud") {
        // Cloud model - check authentication
        const authService = AuthService.getInstance();
        const isAuthenticated = await authService.isAuthenticated();

        if (!isAuthenticated) {
          throw new Error("Authentication required for cloud models");
        }

        logger.main.info("Selecting cloud model", { modelId });
      } else {
        // Offline model - must be downloaded
        const downloadedModels = await this.getValidDownloadedModels();
        if (!downloadedModels[modelId]) {
          throw new Error(`Model not downloaded: ${modelId}`);
        }
      }
    }

    await this.applySpeechModelSelection(modelId, "manual", oldModelId);
  }

  // Get best available model path for transcription (used by WhisperProvider)
  async getBestAvailableModelPath(): Promise<string | null> {
    const downloadedModels = await this.getValidDownloadedModels();
    const selectedModelId = await this.getSelectedModel();

    // If a specific model is selected and available, use it
    if (selectedModelId && downloadedModels[selectedModelId]) {
      return downloadedModels[selectedModelId].localPath;
    }

    // Otherwise, find the best available model (prioritize by quality)
    const preferredOrder = [
      "whisper-large-v3-turbo",
      "whisper-large-v3",
      "whisper-medium",
      "whisper-small",
      "whisper-base",
      "whisper-tiny",
    ];

    for (const modelId of preferredOrder) {
      const model = downloadedModels[modelId];
      if (model?.localPath) {
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

  // ============================================
  // Provider Model Methods (OpenRouter, Ollama)
  // ============================================

  /**
   * Validate OpenRouter connection by testing API key
   */
  async validateOpenRouterConnection(
    apiKey: string,
  ): Promise<ValidationResult> {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          (errorData as any)?.error?.message ||
          `HTTP ${response.status}: ${response.statusText}`;
        return {
          success: false,
          error: errorMessage,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  /**
   * Validate Ollama connection by testing if Ollama is running
   */
  async validateOllamaConnection(url: string): Promise<ValidationResult> {
    try {
      const cleanUrl = url.replace(/\/$/, "");
      const versionUrl = `${cleanUrl}/api/version`;

      const response = await fetch(versionUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to connect to Ollama. Make sure Ollama is running.",
      };
    }
  }

  /**
   * Fetch available models from OpenRouter
   */
  async fetchOpenRouterModels(apiKey: string): Promise<FetchedModel[]> {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: OpenRouterResponse = await response.json();

      // Transform OpenRouter models to unified format
      return data.data.map((model: OpenRouterModel): FetchedModel => {
        // Extract model size from name if possible
        const nameParts = model.id.split("/");
        const modelName = nameParts[nameParts.length - 1];
        let size = "Unknown";

        // Try to extract size from model name (e.g., "7b", "13b", "70b")
        const sizeMatch = modelName.match(/(\d+)b/i);
        if (sizeMatch) {
          size = `${sizeMatch[1]}B`;
        }

        // Convert context length to readable format
        const contextLength = model.context_length
          ? `${Math.floor(model.context_length / 1000)}k`
          : "Unknown";

        return {
          id: model.id,
          name: model.name,
          provider: "OpenRouter",
          size,
          context: contextLength,
          description: model.description,
          originalModel: model,
        };
      });
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message
          : "Failed to fetch OpenRouter models",
      );
    }
  }

  /**
   * Fetch available models from Ollama
   */
  async fetchOllamaModels(url: string): Promise<FetchedModel[]> {
    try {
      const cleanUrl = url.replace(/\/$/, "");
      const modelsUrl = `${cleanUrl}/api/tags`;

      const response = await fetch(modelsUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: OllamaResponse = await response.json();

      // Transform Ollama models to unified format
      return data.models.map((model: OllamaModel): FetchedModel => {
        // Extract model size from details or calculate from size
        let size = "Unknown";
        if (model.details?.parameter_size) {
          size = model.details.parameter_size;
        } else if (model.size) {
          const sizeGB = (model.size / (1024 * 1024 * 1024)).toFixed(1);
          size = `${sizeGB}GB`;
        }

        // Extract base model name (remove tags like :latest)
        const baseName = model.name.split(":")[0];
        const displayName =
          baseName.charAt(0).toUpperCase() + baseName.slice(1);

        // Estimate context length (most Ollama models have 4k-32k context)
        const lowerName = model.name.toLowerCase();
        let contextLength = "4k"; // Default
        if (lowerName.includes("32k") || lowerName.includes("32000"))
          contextLength = "32k";
        else if (lowerName.includes("16k") || lowerName.includes("16000"))
          contextLength = "16k";
        else if (lowerName.includes("8k") || lowerName.includes("8000"))
          contextLength = "8k";

        return {
          id: model.name,
          name: displayName,
          provider: "Ollama",
          size,
          context: contextLength,
          description: model.details?.family || undefined,
          originalModel: model,
        };
      });
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message
          : "Failed to fetch Ollama models",
      );
    }
  }

  /**
   * Get all synced provider models from database
   */
  async getSyncedProviderModels(): Promise<DBModel[]> {
    const models = await getAllModels();
    // Filter to only remote provider models (exclude local-whisper)
    return models.filter((m) => m.provider !== "local-whisper");
  }

  /**
   * Get synced models by provider
   */
  async getSyncedModelsByProvider(provider: string): Promise<DBModel[]> {
    const models = await getModelsByProvider(provider);
    return models;
  }

  /**
   * Sync provider models to database (replace all models for a provider)
   */
  async syncProviderModelsToDatabase(
    provider: string,
    models: FetchedModel[],
  ): Promise<void> {
    // Convert to NewModel format
    const newModels: NewModel[] = models.map((m) => ({
      id: m.id!,
      provider: provider,
      name: m.name!,
      type:
        provider === "Ollama" && m.name && m.name.includes("embed")
          ? "embedding"
          : "language",
      size: m.size || null,
      context: m.context || null,
      description: m.description || null,
      originalModel: m.originalModel || null,
      // Remote models don't have local fields
      localPath: null,
      sizeBytes: null,
      checksum: null,
      downloadedAt: null,
      speed: null,
      accuracy: null,
    }));

    await syncModelsForProvider(provider, newModels);

    // Validate default models after sync
    await this.validateAndClearInvalidDefaults();
  }

  /**
   * Remove all models for a provider
   */
  async removeProviderModels(provider: string): Promise<void> {
    await removeModelsForProvider(provider);

    // Validate default models after removal
    await this.validateAndClearInvalidDefaults();
  }

  // ============================================
  // Unified Model Selection Methods
  // ============================================

  /**
   * Get default language model
   */
  async getDefaultLanguageModel(): Promise<string | null> {
    const modelId = await this.settingsService.getDefaultLanguageModel();
    return modelId || null;
  }

  /**
   * Set default language model
   */
  async setDefaultLanguageModel(modelId: string | null): Promise<void> {
    await this.settingsService.setDefaultLanguageModel(modelId || undefined);
  }

  /**
   * Get default embedding model
   */
  async getDefaultEmbeddingModel(): Promise<string | null> {
    const modelId = await this.settingsService.getDefaultEmbeddingModel();
    return modelId || null;
  }

  /**
   * Set default embedding model
   */
  async setDefaultEmbeddingModel(modelId: string | null): Promise<void> {
    await this.settingsService.setDefaultEmbeddingModel(modelId || undefined);
  }

  /**
   * Validate and clear invalid default models
   * Checks if default models still exist in the database
   * Clears any that don't exist and emits selection-changed events
   */
  async validateAndClearInvalidDefaults(): Promise<void> {
    // Check default speech model
    const defaultSpeechModel =
      await this.settingsService.getDefaultSpeechModel();
    if (defaultSpeechModel) {
      const availableModel = AVAILABLE_MODELS.find(
        (m) => m.id === defaultSpeechModel,
      );
      const isAmicalModel = availableModel?.setup === "cloud";
      const existsInDb = await modelExists("local-whisper", defaultSpeechModel);

      // Amical cloud models are always valid; local models must exist in DB
      if (!isAmicalModel && !existsInDb) {
        logger.main.info("Clearing invalid default speech model", {
          modelId: defaultSpeechModel,
        });
        await this.applySpeechModelSelection(
          null,
          "auto-after-deletion",
          defaultSpeechModel,
        );
      }
    }

    // Check default language model
    const defaultLanguageModel =
      await this.settingsService.getDefaultLanguageModel();
    if (defaultLanguageModel) {
      // Check all models to find if this ID exists with any provider
      const allModels = await getAllModels();
      const modelExists = allModels.some(
        (m) => m.id === defaultLanguageModel && m.type === "language",
      );

      if (!modelExists) {
        logger.main.info("Clearing invalid default language model", {
          modelId: defaultLanguageModel,
        });
        await this.settingsService.setDefaultLanguageModel(undefined);
        this.emit(
          "selection-changed",
          defaultLanguageModel,
          null,
          "auto-after-deletion",
          "language",
        );
      }
    }

    // Check default embedding model
    const defaultEmbeddingModel =
      await this.settingsService.getDefaultEmbeddingModel();
    if (defaultEmbeddingModel) {
      // Check all models to find if this ID exists with any provider
      const allModels = await getAllModels();
      const modelExists = allModels.some(
        (m) => m.id === defaultEmbeddingModel && m.type === "embedding",
      );

      if (!modelExists) {
        logger.main.info("Clearing invalid default embedding model", {
          modelId: defaultEmbeddingModel,
        });
        await this.settingsService.setDefaultEmbeddingModel(undefined);
        this.emit(
          "selection-changed",
          defaultEmbeddingModel,
          null,
          "auto-after-deletion",
          "embedding",
        );
      }
    }
  }
}

export { ModelService };
