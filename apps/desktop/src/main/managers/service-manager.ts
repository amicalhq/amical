import { logger } from "../logger";
import { ModelManagerService } from "../../services/model-manager";
import { TranscriptionService } from "../../services/transcription-service";
import { SettingsService } from "../../services/settings-service";
import { NativeBridge } from "../../services/platform/native-bridge-service";
import { AutoUpdaterService } from "../services/auto-updater";
import { RecordingManager } from "./recording-manager";
import { VADService } from "../../services/vad-service";
import { ShortcutManager } from "../services/shortcut-manager";
import { WindowManager } from "../core/window-manager";
import { createIPCHandler } from "electron-trpc-experimental/main";
import { router } from "../../trpc/router";
import { createContext } from "../../trpc/context";
import { isMacOS, isWindows } from "../../utils/platform";
import { TelemetryService } from "../../services/telemetry-service";

/**
 * Service map for type-safe service access
 */
export interface ServiceMap {
  telemetryService: TelemetryService;
  modelManagerService: ModelManagerService;
  transcriptionService: TranscriptionService;
  settingsService: SettingsService;
  vadService: VADService;
  nativeBridge: NativeBridge;
  autoUpdaterService: AutoUpdaterService;
  recordingManager: RecordingManager;
  shortcutManager: ShortcutManager;
  windowManager: WindowManager;
}

/**
 * Manages service initialization and lifecycle
 */
export class ServiceManager {
  private static instance: ServiceManager | null = null;
  private isInitialized = false;

  private telemetryService: TelemetryService | null = null;
  private modelManagerService: ModelManagerService | null = null;
  private transcriptionService: TranscriptionService | null = null;
  private settingsService: SettingsService | null = null;
  private vadService: VADService | null = null;

  private nativeBridge: NativeBridge | null = null;
  private autoUpdaterService: AutoUpdaterService | null = null;
  private recordingManager: RecordingManager | null = null;
  private shortcutManager: ShortcutManager | null = null;
  private windowManager: WindowManager | null = null;
  private trpcHandler: ReturnType<typeof createIPCHandler> | null = null;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.main.warn(
        "ServiceManager is already initialized, skipping initialization",
      );
      return;
    }

    try {
      await this.initializeTelemetryService();
      this.initializeSettingsService();
      await this.initializeModelServices();
      this.initializePlatformServices();
      await this.initializeVADService();
      await this.initializeAIServices();
      this.initializeRecordingManager();
      await this.initializeShortcutManager();
      this.initializeAutoUpdater();
      this.initializeTRPCHandler();

      this.isInitialized = true;
      logger.main.info("Services initialized successfully");
    } catch (error) {
      logger.main.error("Failed to initialize services:", error);
      // Don't throw here - allow app to start even if some services fail
    }
  }

  private async initializeTelemetryService(): Promise<void> {
    this.telemetryService = new TelemetryService();
    await this.telemetryService.initialize();
    logger.main.info("Telemetry service initialized");
  }

  private initializeSettingsService(): void {
    this.settingsService = new SettingsService();
    logger.main.info("Settings service initialized");
  }

  private async initializeModelServices(): Promise<void> {
    // Initialize Model Manager Service
    if (!this.settingsService) {
      throw new Error("Settings service not initialized");
    }
    this.modelManagerService = new ModelManagerService(this.settingsService);
    await this.modelManagerService.initialize();
  }

  private async initializeVADService(): Promise<void> {
    try {
      this.vadService = new VADService();
      await this.vadService.initialize();
      logger.main.info("VAD service initialized");
    } catch (error) {
      logger.main.error("Failed to initialize VAD service:", error);
      // Don't throw - VAD is not critical for basic functionality
    }
  }

  private async initializeAIServices(): Promise<void> {
    try {
      if (!this.modelManagerService) {
        throw new Error("Model manager service not initialized");
      }

      if (!this.settingsService) {
        throw new Error("Settings service not initialized");
      }

      this.transcriptionService = new TranscriptionService(
        this.modelManagerService,
        this.vadService,
        this.settingsService,
        this.telemetryService,
      );
      await this.transcriptionService.initialize();

      // Load and configure formatter
      try {
        const formatterConfig = await this.settingsService.getFormatterConfig();
        if (formatterConfig) {
          this.transcriptionService.configureFormatter(formatterConfig);
          logger.transcription.info("Formatter configured", {
            model: formatterConfig.model,
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
    // Initialize platform-specific bridge
    if (isMacOS() || isWindows()) {
      this.nativeBridge = new NativeBridge();
    }
  }

  private initializeRecordingManager(): void {
    this.recordingManager = new RecordingManager(this);
    logger.main.info("Recording manager initialized");
  }

  private async initializeShortcutManager(): Promise<void> {
    if (!this.recordingManager || !this.settingsService) {
      throw new Error(
        "RecordingManager and SettingsService must be initialized first",
      );
    }
    this.shortcutManager = new ShortcutManager(this.settingsService);
    await this.shortcutManager.initialize(this.nativeBridge);

    // Connect shortcut events to recording manager
    this.recordingManager.setupShortcutListeners(this.shortcutManager);

    logger.main.info("Shortcut manager initialized");
  }

  private initializeAutoUpdater(): void {
    this.autoUpdaterService = new AutoUpdaterService();
  }

  private initializeTRPCHandler(): void {
    // Initialize with empty windows array, windows will be added later
    this.trpcHandler = createIPCHandler({
      router,
      windows: [],
      createContext: async () => createContext(this),
    });
    logger.main.info("tRPC handler initialized");
  }

  getTRPCHandler(): ReturnType<typeof createIPCHandler> | null {
    if (!this.isInitialized) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }
    if (!this.trpcHandler) {
      throw new Error("TRPCHandler failed to initialize");
    }
    return this.trpcHandler;
  }

  getLogger() {
    return logger;
  }

  getService<K extends keyof ServiceMap>(serviceName: K): ServiceMap[K] | null {
    if (!this.isInitialized) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }

    const services: Partial<ServiceMap> = {
      telemetryService: this.telemetryService ?? undefined,
      modelManagerService: this.modelManagerService ?? undefined,
      transcriptionService: this.transcriptionService ?? undefined,
      settingsService: this.settingsService ?? undefined,
      vadService: this.vadService ?? undefined,
      nativeBridge: this.nativeBridge ?? undefined,
      autoUpdaterService: this.autoUpdaterService ?? undefined,
      recordingManager: this.recordingManager ?? undefined,
      shortcutManager: this.shortcutManager ?? undefined,
      windowManager: this.windowManager ?? undefined,
    };

    return services[serviceName] ?? null;
  }

  async cleanup(): Promise<void> {
    if (this.shortcutManager) {
      logger.main.info("Cleaning up shortcut manager...");
      this.shortcutManager.cleanup();
    }
    if (this.recordingManager) {
      logger.main.info("Cleaning up recording manager...");
      await this.recordingManager.cleanup();
    }
    if (this.modelManagerService) {
      logger.main.info("Cleaning up model downloads...");
      this.modelManagerService.cleanup();
    }

    if (this.vadService) {
      logger.main.info("Cleaning up VAD service...");
      await this.vadService.dispose();
    }

    if (this.nativeBridge) {
      logger.main.info("Stopping native helper...");
      this.nativeBridge.stopHelper();
    }

    if (this.telemetryService) {
      logger.main.info("Shutting down telemetry service...");
      await this.telemetryService.shutdown();
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

  setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager;
    logger.main.info("Window manager registered with ServiceManager");
  }
}
