/**
 * macOS version utilities (main process only).
 *
 * The bundled on-device whisper.cpp bindings are built for macOS 15+ only; on
 * older versions the native binding fails to load. These helpers gate the local
 * transcription option behind that minimum.
 *
 * Kept separate from utils/platform.ts because `process.getSystemVersion()` is
 * an Electron main-process API, whereas platform.ts is imported by the renderer.
 */

const MIN_MACOS_MAJOR_FOR_LOCAL = 15;

/**
 * macOS marketing major version (e.g. 15 from "15.1.0", 26 from "26.0.0").
 * Returns null on non-macOS platforms or if the version string can't be parsed.
 */
export function getMacOSMajorVersion(): number | null {
  if (process.platform !== "darwin") return null;
  // getSystemVersion is an Electron main-process API; absent in plain Node
  // (e.g. tests). Fail closed when it can't be read.
  if (typeof process.getSystemVersion !== "function") return null;
  const major = parseInt(process.getSystemVersion().split(".")[0], 10);
  return Number.isNaN(major) ? null : major;
}

/**
 * Whether on-device (local whisper) transcription is supported on this machine.
 * macOS < 15 → false. Non-macOS platforms are unaffected → true.
 */
export function isLocalTranscriptionSupported(): boolean {
  if (process.platform !== "darwin") return true;
  const major = getMacOSMajorVersion();
  return major !== null && major >= MIN_MACOS_MAJOR_FOR_LOCAL;
}
