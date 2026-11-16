import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { isLinux } from "./platform";

/**
 * Folder for dictation recordings. On Linux /tmp is shared by all users, so
 * the recordings go to the user's data folder instead.
 */
export function getAudioDir(): string {
  return isLinux()
    ? path.join(app.getPath("userData"), "audio")
    : path.join(app.getPath("temp"), "amical-audio");
}

/** Create the recordings folder (mode 0700 on Linux) and return its path. */
export function ensureAudioDir(): string {
  const audioDir = getAudioDir();
  fs.mkdirSync(audioDir, {
    recursive: true,
    ...(isLinux() && { mode: 0o700 }),
  });
  return audioDir;
}
