import { app, autoUpdater, net } from "electron";
import { EventEmitter } from "events";
import { logger } from "../logger";
import { getAmicalClientHeaders, getUserAgent } from "../../utils/http-client";
import type { SettingsService } from "../../services/settings-service";
import type { TelemetryService } from "../../services/telemetry-service";
import { computeUpdatePrompt, type UpdatePrompt } from "./update-prompt";

const UPDATE_SERVER = "https://update.amical.ai";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const CHECK_INTERVAL_AFTER_DOWNLOAD_MS = 3 * 60 * 60 * 1000; // 3 hours

// Dev-only test mode — opt in with `UPDATER_DEV_TEST=true pnpm start`. In an
// unpackaged build it runs the real update-meta round-trip and drives the real
// state machine, stubbing the macOS-signed Squirrel download/install (which
// can't run unsigned). Off in packaged builds and in normal dev runs; remove
// when the updater UI is no longer being tested.
const UPDATER_DEV_TEST =
  !app.isPackaged && process.env.UPDATER_DEV_TEST === "true";

export type UpdateAction = "none" | "silent" | "prompt" | "force";

const VALID_ACTIONS = new Set<string>(["none", "silent", "prompt", "force"]);

type UpdaterErrorClassification = "read_only_volume" | "generic";

export type UpdateState =
  | "not-available"
  | "checking"
  | "available"
  | "downloaded"
  | "error";

export interface UpdateMetadata {
  action: UpdateAction;
  version?: string;
  message?: string;
  releaseNotes?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function classifyUpdaterError(
  error: unknown,
  platform: NodeJS.Platform = process.platform,
): UpdaterErrorClassification {
  const message = getErrorMessage(error).toLowerCase();

  if (
    platform === "darwin" &&
    (message.includes("read-only volume") ||
      message.includes("read only volume"))
  ) {
    return "read_only_volume";
  }

  return "generic";
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
  private updateState: UpdateState = "not-available";
  private dismissedVersion: string | undefined = undefined;
  private mockCheckTimeout: ReturnType<typeof setTimeout> | null = null;
  private initialCheckTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
  }

  async initialize(
    settingsService: SettingsService,
    telemetryService: TelemetryService,
  ): Promise<void> {
    if (!app.isPackaged && !UPDATER_DEV_TEST) {
      logger.updater.info("Skipping auto-updater: app is not packaged");
      return;
    }

    if (UPDATER_DEV_TEST) {
      logger.updater.info(
        "[updater-dev-test] ACTIVE — real update-meta fetch + simulated download (no real install)",
      );
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
        this.setUpdateState("not-available");
        this.lastMetadata = null;
        this.dismissedVersion = undefined;
        this.emit("update-prompt-changed");
        this.setFeedURL(channel);
        logger.updater.info("Update channel changed, checking for updates", {
          channel,
        });
        this.checkForUpdates();
      },
    );

