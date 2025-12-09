import path from "node:path";
import fs from "node:fs";

const GPU_FIRST_CANDIDATES = ["metal", "openblas", "cuda", "vulkan"] as const;

function candidateDirs(platform: string, arch: string): string[] {
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

export function resolveBinding(): string {
  const { platform, arch } = process;
  for (const dir of candidateDirs(platform, arch)) {
    const candidate = bindingPathFor(dir);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `No suitable whisper.node binary found for ${platform}-${arch}`,
  );
}

let loadedBindingInfo: { path: string; type: string } | null = null;

export function getLoadedBindingInfo(): { path: string; type: string } | null {
  return loadedBindingInfo;
}

export function loadBinding(): any {
  const { platform, arch } = process;
  const attempted: string[] = [];
  let lastLoadError: unknown = null;

  for (const dir of candidateDirs(platform, arch)) {
    const candidate = bindingPathFor(dir);
    if (!fs.existsSync(candidate)) {
      continue;
    }

    attempted.push(candidate);
    try {
      const mod = require(candidate);
      if (attempted.length > 1) {
        console.warn(
          `[whisper-wrapper] loaded fallback binary: ${candidate} (attempted ${attempted.length} candidates)`,
        );
      }

      // Store the loaded binding info
      const bindingType = dir.includes("-cuda")
        ? "cuda"
        : dir.includes("-vulkan")
          ? "vulkan"
          : dir.includes("-metal")
            ? "metal"
            : dir.includes("-openblas")
              ? "openblas"
              : dir === "cpu-fallback"
                ? "cpu-fallback"
                : "cpu";
      loadedBindingInfo = {
        path: candidate,
        type: bindingType,
      };

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
    const error = new Error(
      `Unable to load whisper.node for ${platform}-${arch}. Attempted: ${attempted.join(", ")}`,
      { cause: lastLoadError },
    );
    throw error;
  }

  throw new Error(
    `No suitable whisper.node binary found for ${platform}-${arch}`,
  );
}
