import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GraphicsControllerInfo {
  model?: string | null;
  vendor?: string | null;
}

export interface WhisperGpuDecision {
  useGpu: boolean;
  reason: string;
}

function controllerText(controller: GraphicsControllerInfo): string {
  return `${controller.vendor ?? ""} ${controller.model ?? ""}`.trim();
}

function isIntelGpu(controller: GraphicsControllerInfo): boolean {
  const text = controllerText(controller);
  if (/\bintel\b/i.test(text)) {
    return true;
  }

  if (/\bamd\b|\bradeon\b|\bnvidia\b|\bapple\b/i.test(text)) {
    return false;
  }

  return /\biris\b|\buhd graphics\b|\bhd graphics\b/i.test(text);
}

function hasKnownGpu(controller: GraphicsControllerInfo): boolean {
  return controllerText(controller).length > 0;
}

function parseMacGraphicsControllers(stdout: string): GraphicsControllerInfo[] {
  const parsed = JSON.parse(stdout) as {
    SPDisplaysDataType?: Array<Record<string, unknown>>;
  };

  return (parsed.SPDisplaysDataType ?? []).map((controller) => ({
    model:
      typeof controller.sppci_model === "string"
        ? controller.sppci_model
        : typeof controller._name === "string"
          ? controller._name
          : null,
    vendor:
      typeof controller.spdisplays_vendor === "string"
        ? controller.spdisplays_vendor
        : null,
  }));
}

export function decideWhisperGpuUse(
  controllers: readonly GraphicsControllerInfo[],
  platform = process.platform,
  arch = process.arch,
): WhisperGpuDecision {
  if (platform !== "darwin" || arch !== "x64") {
    return {
      useGpu: true,
      reason: `GPU enabled on ${platform}-${arch}`,
    };
  }

  const knownControllers = controllers.filter(hasKnownGpu);
  if (knownControllers.length === 0) {
    return {
      useGpu: true,
      reason: "GPU enabled because no graphics controllers were reported",
    };
  }

  const hasIntelGpu = knownControllers.some(isIntelGpu);
  const hasNonIntelGpu = knownControllers.some(
    (controller) => !isIntelGpu(controller),
  );

  if (hasIntelGpu && !hasNonIntelGpu) {
    return {
      useGpu: false,
      reason:
        "GPU disabled because ggml Metal returns invalid transcripts on Intel-only macOS x64 GPUs",
    };
  }

  return {
    useGpu: true,
    reason: `GPU enabled with controllers: ${knownControllers
      .map(controllerText)
      .join(", ")}`,
  };
}

export async function resolveWhisperGpuDecision(): Promise<WhisperGpuDecision> {
  if (process.platform !== "darwin" || process.arch !== "x64") {
    return decideWhisperGpuUse([], process.platform, process.arch);
  }

  try {
    const { stdout } = await execFileAsync(
      "/usr/sbin/system_profiler",
      ["SPDisplaysDataType", "-json"],
      {
        maxBuffer: 1024 * 1024,
        timeout: 5000,
      },
    );

    return decideWhisperGpuUse(
      parseMacGraphicsControllers(stdout),
      process.platform,
      process.arch,
    );
  } catch (error) {
    return {
      useGpu: true,
      reason: `GPU enabled because graphics probing failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
