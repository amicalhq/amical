import { app, autoUpdater } from "electron";
import { EventEmitter } from "events";
import { logger } from "../logger";
import type { SettingsService } from "../../services/settings-service";
import type { TelemetryService } from "../../services/telemetry-service";

const UPDATE_SERVER = "https://update.amical.ai";
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export class AutoUpdaterService extends EventEmitter {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private settingsService: SettingsService | null = null;
  private telemetryService: TelemetryService | null = null;
  private currentChannel: "stable" | "beta" = "stable";
  // Track the latest version we know about (downloaded or running) so the
  // feed URL always reflects the newest version we have, preventing
  // re-downloads of the same release while still discovering newer ones.
  private effectiveVersion: string = app.getVersion();
  private isChecking = false;

  constructor() {
    super();
  }

  async initialize(
    settingsService: SettingsService,
    telemetryService: TelemetryService,
  ): Promise<void> {
    if (!app.isPackaged) {
      logger.updater.info("Skipping auto-updater: app is not packaged");
      return;
    }

    if (process.argv.includes("--squirrel-firstrun")) {
      logger.updater.info(
        "Skipping auto-updater: first run after Squirrel install",
      );
      return;
    }

    this.settingsService = settingsService;
    this.telemetryService = telemetryService;
    this.currentChannel = await settingsService.getUpdateChannel();

    this.setFeedURL(this.currentChannel);
    this.registerEventHandlers();

    // Listen for channel changes
    settingsService.on(
      "update-channel-changed",
      (channel: "stable" | "beta") => {
        this.currentChannel = channel;
        // Reset to running version — the new channel's version space is different
        this.effectiveVersion = app.getVersion();
        this.setFeedURL(channel);
        logger.updater.info("Update channel changed, checking for updates", {
          channel,
        });
        this.checkForUpdates();
      },
    );

    // Start periodic checks with platform-appropriate initial delay
    const initialDelay = process.platform === "darwin" ? 10_000 : 60_000;
    setTimeout(() => {
      this.checkForUpdates();
      this.checkInterval = setInterval(
        () => this.checkForUpdates(),
        CHECK_INTERVAL_MS,
      );
    }, initialDelay);

    logger.updater.info("Auto-updater initialized", {
      channel: this.currentChannel,
    });
  }

  private setFeedURL(channel: "stable" | "beta"): void {
    const platform = process.platform;
    const arch = process.arch;
    const url = `${UPDATE_SERVER}/update/${channel}/${platform}-${arch}/${this.effectiveVersion}`;

    try {
      autoUpdater.setFeedURL({ url });
      logger.updater.info("Feed URL set", { url });
    } catch (error) {
      logger.updater.error("Failed to set feed URL", { error });
    }
  }

  private registerEventHandlers(): void {
    autoUpdater.on("error", (error) => {
      this.isChecking = false;
      logger.updater.error("Auto-updater error", { error: error.message });
      this.telemetryService?.captureException(error, {
        source: "auto_updater",
        channel: this.currentChannel,
      });
    });

    autoUpdater.on("checking-for-update", () => {
      logger.updater.info("Checking for update...");
      this.emit("checking-for-update");
    });

    autoUpdater.on("update-available", () => {
      logger.updater.info("Update available, downloading...");
      this.emit("update-available");
    });

    autoUpdater.on("update-not-available", () => {
      this.isChecking = false;
      logger.updater.info("No update available");
      this.emit("update-not-available");
    });

    autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
      this.isChecking = false;
      logger.updater.info("Update downloaded", { releaseName });
      // Advance effective version so subsequent checks use the downloaded
      // version in the feed URL, avoiding re-downloads of the same release
      // while still discovering any newer releases.
      if (releaseName) {
        this.effectiveVersion = releaseName;
        this.setFeedURL(this.currentChannel);
      }
      this.emit("update-downloaded", { releaseNotes, releaseName });
    });
  }

  async checkForUpdates(userInitiated = false): Promise<void> {
    if (!app.isPackaged) {
      logger.updater.info("Skipping update check: app is not packaged");
      return;
    }

    if (this.isChecking) {
      logger.updater.info("Update check already in progress, skipping");
      return;
    }

    try {
      this.isChecking = true;
      logger.updater.info("Checking for updates", { userInitiated });
      autoUpdater.checkForUpdates();
    } catch (error) {
      this.isChecking = false;
      logger.updater.error("Failed to check for updates", { error });
    }
  }

  quitAndInstall(): void {
    logger.updater.info("Quitting and installing update");
    autoUpdater.quitAndInstall();
  }

  cleanup(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.settingsService) {
      this.settingsService.removeAllListeners("update-channel-changed");
      this.settingsService = null;
    }
  }
}
