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

const LEGACY_PARAKEET_CTC_MODEL_ID = "parakeet-ctc-0.6b-int8";
const PARAKEET_TDT_MODEL_ID = "parakeet-tdt-0.6b-v3-int8";

class ModelService extends EventEmitter {
  private state: ModelManagerState;
  private modelsDirectory: string;
  private settingsService: SettingsService;
  private readonly localSpeechPreference = [
    "whisper-large-v3-turbo",
    PARAKEET_TDT_MODEL_ID,
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
      const whisperModelsData = AVAILABLE_MODELS.filter(
        (model) => model.setup === "offline" && !!model.filename,
      ).map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description,
        size: model.sizeFormatted,
        checksum: model.checksum,
        speed: model.speed,
        accuracy: model.accuracy,
        filename: model.filename,
        artifacts: model.artifacts?.map((artifact) => ({
          filename: artifact.filename,
        })),
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

  // Get only valid downloaded models (all required artifacts exist on disk)
  async getValidDownloadedModels(): Promise<Record<string, DBModel>> {
    const downloadedModels = await this.getDownloadedModels();
    const validModels: Record<string, DBModel> = {};

    for (const model of Object.values(downloadedModels)) {
      if (this.isDownloadedModelValid(model)) {
        validModels[model.id] = model;
      }
    }

    return validModels;
  }

  // Check if a model is downloaded
  async isModelDownloaded(modelId: string): Promise<boolean> {
    const downloadedModels = await this.getValidDownloadedModels();
    return !!downloadedModels[modelId];
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
        let fileStreamError: Error | null = null;
        const onFileStreamError = (error: Error) => {
          fileStreamError = error;
        };
        fileStream.on("error", onFileStreamError);
        const awaitFileStreamClose = async (
          closeAction: () => void,
          preserveOriginalError = false,
        ): Promise<void> => {
          if (fileStream.closed) {
            if (!preserveOriginalError && fileStreamError) {
              throw fileStreamError;
            }
            return;
          }

          let closeError: Error | null = null;
          await new Promise<void>((resolve) => {
            const onClose = () => {
              cleanup();
              resolve();
            };
            const onCloseError = (error: Error) => {
              closeError ??= error;
            };
            const cleanup = () => {
              fileStream.off("close", onClose);
              fileStream.off("error", onCloseError);
            };

            fileStream.once("close", onClose);
            fileStream.on("error", onCloseError);
            closeAction();
          });

          const streamError = closeError ?? fileStreamError;
          if (!preserveOriginalError && streamError) {
            throw streamError;
          }
        };
        const reader = response.body?.getReader();
        if (!reader) {
          await awaitFileStreamClose(() => fileStream.destroy(), true);
          throw new Error(`Failed to read ${artifact.filename}`);
        }

        try {
          while (true) {
            if (fileStreamError) {
              throw fileStreamError;
            }

            const { done, value } = await reader.read();
            if (done) break;

            if (abortController.signal.aborted) {
              await awaitFileStreamClose(() => fileStream.close(), true);
              if (fs.existsSync(artifactPath)) {
                fs.unlinkSync(artifactPath);
              }
              throw new Error("Download cancelled");
            }

            const canContinue = fileStream.write(value);
            if (!canContinue) {
              await new Promise<void>((resolve, reject) => {
                const onDrain = () => {
                  fileStream.off("error", onDrainError);
                  resolve();
                };
                const onDrainError = (error: Error) => {
                  fileStream.off("drain", onDrain);
                  reject(error);
                };

                fileStream.once("drain", onDrain);
                fileStream.once("error", onDrainError);
              });
            }

            if (fileStreamError) {
              throw fileStreamError;
            }

            bytesDownloaded += value.length;
            progress.bytesDownloaded = bytesDownloaded;
            progress.progress =
              progress.totalBytes > 0
                ? Math.round((bytesDownloaded / progress.totalBytes) * 100)
                : 0;

            const progressPercent = progress.progress;
            if (
              progressPercent - lastProgressEmit >= 1 ||
              bytesDownloaded -
                (lastProgressEmit * progress.totalBytes) / 100 >=
                1024 * 1024
            ) {
              this.emit("download-progress", modelId, { ...progress });
              lastProgressEmit = progressPercent;
            }
          }

          await awaitFileStreamClose(() => fileStream.end());
        } catch (error) {
          if (!fileStream.closed && !fileStream.destroyed) {
            await awaitFileStreamClose(() => fileStream.destroy(), true);
          }
          throw error;
        } finally {
          fileStream.off("error", onFileStreamError);
        }

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
      const currentSelection = await this.getSelectedModel();

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
    const currentSelection = await this.getSelectedModel();
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
    await removeModel(
      downloadedModel.providerInstanceId,
      "speech",
      downloadedModel.id,
    );

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
    const selection = await this.settingsService.getDefaultSpeechModel();
    if (!selection) {
      return null;
    }

    const modelId = getSpeechModelIdFromStoredSelection(selection);
    if (!modelId) {
      return null;
    }

    const normalizedModelId =
      await this.normalizeLegacySpeechModelSelection(modelId);
    if (!normalizedModelId) {
      return null;
    }

    const normalizedSelection =
      getSpeechModelSelectionKey(normalizedModelId);
    if (normalizedSelection !== selection) {
      await this.settingsService.setDefaultSpeechModel(normalizedSelection);
    }

    return normalizedModelId;
  }

  private async normalizeLegacySpeechModelSelection(
    modelId: string | null,
  ): Promise<string | null> {
    if (modelId !== LEGACY_PARAKEET_CTC_MODEL_ID) {
      return modelId;
    }

    const downloadedModels = await this.getValidDownloadedModels();
    const fallbackModelIds = Object.keys(downloadedModels).filter(
      (downloadedModelId) => downloadedModelId !== LEGACY_PARAKEET_CTC_MODEL_ID,
    );
    const fallbackModelId = downloadedModels[PARAKEET_TDT_MODEL_ID]
      ? PARAKEET_TDT_MODEL_ID
      : fallbackModelIds.length > 0
        ? this.pickPreferredLocalModelId(fallbackModelIds)
        : null;

    await this.applySpeechModelSelection(
      fallbackModelId,
      fallbackModelId ? "auto-after-deletion" : "cleared",
      modelId,
    );

    logger.main.info("Migrated legacy Parakeet CTC speech selection", {
      from: modelId,
      to: fallbackModelId,
    });

    return fallbackModelId;
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
    if (modelId === LEGACY_PARAKEET_CTC_MODEL_ID) {
      modelId = PARAKEET_TDT_MODEL_ID;
    }

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
    const storedDefaultSpeechModel =
      await this.settingsService.getDefaultSpeechModel();
    if (storedDefaultSpeechModel) {
      const speechModelId =
        getSpeechModelIdFromStoredSelection(storedDefaultSpeechModel);

      if (!speechModelId) {
        await this.applySpeechModelSelection(null, "auto-after-deletion", null);
      } else {
        const normalizedSpeechModelId =
          await this.normalizeLegacySpeechModelSelection(speechModelId);

        if (normalizedSpeechModelId) {
          const normalizedSelection =
            getSpeechModelSelectionKey(normalizedSpeechModelId);
          const availableModel = AVAILABLE_MODELS.find(
            (m) => m.id === normalizedSpeechModelId,
          );
          const isAmicalModel = availableModel?.setup === "cloud";
          const validDownloadedModels = await this.getValidDownloadedModels();
          const existsLocally = !!validDownloadedModels[normalizedSpeechModelId];

          if (normalizedSelection !== storedDefaultSpeechModel) {
            await this.settingsService.setDefaultSpeechModel(normalizedSelection);
          }

          // Amical cloud models are always valid; local models must have a complete bundle.
          if (!isAmicalModel && !existsLocally) {
            logger.main.info("Clearing invalid default speech model", {
              modelId: normalizedSpeechModelId,
            });
            await this.applySpeechModelSelection(
              null,
              "auto-after-deletion",
              normalizedSpeechModelId,
            );
          }
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

  private isDownloadedModelValid(model: DBModel): boolean {
    if (!model.localPath) {
      return false;
    }

    const availableModel = AVAILABLE_MODELS.find(
      (available) => available.id === model.id && available.setup === "offline",
    );
    if (!availableModel) {
      return false;
    }

    const modelDirectory = path.dirname(model.localPath);
    const recordedLocalFiles =
      model.originalModel &&
      typeof model.originalModel === "object" &&
      Array.isArray(
        (model.originalModel as { localFiles?: unknown }).localFiles,
      )
        ? (model.originalModel as { localFiles: unknown[] }).localFiles.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
    const requiredFilenames =
      availableModel.artifacts && availableModel.artifacts.length > 0
        ? availableModel.artifacts.map((artifact) => artifact.filename)
        : [availableModel.filename];

    return requiredFilenames.every((filename) => {
      const recordedMatch = recordedLocalFiles.find(
        (localFile) => path.basename(localFile) === filename,
      );
      const resolvedPath = recordedMatch || path.join(modelDirectory, filename);
      return fs.existsSync(resolvedPath);
    });
  }
}

export { ModelService };
