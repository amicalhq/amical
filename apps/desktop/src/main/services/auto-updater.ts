import { app, autoUpdater, net } from "electron";
import { EventEmitter } from "events";
import { logger } from "../logger";
import { getUserAgent } from "../../utils/http-client";
import type { SettingsService } from "../../services/settings-service";
import type { TelemetryService } from "../../services/telemetry-service";

const UPDATE_SERVER = "https://update.amical.ai";
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export type UpdateAction = "none" | "silent" | "prompt" | "force";

const VALID_ACTIONS = new Set<string>(["none", "silent", "prompt", "force"]);

export interface UpdateMetadata {
  action: UpdateAction;
  version?: string;
  message?: string;
  releaseNotes?: string;
}

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
  private lastMetadata: UpdateMetadata | null = null;
  private updateDownloaded = false;

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
        this.updateDownloaded = false;
        this.lastMetadata = null;
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
      // Reset so isDownloaded() only reflects the current download
      this.updateDownloaded = false;
      this.emit("update-available");
    });

    autoUpdater.on("update-not-available", () => {
      this.isChecking = false;
      logger.updater.info("No update available");
      this.emit("update-not-available");
    });

    autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
      this.isChecking = false;
      this.updateDownloaded = true;
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

  getLastMetadata(): UpdateMetadata | null {
    return this.lastMetadata;
  }

  isDownloaded(): boolean {
    return this.updateDownloaded;
  }

  private async fetchUpdateMetadata(): Promise<UpdateMetadata | null> {
    const platform = process.platform;
    const arch = process.arch;
    // Always use the running version for metadata so the server evaluates
    // policy against what the user is actually running, not what's downloaded.
    const url = `${UPDATE_SERVER}/update-meta/${this.currentChannel}/${platform}-${arch}/${app.getVersion()}`;

    try {
      const response = await net.fetch(url, {
        headers: { "User-Agent": getUserAgent() },
      });

      if (!response.ok) {
        logger.updater.warn("Metadata endpoint returned non-OK status", {
          status: response.status,
        });
        return null;
      }

      const raw: unknown = await response.json();
      const data = this.parseUpdateMetadata(raw);
      logger.updater.info("Update metadata fetched", {
        action: data.action,
        version: data.version,
      });
      return data;
    } catch (error) {
      logger.updater.warn("Failed to fetch update metadata", { error });
      return null;
    }
  }

  private parseUpdateMetadata(raw: unknown): UpdateMetadata {
    if (typeof raw !== "object" || raw === null) {
      logger.updater.warn(
        "Invalid metadata response shape, falling back to silent",
      );
      return { action: "silent" };
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.action !== "string" || !VALID_ACTIONS.has(obj.action)) {
      logger.updater.warn("Invalid metadata action, falling back to silent", {
        action: obj.action,
      });
      return { action: "silent" };
    }
    return {
      action: obj.action as UpdateAction,
      version: typeof obj.version === "string" ? obj.version : undefined,
      message: typeof obj.message === "string" ? obj.message : undefined,
      releaseNotes:
        typeof obj.releaseNotes === "string" ? obj.releaseNotes : undefined,
    };
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

      // Fetch metadata to determine UI behavior. Only update lastMetadata
      // on success — transient failures preserve the previous policy so a
      // pending prompt/force isn't silently dropped.
      const metadata = await this.fetchUpdateMetadata();
      if (metadata) {
        this.lastMetadata = metadata;

        // Only skip Squirrel check on a fresh "none" response. If the fetch
        // failed, always proceed so stale cached "none" can't suppress
        // discovery of newly published releases.
        if (metadata.action === "none") {
          this.isChecking = false;
          this.emit("update-not-available");
          return;
        }
      }

      // Proceed with native update check (uses effectiveVersion in feed URL,
      // so it discovers newer releases even if one is already downloaded).
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
