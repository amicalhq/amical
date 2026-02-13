import { logger } from "../logger";
import { ModelService } from "../../services/model-service";
import { TranscriptionService } from "../../services/transcription-service";
import { SettingsService } from "../../services/settings-service";
import { NativeBridge } from "../../services/platform/native-bridge-service";
import { AutoUpdaterService } from "../services/auto-updater";
import { RecordingManager } from "./recording-manager";
import { VADService } from "../../services/vad-service";
import { ShortcutManager } from "./shortcut-manager";
import { WindowManager } from "../core/window-manager";
import { isMacOS, isWindows } from "../../utils/platform";
import { TelemetryService } from "../../services/telemetry-service";
import { AuthService } from "../../services/auth-service";
import { OnboardingService } from "../../services/onboarding-service";

/**
 * Service map for type-safe service access
 */
export interface ServiceMap {
  telemetryService: TelemetryService;
  modelService: ModelService;
  transcriptionService: TranscriptionService;
  settingsService: SettingsService;
  authService: AuthService;
  vadService: VADService;
  nativeBridge: NativeBridge;
  autoUpdaterService: AutoUpdaterService;
  recordingManager: RecordingManager;
  shortcutManager: ShortcutManager;
  windowManager: WindowManager;
  onboardingService: OnboardingService;
}

/**
 * Manages service initialization and lifecycle
 */
export class ServiceManager {
  private static instance: ServiceManager | null = null;
  private isInitialized = false;

  private telemetryService: TelemetryService | null = null;
  private modelService: ModelService | null = null;
  private transcriptionService: TranscriptionService | null = null;
  private settingsService: SettingsService | null = null;
  private authService: AuthService | null = null;
  private vadService: VADService | null = null;
  private onboardingService: OnboardingService | null = null;

