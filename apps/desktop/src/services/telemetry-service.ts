import { PostHog } from "posthog-node";
import { machineId } from "node-machine-id";
import * as si from "systeminformation";
import { app } from "electron";
import { logger } from "../main/logger";
import type { SettingsService } from "./settings-service";

export interface TranscriptionMetrics {
  session_id?: string;
  model_id: string;
  model_preloaded?: boolean;
  whisper_native_binding?: string;
  total_duration_ms?: number;
  recording_duration_ms?: number;
  processing_duration_ms?: number;
  audio_duration_seconds?: number;
  realtime_factor?: number;
  text_length?: number;
  word_count?: number;
  formatting_enabled?: boolean;
  formatting_model?: string;
  formatting_duration_ms?: number;
  vad_enabled?: boolean;
  session_type?: "streaming" | "batch";
  language?: string;
  vocabulary_size?: number;
}

export interface SystemInfo {
  // Hardware
  cpu_model: string;
  cpu_cores: number;
  cpu_threads: number;
  cpu_speed_ghz: number;
  memory_total_gb: number;

  // OS
  os_platform: string;
  os_distro: string;
  os_release: string;
  os_arch: string;

  // Graphics
  gpu_model: string;
  gpu_vendor: string;

  // System
  manufacturer: string;
  model: string;
}

export class TelemetryService {
  private posthog: PostHog | null = null;
  private machineId: string = "";
  private systemInfo: SystemInfo | null = null;
  private enabled: boolean = false;
  private initialized: boolean = false;
  private persistedProperties: Record<string, unknown> = {};
  private settingsService: SettingsService;

  constructor(settingsService: SettingsService) {
    this.settingsService = settingsService;
    // Initialize PostHog
    const host = process.env.POSTHOG_HOST || __BUNDLED_POSTHOG_HOST;
    // Check runtime env first, then fall back to bundled values
    const apiKey = process.env.POSTHOG_API_KEY || __BUNDLED_POSTHOG_API_KEY;

    const telemetryEnabled = process.env.TELEMETRY_ENABLED
      ? process.env.TELEMETRY_ENABLED !== "false"
      : __BUNDLED_TELEMETRY_ENABLED;

    if (!host || !apiKey || !telemetryEnabled) {
      logger.main.info(
        "Telemetry disabled since either api key or host has not been provided",
      );
      return;
    }

    this.posthog = new PostHog(apiKey, {
      host,
      flushAt: 1,
      flushInterval: 10000,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized || !this.posthog) {
      return;
    }

    // Sync opt-out state with database settings
    const telemetrySettings = await this.settingsService.getTelemetrySettings();
    if (telemetrySettings?.enabled === false) {
      await this.posthog.optOut();
      logger.main.debug("Opted out of telemetry");
    } else {
      await this.posthog.optIn();
      logger.main.debug("Opted into telemetry");
    }

    // Get unique machine ID
    this.machineId = await machineId();
    logger.main.info("Machine ID generated for telemetry");

    // Collect system information
    this.systemInfo = await this.collectSystemInfo();
    logger.main.info("System information collected for telemetry");

    // ! posthog-node code flow doesn't use register to set super properties
    // ! Track them manually
    this.persistedProperties = {
      app_version: app.getVersion(),
      machine_id: this.machineId,
      app_is_packaged: app.isPackaged,
      system_info: {
        ...this.systemInfo,
      },
    };

    // Identify the machine with system properties
    this.posthog.identify({
      distinctId: this.machineId,
      properties: {
        ...this.persistedProperties,
      },
    });
    this.enabled = true;
    this.initialized = true;
    logger.main.info("Telemetry service initialized successfully");
  }

  private async collectSystemInfo(): Promise<SystemInfo> {
    try {
      const [cpu, mem, osInfo, graphics, system] = await Promise.all([
        si.cpu(),
        si.mem(),
        si.osInfo(),
        si.graphics(),
        si.system(),
      ]);

      return {
        // Hardware
        cpu_model: `${cpu.manufacturer} ${cpu.brand}`.trim(),
        cpu_cores: cpu.physicalCores,
        cpu_threads: cpu.cores,
        cpu_speed_ghz: cpu.speed,
        memory_total_gb: Math.round(mem.total / 1073741824),

        // OS
        os_platform: osInfo.platform,
        os_distro: osInfo.distro,
        os_release: osInfo.release,
        os_arch: osInfo.arch,

        // Graphics
        gpu_model: graphics.controllers[0]?.model || "Unknown",
        gpu_vendor: graphics.controllers[0]?.vendor || "Unknown",

        // System
        manufacturer: system.manufacturer || "Unknown",
        model: system.model || "Unknown",
      };
    } catch (error) {
      logger.main.error("Failed to collect system info:", error);
      // Return minimal info on error
      return {
        cpu_model: "Unknown",
        cpu_cores: 0,
        cpu_threads: 0,
        cpu_speed_ghz: 0,
        memory_total_gb: 0,
        os_platform: process.platform,
        os_distro: "Unknown",
        os_release: "Unknown",
        os_arch: process.arch,
        gpu_model: "Unknown",
        gpu_vendor: "Unknown",
        manufacturer: "Unknown",
        model: "Unknown",
      };
    }
  }

  trackTranscriptionCompleted(metrics: TranscriptionMetrics): void {
    if (!this.posthog) {
      return;
    }

    this.posthog.capture({
      distinctId: this.machineId,
      event: "transcription_completed",
      properties: {
        ...metrics,
        ...this.persistedProperties,
      },
    });

    logger.main.debug("Tracked transcription completion", {
      session_id: metrics.session_id,
      model: metrics.model_id,
      duration: metrics.total_duration_ms,
      recording_duration: metrics.recording_duration_ms,
      processing_duration: metrics.processing_duration_ms,
    });
  }

  async shutdown(): Promise<void> {
    if (!this.posthog) {
      return;
    }

    await this.posthog.shutdown();
    logger.main.info("Telemetry service shut down");
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMachineId(): string {
    return this.machineId;
  }

  async optIn(): Promise<void> {
    await this.settingsService.setTelemetrySettings({ enabled: true });
    if (!this.posthog) {
      return;
    }

    await this.posthog.optIn();

    logger.main.info("Telemetry opt-in successful");
  }

  async optOut(): Promise<void> {
    await this.settingsService.setTelemetrySettings({ enabled: false });
    if (!this.posthog) {
      return;
    }

    await this.posthog.optOut();

    logger.main.info("Telemetry opt-out successful");
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.optIn();
    } else {
      await this.optOut();
    }
  }
}
