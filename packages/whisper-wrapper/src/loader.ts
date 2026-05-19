import path from "node:path";
import fs from "node:fs";

export type WhisperBackend =
  | "auto"
  | "cpu"
  | "metal"
  | "openblas"
  | "cuda"
  | "vulkan";

export interface LoadBindingOptions {
  /**
   * Preferred native backend.
   * - "auto" (default): try GPU binaries first, then plain platform build, then cpu-fallback.
   * - "cpu": skip GPU binaries entirely and load a CPU-only build.
   * - "metal" | "openblas" | "cuda" | "vulkan": require that specific GPU backend;
   *   throws if its binary is missing or fails to load.
   */
  preferredBackend?: WhisperBackend;
}

const GPU_FIRST_CANDIDATES = ["metal", "openblas", "cuda", "vulkan"] as const;

function candidateDirs(
  platform: string,
  arch: string,
  preferredBackend: WhisperBackend,
): string[] {
  if (preferredBackend === "cpu") {
    return [`${platform}-${arch}`, "cpu-fallback"];
  }
  if (preferredBackend !== "auto") {
    return [`${platform}-${arch}-${preferredBackend}`];
  }
  return [
    ...GPU_FIRST_CANDIDATES.map((tag) => `${platform}-${arch}-${tag}`),
    `${platform}-${arch}`,
    "cpu-fallback",
  ];
}

function bindingPathFor(dir: string): string {
  return path.join(__dirname, "..", "native", dir, "whisper.node");
}

function isLoadableError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ERR_DLOPEN_FAILED"
  );
}

let warnedAboutUnknownEnvBackend = false;

function resolvePreferredBackend(
  opts?: LoadBindingOptions,
): WhisperBackend {
  if (opts?.preferredBackend) return opts.preferredBackend;
  const rawEnv = process.env.WHISPER_NATIVE_BACKEND;
  const envValue = rawEnv?.toLowerCase();
  if (
    envValue === "auto" ||
    envValue === "cpu" ||
    envValue === "metal" ||
    envValue === "openblas" ||
    envValue === "cuda" ||
    envValue === "vulkan"
  ) {
    return envValue;
  }
  if (rawEnv && !warnedAboutUnknownEnvBackend) {
    warnedAboutUnknownEnvBackend = true;
    console.warn(
      `[whisper-wrapper] Ignoring WHISPER_NATIVE_BACKEND="${rawEnv}" (expected one of auto|cpu|metal|openblas|cuda|vulkan). Falling back to "auto".`,
    );
  }
  return "auto";
}

export function resolveBinding(opts?: LoadBindingOptions): string {
  const { platform, arch } = process;
  const preferredBackend = resolvePreferredBackend(opts);
  for (const dir of candidateDirs(platform, arch, preferredBackend)) {
    const candidate = bindingPathFor(dir);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `No suitable whisper.node binary found for ${platform}-${arch} (preferred: ${preferredBackend})`,
  );
}

let loadedBindingInfo: { path: string; type: string } | null = null;
let loadedBackend: WhisperBackend | null = null;
let cachedBinding: unknown = null;

export function getLoadedBindingInfo(): { path: string; type: string } | null {
  return loadedBindingInfo;
}

function bindingTypeFromDir(dir: string): string {
  if (dir.includes("-cuda")) return "cuda";
  if (dir.includes("-vulkan")) return "vulkan";
  if (dir.includes("-metal")) return "metal";
  if (dir.includes("-openblas")) return "openblas";
  if (dir === "cpu-fallback") return "cpu-fallback";
  return "cpu";
}

export function loadBinding(opts?: LoadBindingOptions): any {
  const preferredBackend = resolvePreferredBackend(opts);

  if (cachedBinding && loadedBackend === preferredBackend) {
    return cachedBinding;
  }

  const { platform, arch } = process;
  const attempted: string[] = [];
  let lastLoadError: unknown = null;

  for (const dir of candidateDirs(platform, arch, preferredBackend)) {
    const candidate = bindingPathFor(dir);
    if (!fs.existsSync(candidate)) continue;

    attempted.push(candidate);
    try {
      const mod = require(candidate);
      if (attempted.length > 1) {
        console.warn(
          `[whisper-wrapper] loaded fallback binary: ${candidate} (attempted ${attempted.length} candidates)`,
        );
      }

      loadedBindingInfo = { path: candidate, type: bindingTypeFromDir(dir) };
      loadedBackend = preferredBackend;
      cachedBinding = mod;
      return mod;
    } catch (error) {
      if (isLoadableError(error)) {
        console.warn(
          `[whisper-wrapper] failed to load ${candidate}: ${(error as Error).message}. Trying next candidate...`,
        );
        lastLoadError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastLoadError) {
    throw new Error(
      `Unable to load whisper.node for ${platform}-${arch} (preferred: ${preferredBackend}). Attempted: ${attempted.join(", ")}`,
      { cause: lastLoadError },
    );
  }

  throw new Error(
    `No suitable whisper.node binary found for ${platform}-${arch} (preferred: ${preferredBackend})`,
  );
}
