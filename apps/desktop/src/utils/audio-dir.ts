import path from "node:path";
import { app } from "electron";

/**
 * Folder for dictation recordings. On Linux /tmp is shared by all users, so
 * the recordings go to the user's data folder, created with mode 0700.
 */
export function getAudioDir(): string {
  return process.platform === "linux"
    ? path.join(app.getPath("userData"), "audio")
    : path.join(app.getPath("temp"), "amical-audio");
}
