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
  syncModelsForProviderInstance,
  removeModelsForProviderInstance,
  upsertModel,
} from "../db/models";
import {
  ValidationResult,
  OpenRouterResponse,
  OllamaResponse,
  OpenRouterModel,
  OllamaModel,
  OpenAICompatibleResponse,
  OpenAICompatibleModel,
} from "../types/providers";
import { SettingsService } from "./settings-service";
import { AuthService } from "./auth-service";
import { logger } from "../main/logger";
import { getUserAgent } from "../utils/http-client";
import { type RemoteProvider } from "../constants/remote-providers";
import {
  isOllamaEmbeddingModelName,
  normalizeOllamaUrl,
  normalizeOpenAICompatibleBaseURL,
} from "../utils/provider-utils";
import {
  PROVIDER_TYPES,
  getProviderDisplayName,
  getRemoteProviderType,
  getSystemProviderInstanceId,
} from "../constants/provider-types";
import {
  getSpeechModelIdFromStoredSelection,
  getSpeechModelSelectionKey,
  isAmicalCloudSelectionValue,
  resolveStoredModelSelectionValue,
} from "../utils/model-selection";

// Type for models fetched from external APIs
type FetchedModel = Pick<
  DBModel,
  "id" | "name" | "provider" | "providerType" | "providerInstanceId"
> &
  Partial<DBModel>;

const PROVIDER_REQUEST_TIMEOUT_MS = 10_000;

function getProviderIdentity(provider: RemoteProvider) {
  const providerType = getRemoteProviderType(provider);

  return {
    providerType,
    providerInstanceId: getSystemProviderInstanceId(providerType),
    providerLabel: getProviderDisplayName(providerType),
  };
}

async function extractProviderErrorMessage(
  response: Response,
): Promise<string> {
  try {
    const errorData = await response.json();
    const providerMessage =
      (errorData as any)?.error?.message ||
      (errorData as any)?.error?.type ||
      (errorData as any)?.message;

    if (typeof providerMessage === "string" && providerMessage.length > 0) {
      return providerMessage;
    }
  } catch {
    // Ignore JSON parsing failures and fall back to status-based messages.
  }

  switch (response.status) {
    case 401:
      return "Invalid API key";
    case 403:
      return "Access denied";
    case 429:
      return "Rate limited";
    default:
      return `HTTP ${response.status}: ${response.statusText}`;
  }
}

function formatContextLength(contextLength?: number): string {
  return contextLength ? `${Math.floor(contextLength / 1000)}k` : "Unknown";
}

function isOpenAICompatibleChatModel(model: OpenAICompatibleModel): boolean {
  const id = model.id.toLowerCase();
  const excludedPatterns = [
    "embedding",
    "embed",
    "whisper",
    "moderation",
    "rerank",
    "transcrib",
    "speech",
    "tts",
    "audio",
  ];

  return !excludedPatterns.some((pattern) => id.includes(pattern));
}

