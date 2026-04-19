import * as si from "systeminformation";
import { logger } from "../main/logger";

export interface DetectedGpu {
  /** 0-based index matching the order returned by the driver (CUDA/Metal/etc.). */
  index: number;
  model: string;
  vendor: string;
  vramMB?: number;
  /** Coarse vendor category used to pick a supported native backend. */
  vendorCategory: "nvidia" | "amd" | "intel" | "apple" | "other";
  /** Whether this GPU is dedicated (heuristic: non-integrated). */
  dedicated: boolean;
}

export interface HardwareSnapshot {
  gpus: DetectedGpu[];
  cpuThreads: number;
  cpuModel: string;
}

function categorizeVendor(vendor: string): DetectedGpu["vendorCategory"] {
  const v = vendor.toLowerCase();
  if (v.includes("nvidia")) return "nvidia";
  if (v.includes("amd") || v.includes("ati") || v.includes("advanced micro"))
    return "amd";
  if (v.includes("intel")) return "intel";
  if (v.includes("apple")) return "apple";
  return "other";
}

export class HardwareDetectionService {
  private snapshot: HardwareSnapshot | null = null;
  private inFlight: Promise<HardwareSnapshot> | null = null;

  async detect(force = false): Promise<HardwareSnapshot> {
    if (!force && this.snapshot) return this.snapshot;
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      try {
        const [graphics, cpu] = await Promise.all([si.graphics(), si.cpu()]);
        const gpus: DetectedGpu[] = graphics.controllers.map((c, idx) => {
          const vendor = c.vendor || "Unknown";
          return {
            index: idx,
            model: c.model || "Unknown GPU",
            vendor,
            vramMB: typeof c.vram === "number" ? c.vram : undefined,
            vendorCategory: categorizeVendor(vendor),
            dedicated: typeof c.vram === "number" ? c.vram >= 2048 : false,
          };
        });
        this.snapshot = {
          gpus,
          cpuThreads: cpu.cores || 0,
          cpuModel: `${cpu.manufacturer} ${cpu.brand}`.trim(),
        };
        return this.snapshot;
      } catch (error) {
        logger.main.error("Hardware detection failed", error);
        this.snapshot = { gpus: [], cpuThreads: 0, cpuModel: "Unknown" };
        return this.snapshot;
      } finally {
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  getCached(): HardwareSnapshot | null {
    return this.snapshot;
  }
}
