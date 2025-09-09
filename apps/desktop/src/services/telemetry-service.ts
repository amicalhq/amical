import { PostHog } from "posthog-node";
import { machineId } from "node-machine-id";
import * as si from "systeminformation";
import { app } from "electron";
import { logger } from "../main/logger";

export interface TranscriptionMetrics {
  session_id?: string;
  model_id: string;
  model_preloaded?: boolean;
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
  private persistedProperties: Record<string, any> = {};

  constructor() {
    // Public constructor for consistency with other services
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Check if telemetry is enabled via environment variable
      const apiKey = process.env.POSTHOG_API_KEY;
      const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";

      if (!apiKey || !telemetryEnabled) {
        logger.main.info("Telemetry disabled or no API key provided");
        this.enabled = false;
        return;
      }

      // Get unique machine ID
      this.machineId = await machineId();
      logger.main.info("Machine ID generated for telemetry");

      // Collect system information
      this.systemInfo = await this.collectSystemInfo();
      logger.main.info("System information collected for telemetry");

      // Initialize PostHog
      const host = process.env.POSTHOG_HOST || "https://app.posthog.com";
      this.posthog = new PostHog(apiKey, {
        host,
        flushAt: 1,
        flushInterval: 10000,
      });

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
    } catch (error) {
      logger.main.error("Failed to initialize telemetry service:", error);
      this.enabled = false;
    }
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
    if (!this.enabled || !this.posthog) return;

    try {
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
    } catch (error) {
      logger.main.error("Failed to track transcription completed:", error);
    }
  }

  async shutdown(): Promise<void> {
    if (this.posthog) {
      try {
        await this.posthog.shutdown();
        logger.main.info("Telemetry service shut down");
      } catch (error) {
        logger.main.error("Error shutting down telemetry:", error);
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMachineId(): string {
    return this.machineId;
  }
}