function formatProviderRequestError(
  error: unknown,
  fallbackMessage = "Connection failed",
): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "Connection timed out";
  }

  if (error instanceof TypeError) {
    return "Could not reach provider. Check the base URL.";
  }

  return error instanceof Error ? error.message : fallbackMessage;
}

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
      // Sync Whisper models with filesystem
      const whisperModelsData = AVAILABLE_MODELS.map((model) => ({
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
      const savedSelection = await this.getSelectedModel();

      if (savedSelection) {
        // Validate the saved selection is still available
        const availableModel = AVAILABLE_MODELS.find(
          (m) => m.id === savedSelection,
        );

        // Check if it's a cloud model and user is authenticated
        // OpenAI Whisper uses an API key, not Amical Cloud OAuth
        if (
          availableModel?.setup === "cloud" &&
          availableModel?.provider !== "OpenAI"
        ) {
          const authService = AuthService.getInstance();
          const isAuthenticated = await authService.isAuthenticated();

          if (!isAuthenticated) {
            // Cloud model selected but not authenticated - auto-switch to local model
            const downloadedModels = await this.getValidDownloadedModels();
            const downloadedModelIds = Object.keys(downloadedModels);

            if (downloadedModelIds.length > 0) {
              const preferredOrder = [
                "whisper-large-v3-turbo",
                "whisper-large-v3",
                "whisper-medium",
                "whisper-small",
                "whisper-base",
                "whisper-tiny",
              ];

              let newModelId = downloadedModelIds[0];
              for (const candidateId of preferredOrder) {
                if (downloadedModels[candidateId]) {
                  newModelId = candidateId;
                  break;
                }
              }

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
          const preferredOrder = [
            "whisper-large-v3-turbo",
            "whisper-large-v3",
            "whisper-medium",
            "whisper-small",
            "whisper-base",
            "whisper-tiny",
          ];

          for (const candidateId of preferredOrder) {
            if (downloadedModels[candidateId]) {
              await this.applySpeechModelSelection(
                candidateId,
                "auto-first-download",
                null,
              );
              logger.main.info("Auto-selected speech model on initialization", {
                modelId: candidateId,
                availableModels: Object.keys(downloadedModels),
              });
              break;
            }
          }
        }
      }

      // Validate all default models after sync
      await this.validateAndClearInvalidDefaults();
      await this.validateAndNormalizeFormatterConfigSelections();

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

          if (
            availableModel?.setup === "cloud" &&
            availableModel?.provider !== "OpenAI"
          ) {
            // Amical Cloud model selected but user logged out - auto-switch to first downloaded local model
            const downloadedModels = await this.getValidDownloadedModels();
            const downloadedModelIds = Object.keys(downloadedModels);

            if (downloadedModelIds.length > 0) {
              // Find the best local model from preferred order
              const preferredOrder = [
                "whisper-large-v3-turbo",
                "whisper-large-v3",
                "whisper-medium",
                "whisper-small",
                "whisper-base",
                "whisper-tiny",
              ];

              let newModelId = downloadedModelIds[0]; // Fallback to first available
              for (const candidateId of preferredOrder) {
                if (downloadedModels[candidateId]) {
                  newModelId = candidateId;
                  break;
                }
              }

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
        headers: {
          "User-Agent": getUserAgent(),
        },
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

      // Create/update model record in database with download info
      await upsertModel({
        id: model.id,
        providerType: PROVIDER_TYPES.localWhisper,
        providerInstanceId: getSystemProviderInstanceId(
          PROVIDER_TYPES.localWhisper,
        ),
        provider: "local-whisper",
        name: model.name,
        type: "speech",
        size: model.sizeFormatted,
        description: model.description,
        checksum: model.checksum,
        speed: model.speed,
        accuracy: model.accuracy,
        localPath: downloadPath,
        sizeBytes: stats.size,
        downloadedAt: new Date(),
        context: null,
        originalModel: null,
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
        size: stats.size,
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

      if (fs.existsSync(downloadPath)) {
        fs.unlinkSync(downloadPath);
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
    const currentSelection = await this.getSelectedModel();
    const wasSelected = currentSelection === modelId;

    // Delete file
    if (downloadedModel.localPath && fs.existsSync(downloadedModel.localPath)) {
      fs.unlinkSync(downloadedModel.localPath);
      logger.main.info("Deleted model file", {
        modelId,
        path: downloadedModel.localPath,
      });
    }

    // Remove the model record from database (we only store downloaded models)
    await removeModel(
      downloadedModel.providerInstanceId,
      "speech",
      downloadedModel.id,
    );

    // Handle selection update if needed
    if (wasSelected) {
      // Try to auto-select next best model
      const remainingModels = await this.getValidDownloadedModels();
      const preferredOrder = [
        "whisper-large-v3-turbo",
        "whisper-large-v1",
        "whisper-medium",
        "whisper-small",
        "whisper-base",
        "whisper-tiny",
      ];

      let autoSelected = false;
      for (const candidateId of preferredOrder) {
        if (remainingModels[candidateId]) {
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
          break;
        }
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

  // Check if any models are available for transcription
  async isAvailable(): Promise<boolean> {
    // Check if a cloud model is selected (Amical Cloud or OpenAI Whisper)
    const selectedModelId = await this.getSelectedModel();
    if (selectedModelId) {
      const availableModel = AVAILABLE_MODELS.find(
        (m) => m.id === selectedModelId,
      );
      if (availableModel?.setup === "cloud") {
        return true;
      }
    }

    // Otherwise check for downloaded local models
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
    const selection = await this.settingsService.getDefaultSpeechModel();
    if (!selection) {
      return null;
    }

    const modelId = getSpeechModelIdFromStoredSelection(selection);
    if (!modelId) {
      return null;
    }

    const normalizedSelection = getSpeechModelSelectionKey(modelId);
    if (normalizedSelection !== selection) {
      await this.settingsService.setDefaultSpeechModel(normalizedSelection);
    }

    return modelId;
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
    const movedToCloud = newModelId === "amical-cloud";
    const movedFromCloud = oldModelId === "amical-cloud";
    const usingCloudFormatting = isAmicalCloudSelectionValue(currentModelId);

    const nextConfig = { ...formatterConfig };
    let updated = false;

    if (movedToCloud && !usingCloudFormatting) {
      if (currentModelId && !isAmicalCloudSelectionValue(currentModelId)) {
        nextConfig.fallbackModelId = currentModelId;
      } else if (!fallbackModelId) {
        const defaultLanguageModel =
          await this.settingsService.getDefaultLanguageModel();
        if (defaultLanguageModel) {
          nextConfig.fallbackModelId = defaultLanguageModel;
        }
      }

      nextConfig.modelId = getSpeechModelSelectionKey("amical-cloud");
      nextConfig.enabled = true;
      updated = true;
    } else if (movedFromCloud && usingCloudFormatting) {
      const fallback =
        fallbackModelId ||
        (await this.settingsService.getDefaultLanguageModel());

      nextConfig.modelId =
        fallback && !isAmicalCloudSelectionValue(fallback)
          ? fallback
          : undefined;
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

    await this.settingsService.setDefaultSpeechModel(
      modelId ? getSpeechModelSelectionKey(modelId) : undefined,
    );
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

      if (availableModel?.provider === "OpenAI") {
        // OpenAI Whisper - check API key is configured
        const config =
          await this.settingsService.getOpenAIWhisperConfig();
        if (!config?.apiKey) {
          throw new Error("OpenAI API key required");
        }
        logger.main.info("Selecting OpenAI Whisper model", { modelId });
      } else if (availableModel?.setup === "cloud") {
        // Amical Cloud model - check authentication
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
      "whisper-large-v1",
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
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          success: false,
          error: await extractProviderErrorMessage(response),
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: formatProviderRequestError(error),
      };
    }
  }

  /**
   * Validate Ollama connection by testing if Ollama is running
   */
  async validateOllamaConnection(url: string): Promise<ValidationResult> {
    try {
      const cleanUrl = normalizeOllamaUrl(url);
      const versionUrl = `${cleanUrl}/api/version`;

      const response = await fetch(versionUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          success: false,
          error: await extractProviderErrorMessage(response),
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: formatProviderRequestError(
          error,
          "Failed to connect to Ollama. Make sure Ollama is running.",
        ),
      };
    }
  }

  /**
   * Validate OpenAI-compatible connection by testing the configured base URL.
   */
  async validateOpenAICompatibleConnection(
    baseURL: string,
    apiKey: string,
  ): Promise<ValidationResult> {
    const normalizedBaseURL = normalizeOpenAICompatibleBaseURL(baseURL);

    try {
      const response = await fetch(`${normalizedBaseURL}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          success: false,
          error: await extractProviderErrorMessage(response),
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: formatProviderRequestError(error),
      };
    }
  }

  /**
   * Validate OpenAI Whisper connection by checking the API key
   * against the OpenAI models endpoint and verifying whisper-1 is available
   */
  async validateOpenAIWhisperConnection(
    apiKey: string,
  ): Promise<ValidationResult> {
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          success: false,
          error: await extractProviderErrorMessage(response),
        };
      }

      // Verify whisper-1 model is accessible
      const data = await response.json();
      const models = data?.data;
      if (Array.isArray(models)) {
        const hasWhisper = models.some(
          (m: { id?: string }) => m.id === "whisper-1",
        );
        if (!hasWhisper) {
          return {
            success: false,
            error:
              "API key is valid but whisper-1 model is not accessible. Please check your API permissions.",
          };
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: formatProviderRequestError(error),
      };
    }
  }

  /**
   * Fetch available models from OpenRouter
   */
  async fetchOpenRouterModels(apiKey: string): Promise<FetchedModel[]> {
    try {
      const identity = getProviderIdentity("OpenRouter");
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(await extractProviderErrorMessage(response));
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
        const contextLength = formatContextLength(model.context_length);

        return {
          id: model.id,
          name: model.name,
          providerType: identity.providerType,
          providerInstanceId: identity.providerInstanceId,
          provider: identity.providerLabel,
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
      const identity = getProviderIdentity("Ollama");
      const cleanUrl = normalizeOllamaUrl(url);
      const modelsUrl = `${cleanUrl}/api/tags`;

      const response = await fetch(modelsUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(await extractProviderErrorMessage(response));
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
          providerType: identity.providerType,
          providerInstanceId: identity.providerInstanceId,
          provider: identity.providerLabel,
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
   * Fetch available models from an OpenAI-compatible endpoint.
   */
  async fetchOpenAICompatibleModels(
    baseURL: string,
    apiKey: string,
  ): Promise<FetchedModel[]> {
    const normalizedBaseURL = normalizeOpenAICompatibleBaseURL(baseURL);
    const identity = getProviderIdentity("OpenAI Compatible");

    try {
      const response = await fetch(`${normalizedBaseURL}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(await extractProviderErrorMessage(response));
      }

      const data: OpenAICompatibleResponse = await response.json();

      return data.data.filter(isOpenAICompatibleChatModel).map(
        (model: OpenAICompatibleModel): FetchedModel => ({
          id: model.id,
          name: model.id,
          providerType: identity.providerType,
          providerInstanceId: identity.providerInstanceId,
          provider: identity.providerLabel,
          size: "Unknown",
          context: formatContextLength(
            model.context_length ?? model.context_window,
          ),
          description:
            typeof model.description === "string"
              ? model.description
              : undefined,
          originalModel: model,
        }),
      );
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message
          : "Failed to fetch OpenAI-compatible models",
      );
    }
  }

  /**
   * Get all synced provider models from database
   */
  async getSyncedProviderModels(): Promise<DBModel[]> {
    const models = await getAllModels();
    return models.filter((m) => m.providerType !== PROVIDER_TYPES.localWhisper);
  }

  /**
   * Get synced models by provider
   */
  async getSyncedModelsByProvider(providerType: string): Promise<DBModel[]> {
    const models = await getModelsByProvider(providerType);
    return models;
  }

  /**
   * Sync provider models to database (replace all models for a provider)
   */
  async syncProviderModelsToDatabase(
    provider: RemoteProvider,
    models: FetchedModel[],
  ): Promise<void> {
    await this.normalizeLegacyStoredSelections();

    const providerType = getRemoteProviderType(provider);
    const providerInstanceId = getSystemProviderInstanceId(providerType);
    const providerLabel = getProviderDisplayName(providerType);
    const syncedModels =
      providerType === PROVIDER_TYPES.openAICompatible
        ? models.filter((model) =>
            isOpenAICompatibleChatModel({ id: model.id ?? "" }),
          )
        : models;

    // Convert to NewModel format
    const newModels: NewModel[] = syncedModels.map((m) => ({
      id: m.id!,
      providerType,
      providerInstanceId,
      provider: providerLabel,
      name: m.name!,
      type:
        providerType === PROVIDER_TYPES.ollama &&
        m.name &&
        isOllamaEmbeddingModelName(m.name)
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

    await syncModelsForProviderInstance(providerInstanceId, newModels);

    // Validate default models after sync
    await this.validateAndClearInvalidDefaults();
    await this.validateAndNormalizeFormatterConfigSelections();
  }

  /**
   * Remove all models for a provider
   */
  async removeProviderModels(provider: RemoteProvider): Promise<void> {
    const providerType = getRemoteProviderType(provider);
    const providerInstanceId = getSystemProviderInstanceId(providerType);

    await removeModelsForProviderInstance(providerInstanceId);

    // Validate default models after removal
    await this.validateAndClearInvalidDefaults();
    await this.validateAndNormalizeFormatterConfigSelections();
  }

  // ============================================
  // Unified Model Selection Methods
  // ============================================

  /**
   * Get default language model
   */
  async getDefaultLanguageModel(): Promise<string | null> {
    const modelSelection = await this.settingsService.getDefaultLanguageModel();
    if (!modelSelection) {
      return null;
    }

    const languageModels = (await getAllModels()).filter(
      (model) => model.type === "language",
    );
    const normalizedSelection = resolveStoredModelSelectionValue(
      languageModels,
      modelSelection,
      "language",
    );

    if (!normalizedSelection) {
      return null;
    }

    if (normalizedSelection !== modelSelection) {
      await this.settingsService.setDefaultLanguageModel(normalizedSelection);
    }

    return normalizedSelection;
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
    const modelSelection =
      await this.settingsService.getDefaultEmbeddingModel();
    if (!modelSelection) {
      return null;
    }

    const embeddingModels = (await getAllModels()).filter(
      (model) => model.type === "embedding",
    );
    const normalizedSelection = resolveStoredModelSelectionValue(
      embeddingModels,
      modelSelection,
      "embedding",
    );

    if (!normalizedSelection) {
      return null;
    }

    if (normalizedSelection !== modelSelection) {
      await this.settingsService.setDefaultEmbeddingModel(normalizedSelection);
    }

    return normalizedSelection;
  }

  /**
   * Set default embedding model
   */
  async setDefaultEmbeddingModel(modelId: string | null): Promise<void> {
    await this.settingsService.setDefaultEmbeddingModel(modelId || undefined);
  }

  private async normalizeLegacyStoredSelections(): Promise<void> {
    const allModels = await getAllModels();
    const languageModels = allModels.filter(
      (model) => model.type === "language",
    );
    const embeddingModels = allModels.filter(
      (model) => model.type === "embedding",
    );

    const defaultSpeechModel =
      await this.settingsService.getDefaultSpeechModel();
    if (defaultSpeechModel) {
      const speechModelId =
        getSpeechModelIdFromStoredSelection(defaultSpeechModel);
      if (speechModelId) {
        const normalizedSelection = getSpeechModelSelectionKey(speechModelId);
        if (normalizedSelection !== defaultSpeechModel) {
          await this.settingsService.setDefaultSpeechModel(normalizedSelection);
        }
      }
    }

    const defaultLanguageModel =
      await this.settingsService.getDefaultLanguageModel();
    if (defaultLanguageModel) {
      const normalizedSelection = resolveStoredModelSelectionValue(
        languageModels,
        defaultLanguageModel,
        "language",
      );
      if (normalizedSelection && normalizedSelection !== defaultLanguageModel) {
        await this.settingsService.setDefaultLanguageModel(normalizedSelection);
      }
    }

    const defaultEmbeddingModel =
      await this.settingsService.getDefaultEmbeddingModel();
    if (defaultEmbeddingModel) {
      const normalizedSelection = resolveStoredModelSelectionValue(
        embeddingModels,
        defaultEmbeddingModel,
        "embedding",
      );
      if (
        normalizedSelection &&
        normalizedSelection !== defaultEmbeddingModel
      ) {
        await this.settingsService.setDefaultEmbeddingModel(
          normalizedSelection,
        );
      }
    }

    await this.normalizeFormatterConfigSelections(languageModels, {
      preserveUnresolvedSelections: true,
    });
  }

  private async validateAndNormalizeFormatterConfigSelections(): Promise<void> {
    const languageModels = (await getAllModels()).filter(
      (model) => model.type === "language",
    );
    await this.normalizeFormatterConfigSelections(languageModels);
  }

  private async normalizeFormatterConfigSelections(
    languageModels: DBModel[],
    options?: {
      preserveUnresolvedSelections?: boolean;
    },
  ): Promise<void> {
    const formatterConfig = await this.settingsService.getFormatterConfig();
    if (!formatterConfig) {
      return;
    }

    const normalizeSelection = (
      value: string | undefined,
    ): string | undefined => {
      if (!value) {
        return undefined;
      }

      if (isAmicalCloudSelectionValue(value)) {
        return getSpeechModelSelectionKey("amical-cloud");
      }

      const normalizedSelection = resolveStoredModelSelectionValue(
        languageModels,
        value,
        "language",
      );

      if (
        normalizedSelection === undefined &&
        options?.preserveUnresolvedSelections
      ) {
        return value;
      }

      return normalizedSelection;
    };

    const normalizedModelId = normalizeSelection(formatterConfig.modelId);
    const normalizedFallbackModelId = normalizeSelection(
      formatterConfig.fallbackModelId,
    );

    if (
      normalizedModelId === formatterConfig.modelId &&
      normalizedFallbackModelId === formatterConfig.fallbackModelId
    ) {
      return;
    }

    await this.settingsService.setFormatterConfig({
      ...formatterConfig,
      modelId: normalizedModelId,
      fallbackModelId: normalizedFallbackModelId,
    });
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
      const speechModelId =
        getSpeechModelIdFromStoredSelection(defaultSpeechModel);

      if (!speechModelId) {
        await this.applySpeechModelSelection(null, "auto-after-deletion", null);
      } else {
        const normalizedSelection = getSpeechModelSelectionKey(speechModelId);
        const availableModel = AVAILABLE_MODELS.find(
          (m) => m.id === speechModelId,
        );
        const isAmicalModel = availableModel?.provider === "Amical Cloud";
        const isOpenAIModel = availableModel?.provider === "OpenAI";
        const isCloudModel = isAmicalModel || isOpenAIModel;
        const existsInDb = await modelExists(
          getSystemProviderInstanceId(PROVIDER_TYPES.localWhisper),
          "speech",
          speechModelId,
        );

        if (normalizedSelection !== defaultSpeechModel) {
          await this.settingsService.setDefaultSpeechModel(normalizedSelection);
        }

        // Cloud models (Amical Cloud, OpenAI Whisper) are always valid; local models must exist in DB
        if (!isCloudModel && !existsInDb) {
          logger.main.info("Clearing invalid default speech model", {
            modelId: speechModelId,
          });
          await this.applySpeechModelSelection(
            null,
            "auto-after-deletion",
            speechModelId,
          );
        }
      }
    }

    // Check default language model
    const defaultLanguageModel =
      await this.settingsService.getDefaultLanguageModel();
    if (defaultLanguageModel) {
      const allModels = (await getAllModels()).filter(
        (model) => model.type === "language",
      );
      const normalizedSelection = resolveStoredModelSelectionValue(
        allModels,
        defaultLanguageModel,
        "language",
      );

      if (!normalizedSelection) {
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
      } else if (normalizedSelection !== defaultLanguageModel) {
        await this.settingsService.setDefaultLanguageModel(normalizedSelection);
      }
    }

    // Check default embedding model
    const defaultEmbeddingModel =
      await this.settingsService.getDefaultEmbeddingModel();
    if (defaultEmbeddingModel) {
      const allModels = (await getAllModels()).filter(
        (model) => model.type === "embedding",
      );
      const normalizedSelection = resolveStoredModelSelectionValue(
        allModels,
        defaultEmbeddingModel,
        "embedding",
      );

      if (!normalizedSelection) {
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
      } else if (normalizedSelection !== defaultEmbeddingModel) {
        await this.settingsService.setDefaultEmbeddingModel(
          normalizedSelection,
        );
      }
    }
  }
}

export { ModelService };