  private nativeBridge: NativeBridge | null = null;
  private autoUpdaterService: AutoUpdaterService | null = null;
  private recordingManager: RecordingManager | null = null;
  private shortcutManager: ShortcutManager | null = null;
  private windowManager: WindowManager | null = null;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.main.warn(
        "ServiceManager is already initialized, skipping initialization",
      );
      return;
    }

    this.initializeSettingsService();
    this.initializeAuthService();
    await this.initializeTelemetryService();
    await this.initializeModelServices();
    await this.initializeOnboardingService();
    this.initializePlatformServices();
    await this.initializeVADService();
    await this.initializeAIServices();
    this.initializeRecordingManager();
    await this.initializeShortcutManager();
    await this.initializeAutoUpdater();

    this.isInitialized = true;
    logger.main.info("Services initialized successfully");
  }

  private async initializeTelemetryService(): Promise<void> {
    this.telemetryService = new TelemetryService(this.settingsService!);
    // Pass settings service if available for checking user preferences
    await this.telemetryService.initialize();
    logger.main.info("Telemetry service initialized");
  }

  private initializeSettingsService(): void {
    this.settingsService = new SettingsService();
    logger.main.info("Settings service initialized");
  }

  private initializeAuthService(): void {
    this.authService = AuthService.getInstance();
    logger.main.info("Auth service initialized");
  }

  private async initializeOnboardingService(): Promise<void> {
    if (!this.settingsService || !this.telemetryService || !this.modelService) {
      logger.main.warn(
        "Settings, telemetry, or model service not available for onboarding",
      );
      return;
    }

    this.onboardingService = OnboardingService.getInstance(
      this.settingsService,
      this.telemetryService,
      this.modelService,
    );
    logger.main.info("Onboarding service initialized");
  }

  private async initializeModelServices(): Promise<void> {
    // Initialize Model Manager Service
    if (!this.settingsService) {
      throw new Error("Settings service not initialized");
    }
    this.modelService = new ModelService(this.settingsService);
    await this.modelService.initialize();
  }

  private async initializeVADService(): Promise<void> {
    try {
      this.vadService = new VADService();
      await this.vadService.initialize();
      logger.main.info("VAD service initialized");
    } catch (error) {
      this.telemetryService?.captureException(error, {
        source: "service_manager",
        stage: "initialize_vad_service",
      });
      logger.main.error("Failed to initialize VAD service:", error);
      // Don't throw - VAD is not critical for basic functionality
    }
  }

  private async initializeAIServices(): Promise<void> {
    try {
      if (!this.modelService) {
        throw new Error("Model manager service not initialized");
      }

      if (!this.settingsService) {
        throw new Error("Settings service not initialized");
      }

      this.transcriptionService = new TranscriptionService(
        this.modelService,
        this.vadService!,
        this.settingsService,
        this.telemetryService!,
        this.nativeBridge,
        this.onboardingService,
      );
      await this.transcriptionService.initialize();

      logger.transcription.info("Transcription Service initialized", {
        client: "Pipeline with Whisper",
      });
    } catch (error) {
      this.telemetryService?.captureException(error, {
        source: "service_manager",
        stage: "initialize_ai_services",
      });
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
      this.nativeBridge = new NativeBridge(this.telemetryService ?? undefined);
    }
  }

  private initializeRecordingManager(): void {
    this.recordingManager = new RecordingManager(this);
    logger.main.info("Recording manager initialized");
  }

  private async initializeShortcutManager(): Promise<void> {
    if (!this.settingsService || !this.nativeBridge || !this.recordingManager) {
      throw new Error(
        "SettingsService, NativeBridge and RecordingManager must be initialized first",
      );
    }
    this.shortcutManager = new ShortcutManager(
      this.settingsService,
      this.nativeBridge,
    );
    await this.shortcutManager.initialize();

    // Connect shortcut events to recording manager
    this.recordingManager.setupShortcutListeners(this.shortcutManager);

    logger.main.info("Shortcut manager initialized");
  }

  private async initializeAutoUpdater(): Promise<void> {
    if (!this.settingsService) {
      throw new Error("Settings service not initialized");
    }

    this.autoUpdaterService = new AutoUpdaterService(this.settingsService);
    await this.autoUpdaterService.initialize();
    logger.main.info("Auto updater service initialized");
  }

  getLogger() {
    return logger;
  }

  getService<K extends keyof ServiceMap>(serviceName: K): ServiceMap[K] {
    if (!this.isInitialized) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }

    const services: ServiceMap = {
      telemetryService: this.telemetryService!,
      modelService: this.modelService!,
      transcriptionService: this.transcriptionService!,
      settingsService: this.settingsService!,
      authService: this.authService!,
      vadService: this.vadService!,
      nativeBridge: this.nativeBridge!,
      autoUpdaterService: this.autoUpdaterService!,
      recordingManager: this.recordingManager!,
      shortcutManager: this.shortcutManager!,
      windowManager: this.windowManager!,
      onboardingService: this.onboardingService!,
    };

    return services[serviceName];
  }

  async cleanup(): Promise<void> {
    if (this.shortcutManager) {
      logger.main.info("Cleaning up shortcut manager...");
      this.shortcutManager.cleanup();
    }
    if (this.autoUpdaterService) {
      logger.main.info("Cleaning up auto updater service...");
      this.autoUpdaterService.cleanup();
    }
    if (this.recordingManager) {
      logger.main.info("Cleaning up recording manager...");
      await this.recordingManager.cleanup();
    }
    if (this.modelService) {
      logger.main.info("Cleaning up model downloads...");
      this.modelService.cleanup();
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

  getOnboardingService(): OnboardingService | null {
    return this.onboardingService;
  }

  getSettingsService(): SettingsService | null {
    return this.settingsService;
  }

  getTelemetryService(): TelemetryService | null {
    return this.telemetryService;
  }

  static getInstance(): ServiceManager {
    if (!ServiceManager.instance) {
      ServiceManager.instance = new ServiceManager();
    }
    return ServiceManager.instance;
  }

  /**
   * Create and set a new singleton instance.
   * Primarily used by tests to ensure a clean service graph per run.
   */
  static async createInstance(): Promise<ServiceManager> {
    if (ServiceManager.instance) {
      await ServiceManager.instance.cleanup();
    }
    ServiceManager.instance = new ServiceManager();
    return ServiceManager.instance;
  }

  setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager;
    logger.main.info("Window manager registered with ServiceManager");
  }
}
