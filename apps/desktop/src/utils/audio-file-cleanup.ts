import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../main/logger";

/**
 * Clean up old audio files from the temporary directory
 * @param maxAgeMs Maximum age of files to keep in milliseconds (default: 24 hours)
 * @param maxSizeBytes Maximum total size of audio files in bytes (default: 500MB)
 */
export async function cleanupAudioFiles(options?: {
  maxAgeMs?: number;
  maxSizeBytes?: number;
}): Promise<void> {
  const maxAgeMs = options?.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
  const maxSizeBytes = options?.maxSizeBytes ?? 500 * 1024 * 1024; // 500MB

  const audioDir = path.join(app.getPath("temp"), "grizzo-audio");

  try {
    // Check if directory exists
    if (!fs.existsSync(audioDir)) {
      logger.main.debug("Audio directory does not exist, nothing to clean");
      return;
    }

    const files = await fs.promises.readdir(audioDir);
    const now = Date.now();

    // Get file stats and sort by modified time (oldest first)
    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(audioDir, file);
        try {
          const stats = await fs.promises.stat(filePath);
          return {
            path: filePath,
            name: file,
            size: stats.size,
            mtime: stats.mtime.getTime(),
            age: now - stats.mtime.getTime(),
          };
        } catch (error) {
          logger.main.warn("Failed to stat audio file", { file, error });
          return null;
        }
      }),
    );

    // Filter out null entries and audio files only
    const audioFiles = fileStats.filter(
      (stat) => stat !== null && stat.name.startsWith("audio-"),
    ) as NonNullable<(typeof fileStats)[number]>[];

    // Sort by age (oldest first)
    audioFiles.sort((a, b) => b.age - a.age);

    let totalSize = 0;
    let deletedCount = 0;
    let deletedSize = 0;

    for (const file of audioFiles) {
      totalSize += file.size;

      // Delete if file is too old or total size exceeds limit
      if (file.age > maxAgeMs || totalSize > maxSizeBytes) {
        try {
          await fs.promises.unlink(file.path);
          deletedCount++;
          deletedSize += file.size;
          logger.main.info("Deleted old audio file", {
            file: file.name,
            age: Math.round(file.age / 1000 / 60), // minutes
            size: Math.round(file.size / 1024), // KB
          });
        } catch (error) {
          logger.main.error("Failed to delete audio file", {
            file: file.name,
            error,
          });
        }
      }
    }

    if (deletedCount > 0) {
      logger.main.info("Audio cleanup completed", {
        deletedCount,
        deletedSizeMB: Math.round(deletedSize / 1024 / 1024),
        remainingCount: audioFiles.length - deletedCount,
        remainingSizeMB: Math.round((totalSize - deletedSize) / 1024 / 1024),
      });
    } else {
      logger.main.debug("No audio files needed cleanup", {
        totalCount: audioFiles.length,
        totalSizeMB: Math.round(totalSize / 1024 / 1024),
      });
    }
  } catch (error) {
    logger.main.error("Audio cleanup failed", { error });
  }
}

/**
 * Delete a specific audio file
 * @param filePath Path to the audio file to delete
 */
export async function deleteAudioFile(filePath: string): Promise<void> {
  try {
    // Ensure the file is in the audio directory
    const audioDir = path.join(app.getPath("temp"), "grizzo-audio");
    if (!filePath.startsWith(audioDir)) {
      throw new Error("File is not in the audio directory");
    }

    await fs.promises.unlink(filePath);
    logger.main.info("Deleted audio file", { filePath });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.main.error("Failed to delete audio file", { filePath, error });
      throw error;
    }
    // File doesn't exist, that's fine
  }
}
