import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import { HardwareDetectionService } from "../../services/hardware-detection-service";
import { resolveBinding } from "@amical/whisper-wrapper";
import * as fs from "node:fs";
import * as path from "node:path";

// Stateless singleton: detection results are cached internally after the first call.
const hardwareService = new HardwareDetectionService();

const BACKENDS = ["metal", "openblas", "cuda", "vulkan"] as const;

function detectAvailableBackends(): string[] {
  // Mirror the loader's search logic so the UI can show which native binaries
  // are actually shipped with this build.
  const available: string[] = [];
  for (const tag of BACKENDS) {
    try {
      const candidate = resolveBinding({
        preferredBackend: tag as (typeof BACKENDS)[number],
      });
      if (fs.existsSync(candidate) && path.basename(candidate) === "whisper.node") {
        available.push(tag);
      }
    } catch {
      // binary not shipped for this backend
    }
  }
  // CPU is always implicitly available (cpu-fallback or plain platform build).
  available.push("cpu");
  // De-duplicate while preserving order.
  return Array.from(new Set(available));
}

export const hardwareRouter = createRouter({
  // Enumerate detected GPUs + which native backends are actually shipped.
  getSnapshot: procedure
    .input(z.object({ refresh: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const snapshot = await hardwareService.detect(input?.refresh ?? false);
      return {
        ...snapshot,
        availableBackends: detectAvailableBackends(),
      };
    }),
});
