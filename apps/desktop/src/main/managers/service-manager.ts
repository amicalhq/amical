import { logger } from "../logger";
import { ModelManagerService } from "../../services/model-manager";
import { TranscriptionService } from "../../services/transcription-service";
import { SettingsService } from "../../services/settings-service";
import { SwiftIOBridge } from "../../services/platform/swift-bridge-service";
import { AutoUpdaterService } from "../services/auto-updater";
import { WindowManager } from "../core/window-manager";
import { RecordingService } from "../../services/recording-service";

/**
 * Manages service initialization and lifecycle
 */
export class ServiceManager {
  private static instance: ServiceManager | null = null;
  private isInitialized = false;

  private modelManagerService: ModelManagerService | null = null;
  private transcriptionService: TranscriptionService | null = null;
  private settingsService: SettingsService | null = null;

  private swiftIOBridge: SwiftIOBridge | null = null;
  private autoUpdaterService: AutoUpdaterService | null = null;
  private recordingService: RecordingService | null = null;

  async initialize(windowManager: WindowManager): Promise<void> {
    if (this.isInitialized) {
      logger.main.warn(
        "ServiceManager is already initialized, skipping initialization",
      );
      return;
    }

    try {
      this.initializeSettingsService();
      await this.initializeModelServices();
      this.initializePlatformServices();
      await this.initializeAIServices();
      this.initializeRecordingService();
      this.initializeAutoUpdater(windowManager);

      this.isInitialized = true;
      logger.main.info("Services initialized successfully");
    } catch (error) {
      logger.main.error("Failed to initialize services:", error);
      // Don't throw here - allow app to start even if some services fail
    }
  }

  private initializeSettingsService(): void {
    this.settingsService = new SettingsService();
    logger.main.info("Settings service initialized");
  }

  private async initializeModelServices(): Promise<void> {
    // Initialize Model Manager Service
    this.modelManagerService = new ModelManagerService();
    await this.modelManagerService.initialize();
  }

  private async initializeAIServices(): Promise<void> {
    try {
      if (!this.modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      this.transcriptionService = new TranscriptionService(
        this.modelManagerService,
      );

      // Load and configure formatter
      try {
        if (!this.settingsService) {
          throw new Error("SettingsService not initialized");
        }
        const formatterConfig = await this.settingsService.getFormatterConfig();
        if (formatterConfig) {
          this.transcriptionService.configureFormatter(formatterConfig);
          logger.transcription.info("Formatter configured", {
            provider: formatterConfig.provider,
            enabled: formatterConfig.enabled,
          });
        }
      } catch (formatterError) {
        logger.transcription.warn(
          "Failed to load formatter configuration:",
          formatterError,
        );
      }

      logger.transcription.info("Transcription Service initialized", {
        client: "Pipeline with Whisper",
      });
    } catch (error) {
      logger.transcription.error(
        "Error initializing Transcription Service:",
        error,
      );
      logger.transcription.warn(
        "Transcription will not work until configuration is fixed",
      );
      this.transcriptionService = null;
    }
  }

  private initializePlatformServices(): void {
    // Initialize Swift bridge for macOS integration
    if (process.platform === "darwin") {
      this.swiftIOBridge = new SwiftIOBridge();
    }
  }

  private initializeRecordingService(): void {
    this.recordingService = new RecordingService(this);
    logger.main.info("Recording service initialized");
  }

  private initializeAutoUpdater(windowManager: WindowManager): void {
    this.autoUpdaterService = new AutoUpdaterService(windowManager);
  }

  // Getters for other managers to access services
  getModelManagerService(): ModelManagerService {
    if (!this.isInitialized) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }
    if (!this.modelManagerService) {
      throw new Error("ModelManagerService failed to initialize");
    }
    return this.modelManagerService;
  }

  getTranscriptionService(): TranscriptionService {
    if (!this.isInitialized) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }
    if (!this.transcriptionService) {
      throw new Error("TranscriptionService failed to initialize");
    }
    return this.transcriptionService;
  }

  getSettingsService(): SettingsService {
    if (!this.isInitialized) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }
    if (!this.settingsService) {
      throw new Error("SettingsService failed to initialize");
    }
    return this.settingsService;
  }

  getSwiftIOBridge(): SwiftIOBridge {
    if (!this.isInitialized) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }
    if (!this.swiftIOBridge) {
      throw new Error("SwiftIOBridge not available on this platform");
    }
    return this.swiftIOBridge;
  }

  getAutoUpdaterService(): AutoUpdaterService {
    if (!this.isInitialized) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }
    if (!this.autoUpdaterService) {
      throw new Error("AutoUpdaterService failed to initialize");
    }
    return this.autoUpdaterService;
  }

  async cleanup(): Promise<void> {
    if (this.recordingService) {
      logger.main.info("Cleaning up recording service...");
      await this.recordingService.cleanup();
    }
    if (this.modelManagerService) {
      logger.main.info("Cleaning up model downloads...");
      this.modelManagerService.cleanup();
    }

    if (this.swiftIOBridge) {
      logger.main.info("Stopping Swift helper...");
      this.swiftIOBridge.stopHelper();
    }
  }

  static getInstance(): ServiceManager | null {
    return ServiceManager.instance;
  }

  static createInstance(): ServiceManager {
    if (!ServiceManager.instance) {
      ServiceManager.instance = new ServiceManager();
    }
    return ServiceManager.instance;
  }
}
