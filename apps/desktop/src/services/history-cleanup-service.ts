import { logger } from "../main/logger";
import { getHistoryRetentionCutoffDate } from "../constants/history-retention";
import { deleteTranscriptionsOlderThan } from "../db/transcriptions";
import { deleteAudioFilesForTranscriptions } from "../utils/audio-file-cleanup";
import type { SettingsService } from "./settings-service";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const SETTINGS_CHANGE_CLEANUP_DELAY_MS = 5 * 60 * 1000;
type CleanupReason = "startup" | "scheduled" | "settings-change";

export class HistoryCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  private settingsChangeCleanupTimeout: NodeJS.Timeout | null = null;
  private cleanupQueue: Promise<void> = Promise.resolve();
  private cleanupInFlight: Promise<void> | null = null;

  private readonly handleHistorySettingsChanged = () => {
    this.scheduleSettingsChangeCleanup();
  };

  constructor(private readonly settingsService: SettingsService) {}

  async initialize(): Promise<void> {
    this.settingsService.on(
      "history-settings-changed",
      this.handleHistorySettingsChanged,
    );

    void this.runCleanup("startup");

    this.cleanupInterval = setInterval(() => {
      void this.runCleanup("scheduled");
    }, CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref?.();
  }

  async cleanup(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.settingsChangeCleanupTimeout) {
      clearTimeout(this.settingsChangeCleanupTimeout);
      this.settingsChangeCleanupTimeout = null;
    }

    this.settingsService.off(
      "history-settings-changed",
      this.handleHistorySettingsChanged,
    );

    await this.cleanupQueue;
  }

  async runCleanup(reason: CleanupReason): Promise<void> {
    const queuedCleanup = this.cleanupQueue.then(async () => {
      this.cleanupInFlight = this.performCleanup(reason);

      try {
        await this.cleanupInFlight;
      } finally {
        this.cleanupInFlight = null;
      }
    });

    this.cleanupQueue = queuedCleanup.catch(() => undefined);
    return queuedCleanup;
  }

  private scheduleSettingsChangeCleanup(): void {
    if (this.settingsChangeCleanupTimeout) {
      clearTimeout(this.settingsChangeCleanupTimeout);
    }

    this.settingsChangeCleanupTimeout = setTimeout(() => {
      this.settingsChangeCleanupTimeout = null;
      void this.runCleanup("settings-change");
    }, SETTINGS_CHANGE_CLEANUP_DELAY_MS);
    this.settingsChangeCleanupTimeout.unref?.();
  }

  private async performCleanup(reason: CleanupReason): Promise<void> {
    try {
      const { retentionPeriod } =
        await this.settingsService.getHistorySettings();
      const cutoffDate = getHistoryRetentionCutoffDate(retentionPeriod);

      if (!cutoffDate) {
        logger.main.debug(
          "History cleanup skipped because retention is disabled",
          {
            reason,
            retentionPeriod,
          },
        );
        return;
      }

      const deletedTranscriptions =
        await deleteTranscriptionsOlderThan(cutoffDate);
      const deletedAudioFiles = await deleteAudioFilesForTranscriptions(
        deletedTranscriptions,
      );

      if (deletedTranscriptions.length === 0) {
        logger.main.debug("History cleanup found no expired transcriptions", {
          reason,
          retentionPeriod,
          cutoffDate: cutoffDate.toISOString(),
        });
        return;
      }

      logger.main.info("History cleanup completed", {
        reason,
        retentionPeriod,
        cutoffDate: cutoffDate.toISOString(),
        deletedTranscriptions: deletedTranscriptions.length,
        deletedAudioFiles,
      });
    } catch (error) {
      logger.main.error("History cleanup failed", { reason, error });
    }
  }
}
