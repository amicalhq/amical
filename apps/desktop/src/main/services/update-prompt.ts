import type { UpdateAction, UpdateMetadata } from "./auto-updater";

export interface UpdatePrompt {
  version?: string;
  releaseNotes?: string;
  action: Extract<UpdateAction, "prompt" | "force">;
}

/**
 * Derive the pending update prompt from the latest metadata and download state.
 * Returns null when nothing should be shown (no update, not downloaded,
 * silent/none, or a non-force prompt the user already dismissed for this version).
 */
export function computeUpdatePrompt(
  metadata: UpdateMetadata | null,
  downloaded: boolean,
  dismissedVersion: string | undefined,
): UpdatePrompt | null {
  if (!metadata || !downloaded) return null;
  if (metadata.action !== "prompt" && metadata.action !== "force") return null;
  if (
    metadata.action === "prompt" &&
    dismissedVersion !== undefined &&
    dismissedVersion === metadata.version
  ) {
    return null;
  }
  return {
    version: metadata.version,
    releaseNotes: metadata.releaseNotes,
    action: metadata.action,
  };
}
