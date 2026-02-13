import { PostHog } from "posthog-node";
import { machineId } from "node-machine-id";
import * as si from "systeminformation";
import { app } from "electron";
import { logger } from "../main/logger";

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

export class PostHogClient {
  readonly posthog: PostHog | null = null;
  private _machineId: string = "";
  private _systemInfo: SystemInfo | null = null;
  private _personProperties: Record<string, string> = {};

  constructor() {
    const host = process.env.POSTHOG_HOST || __BUNDLED_POSTHOG_HOST;
    const apiKey = process.env.POSTHOG_API_KEY || __BUNDLED_POSTHOG_API_KEY;

    const telemetryEnabled = process.env.TELEMETRY_ENABLED
      ? process.env.TELEMETRY_ENABLED !== "false"
      : __BUNDLED_TELEMETRY_ENABLED;

    if (!host || !apiKey || !telemetryEnabled) {
      logger.main.info(
        "PostHog disabled since either api key or host has not been provided",
      );
      return;
    }

    this.posthog = new PostHog(apiKey, {
      host,
      flushAt: 1,
      flushInterval: 10000,
      enableExceptionAutocapture: true,
      defaultOptIn: false,
    });
  }

  async initialize(): Promise<void> {
    this._machineId = await machineId();
    logger.main.info("Machine ID generated", { machineId: this._machineId });

    this._systemInfo = await this.collectSystemInfo();
    logger.main.info("System information collected", {
      systemInfo: this._systemInfo,
    });

    this._personProperties = {
      app_version: app.getVersion(),
      app_is_packaged: String(app.isPackaged),
      ...(this._systemInfo && {
        os_platform: this._systemInfo.os_platform,
        os_distro: this._systemInfo.os_distro,
        os_release: this._systemInfo.os_release,
        os_arch: this._systemInfo.os_arch,
        cpu_model: this._systemInfo.cpu_model,
        cpu_cores: String(this._systemInfo.cpu_cores),
        memory_total_gb: String(this._systemInfo.memory_total_gb),
        gpu_model: this._systemInfo.gpu_model,
        gpu_vendor: this._systemInfo.gpu_vendor,
      }),
    };
  }

  async shutdown(timeout?: number): Promise<void> {
    if (!this.posthog) {
      return;
    }

    await this.posthog.shutdown(timeout);
    logger.main.info("PostHog client shut down");
  }

  get machineId(): string {
    return this._machineId;
  }

  get systemInfo(): SystemInfo | null {
    return this._systemInfo;
  }

  get personProperties(): Record<string, string> {
    return this._personProperties;
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
        cpu_model: `${cpu.manufacturer} ${cpu.brand}`.trim(),
        cpu_cores: cpu.physicalCores,
        cpu_threads: cpu.cores,
        cpu_speed_ghz: cpu.speed,
        memory_total_gb: Math.round(mem.total / 1073741824),
        os_platform: osInfo.platform,
        os_distro: osInfo.distro,
        os_release: osInfo.release,
        os_arch: osInfo.arch,
        gpu_model: graphics.controllers[0]?.model || "Unknown",
        gpu_vendor: graphics.controllers[0]?.vendor || "Unknown",
        manufacturer: system.manufacturer || "Unknown",
        model: system.model || "Unknown",
      };
    } catch (error) {
      logger.main.error("Failed to collect system info:", error);
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
}