    // Start periodic checks with platform-appropriate initial delay
    const initialDelay = process.platform === "darwin" ? 10_000 : 60_000;
    this.initialCheckTimeout = setTimeout(() => {
      this.initialCheckTimeout = null;
      this.checkForUpdates();
      this.scheduleAutomaticChecks();
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

  private scheduleAutomaticChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    const intervalMs = this.updateDownloaded
      ? CHECK_INTERVAL_AFTER_DOWNLOAD_MS
      : CHECK_INTERVAL_MS;
    this.checkInterval = setInterval(() => this.checkForUpdates(), intervalMs);
    logger.updater.info("Automatic update checks scheduled", {
      intervalMs,
      updateDownloaded: this.updateDownloaded,
    });
  }

  private setUpdateState(state: UpdateState): void {
    if (state === this.updateState) return;

    this.updateState = state;
    logger.updater.info("Update state changed", { state });
    this.emit("state-changed");
  }

  /** Settle to the resting state once an in-flight check resolves. */
  private setSettledState(): void {
    this.setUpdateState(this.updateDownloaded ? "downloaded" : "not-available");
  }

  private clearDownloadedUpdate(reason: string): void {
    if (!this.updateDownloaded && this.effectiveVersion === app.getVersion()) {
      return;
    }

    logger.updater.info("Clearing downloaded update state", { reason });
    this.updateDownloaded = false;
    this.effectiveVersion = app.getVersion();
    this.setFeedURL(this.currentChannel);
    this.scheduleAutomaticChecks();
    this.emit("update-prompt-changed");
  }

  private registerEventHandlers(): void {
    autoUpdater.on("error", (error) => {
      this.isChecking = false;
      const classification = classifyUpdaterError(error);
      const message = getErrorMessage(error);

      if (classification === "read_only_volume") {
        logger.updater.warn("Auto-updater warning", {
          error: message,
          classification,
        });
        this.setSettledState();
        return;
      }

      logger.updater.error("Auto-updater error", { error: message });
      this.telemetryService?.captureException(error, {
        source: "auto_updater",
        channel: this.currentChannel,
        classification,
      });
      this.clearDownloadedUpdate(classification);
      this.setUpdateState("error");
    });

    autoUpdater.on("checking-for-update", () => {
      logger.updater.info("Checking for update...");
      this.setUpdateState("checking");
      this.emit("checking-for-update");
    });

    autoUpdater.on("update-available", () => {
      logger.updater.info("Update available, downloading...");
      // Reset so isDownloaded() only reflects the current download
      this.updateDownloaded = false;
      this.setUpdateState("available");
      this.emit("update-available");
    });

    autoUpdater.on("update-not-available", () => {
      this.isChecking = false;
      logger.updater.info("No update available");
      this.setSettledState();
      this.emit("update-not-available");
    });

    autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
      this.isChecking = false;
      this.updateDownloaded = true;
      this.setUpdateState("downloaded");
      logger.updater.info("Update downloaded", { releaseName });
      // Advance effective version so subsequent checks use the downloaded
      // version in the feed URL, avoiding re-downloads of the same release
      // while still discovering any newer releases.
      if (releaseName) {
        this.effectiveVersion = releaseName;
        this.setFeedURL(this.currentChannel);
      }
      this.scheduleAutomaticChecks();
      this.emit("update-downloaded", { releaseNotes, releaseName });
      this.emit("update-prompt-changed");
    });
  }

  getLastMetadata(): UpdateMetadata | null {
    return this.lastMetadata;
  }

  getUpdateState(): UpdateState {
    return this.updateState;
  }

  getUpdatePrompt(): UpdatePrompt | null {
    return computeUpdatePrompt(
      this.lastMetadata,
      this.updateDownloaded,
      this.dismissedVersion,
    );
  }

  dismissUpdatePrompt(): void {
    // Force updates cannot be dismissed.
    if (this.lastMetadata?.action === "force") return;
    this.dismissedVersion = this.lastMetadata?.version;
    this.emit("update-prompt-changed");
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
        headers: {
          "User-Agent": getUserAgent(),
          ...getAmicalClientHeaders(),
        },
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
    if (!app.isPackaged && !UPDATER_DEV_TEST) {
      logger.updater.info("Skipping update check: app is not packaged");
      if (userInitiated) {
        this.setUpdateState("checking");
        if (this.mockCheckTimeout) clearTimeout(this.mockCheckTimeout);
        this.mockCheckTimeout = setTimeout(() => {
          this.setUpdateState("not-available");
          this.mockCheckTimeout = null;
        }, 1500);
      }
      return;
    }

    if (this.isChecking) {
      logger.updater.info("Update check already in progress, skipping");
      return;
    }

    if (this.updateState === "available") {
      logger.updater.info("Update download already in progress, skipping");
      return;
    }

    // Manual checks should keep the visible action on "Restart to Install"
    // once an update is staged. Background checks may still run to discover
    // newer releases.
    if (userInitiated && this.updateDownloaded) {
      logger.updater.info("Update already downloaded, skipping manual check");
      this.setUpdateState("downloaded");
      return;
    }

    try {
      this.isChecking = true;
      this.setUpdateState("checking");
      logger.updater.info("Checking for updates", { userInitiated });

      // Fetch metadata to determine UI behavior. Only update lastMetadata
      // on success — transient failures preserve the previous policy so a
      // pending prompt/force isn't silently dropped.
      const metadata = await this.fetchUpdateMetadata();
      if (metadata) {
        this.lastMetadata = metadata;
        this.emit("update-prompt-changed");

        // Only skip Squirrel check on a fresh "none" response. If the fetch
        // failed, always proceed so stale cached "none" can't suppress
        // discovery of newly published releases.
        if (metadata.action === "none") {
          this.isChecking = false;
          this.setSettledState();
          this.emit("update-not-available");
          return;
        }
      }

      // Proceed with native update check (uses effectiveVersion in feed URL,
      // so it discovers newer releases even if one is already downloaded).
      if (UPDATER_DEV_TEST) {
        this.simulateDownloadForDevTest();
        return;
      }
      autoUpdater.checkForUpdates();
    } catch (error) {
      this.isChecking = false;
      logger.updater.error("Failed to check for updates", { error });
      this.clearDownloadedUpdate("check_failed");
      this.setUpdateState("error");
    }
  }

  quitAndInstall(): void {
    if (!this.updateDownloaded) {
      logger.updater.warn("Skipping install: update is not downloaded", {
        state: this.updateState,
      });
      return;
    }

    if (UPDATER_DEV_TEST) {
      logger.updater.info(
        "[updater-dev-test] Skipping real quitAndInstall (unsigned dev build)",
      );
      return;
    }

    logger.updater.info("Quitting and installing update");
    autoUpdater.quitAndInstall();
  }

  // Dev-test only: stand in for the Squirrel download (which can't run in an
  // unpackaged/unsigned build) by walking the real state transitions.
  private simulateDownloadForDevTest(): void {
    this.isChecking = false;
    this.updateDownloaded = false;
    this.setUpdateState("available");
    if (this.mockCheckTimeout) clearTimeout(this.mockCheckTimeout);
    this.mockCheckTimeout = setTimeout(() => {
      this.updateDownloaded = true;
      this.effectiveVersion =
        this.lastMetadata?.version ?? this.effectiveVersion;
      this.setUpdateState("downloaded");
      this.emit("update-prompt-changed");
      this.mockCheckTimeout = null;
    }, 2000);
  }

  cleanup(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.mockCheckTimeout) {
      clearTimeout(this.mockCheckTimeout);
      this.mockCheckTimeout = null;
    }
    if (this.initialCheckTimeout) {
      clearTimeout(this.initialCheckTimeout);
      this.initialCheckTimeout = null;
    }
    if (this.settingsService) {
      this.settingsService.removeAllListeners("update-channel-changed");
      this.settingsService = null;
    }
  }
}
