import { app, autoUpdater, net } from "electron";
import { EventEmitter } from "events";
import { logger } from "../logger";
import {
  AMICAL_DEVICE_ID_HEADER,
  getAmicalClientHeaders,
  getUserAgent,
} from "../../utils/http-client";
import type { SettingsService } from "../../services/settings-service";
import type { TelemetryService } from "../../services/telemetry-service";
import { computeUpdatePrompt, type UpdatePrompt } from "./update-prompt";

const UPDATE_SERVER = "https://update.amical.ai";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const CHECK_INTERVAL_AFTER_DOWNLOAD_MS = 3 * 60 * 60 * 1000; // 3 hours

export type UpdateAction = "none" | "silent" | "prompt" | "force";

const VALID_ACTIONS = new Set<string>(["none", "silent", "prompt", "force"]);

type UpdaterErrorClassification = "read_only_volume" | "generic";

export type UpdateState =
  | "not-available"
  | "checking"
  | "available"
  | "downloaded"
  | "error";

// Internal lifecycle phase. The public UpdateState is derived from this plus
// `staged` (see deriveUpdateState) — keeping them separate means out-of-band
// resets (e.g. a channel change) can never desync the in-flight guard from the
// UI label.
type UpdatePhase = "idle" | "checking" | "downloading" | "error";

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
  private lastMetadata: UpdateMetadata | null = null;
  // Two orthogonal axes: `phase` is the transient activity (idle/checking/
  // downloading/error); `staged` is whether a downloaded install is waiting.
  // A staged install survives background re-checks, so these genuinely differ.
  // The public UpdateState is derived from both via deriveUpdateState().
  private phase: UpdatePhase = "idle";
  private staged = false;
  private publicState: UpdateState = "not-available";
  private dismissedVersion: string | undefined = undefined;
  // Electron's native autoUpdater does not scope lifecycle events to a request.
  // While it is checking/downloading, keep its feed URL stable and remember the
  // latest requested channel here. Once the current cycle settles, apply this
  // channel and let the next manual or scheduled check fetch fresh metadata.
  private pendingChannel: "stable" | "beta" | null = null;
  private initialCheckTimeout: ReturnType<typeof setTimeout> | null = null;

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

    if (process.env.AMICAL_E2E === "1") {
      logger.updater.info("Skipping auto-updater: e2e test run");
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
        if (this.isCheckingOrDownloading) {
          // Can't safely switch while a native cycle is in flight — queue it.
          this.deferChannelChange(channel);
          return;
        }
        this.pendingChannel = null;
        this.applyChannel(channel);
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
    const runningVersion = encodeURIComponent(app.getVersion());
    const url = `${UPDATE_SERVER}/update/${channel}/${platform}-${arch}/${this.effectiveVersion}?runningVersion=${runningVersion}`;

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

    const intervalMs = this.staged
      ? CHECK_INTERVAL_AFTER_DOWNLOAD_MS
      : CHECK_INTERVAL_MS;
    this.checkInterval = setInterval(() => this.checkForUpdates(), intervalMs);
    logger.updater.info("Automatic update checks scheduled", {
      intervalMs,
      staged: this.staged,
    });
  }

  // A check/download cycle is in flight ("available"/downloading included).
  // Reads `phase` only, so resetting the public/UI state elsewhere (e.g. on a
  // channel change) can never clear it.
  private get isCheckingOrDownloading(): boolean {
    return this.phase === "checking" || this.phase === "downloading";
  }

  // The public UI state is a projection of (phase, staged): an in-flight phase
  // shows directly, otherwise we rest on "downloaded" if an install is staged.
  private deriveUpdateState(): UpdateState {
    if (this.phase === "checking") return "checking";
    if (this.phase === "downloading") return "available";
    if (this.phase === "error") return "error";
    return this.staged ? "downloaded" : "not-available";
  }

  // Single writer for the public state: recompute from (phase, staged) and emit
  // only when the derived value actually changes.
  private publishState(): void {
    const next = this.deriveUpdateState();
    if (next === this.publicState) return;

    this.publicState = next;
    logger.updater.info("Update state changed", { state: next });
    this.emit("state-changed");
  }

  // The only way `phase` is mutated: set it and publish in one step, so the
  // public state can never lag the phase it's derived from.
  private setPhase(phase: UpdatePhase): void {
    this.phase = phase;
    this.publishState();
  }

  // Clear the per-channel prompt/staged state and notify the UI. The feed URL
  // and effectiveVersion are intentionally NOT reset here — deferChannelChange
  // must keep them pinned to the in-flight cycle's channel.
  private resetPromptState(): void {
    this.staged = false;
    this.lastMetadata = null;
    this.dismissedVersion = undefined;
    this.emit("update-prompt-changed");
  }

  private applyChannel(channel: "stable" | "beta"): void {
    this.currentChannel = channel;
    // Reset to running version — each channel has its own version space.
    this.effectiveVersion = app.getVersion();
    this.resetPromptState();
    this.setFeedURL(channel);
    // setPhase last so it's the single publish for this whole reset, and the
    // only-mutator-of-phase invariant holds with no exceptions.
    this.setPhase("idle");
    logger.updater.info("Update channel applied", { channel });
  }

  private deferChannelChange(channel: "stable" | "beta"): void {
    this.pendingChannel = channel;
    // Don't touch currentChannel/feed URL while a native cycle is running; the
    // requested channel is applied once it settles (applyPendingChannelIfNeeded).
    // Clearing the prompt is safe and gives immediate UI feedback; the in-flight
    // phase still drives the status label, so no state-changed emit is needed.
    this.resetPromptState();
    logger.updater.info("Update channel change deferred", {
      channel,
      currentChannel: this.currentChannel,
    });
  }

  private applyPendingChannelIfNeeded(reason: string): boolean {
    if (!this.pendingChannel) return false;

    const channel = this.pendingChannel;
    this.pendingChannel = null;
    this.applyChannel(channel);
    logger.updater.info("Deferred update channel applied", { channel, reason });
    return true;
  }

  // Shared enter/exit-staged transition: pin the feed URL to `version`,
  // reschedule background checks for the new staged state, and notify the UI.
  private applyStagedVersion(staged: boolean, version: string): void {
    this.staged = staged;
    this.effectiveVersion = version;
    this.setFeedURL(this.currentChannel);
    this.scheduleAutomaticChecks();
    this.emit("update-prompt-changed");
  }

  private clearDownloadedUpdate(reason: string): void {
    if (!this.staged && this.effectiveVersion === app.getVersion()) {
      return;
    }

    logger.updater.info("Clearing downloaded update state", { reason });
    this.applyStagedVersion(false, app.getVersion());
  }

  // A failure during check/download must never invalidate an already-staged
  // install: keep the Restart/Update prompt up and just settle the phase. Only
  // when nothing is staged do we surface the error and reset to the running
  // version. Single home for the "clearing while staged is forbidden" rule.
  private failOrPreserveStaged(reason: string): void {
    if (this.staged) {
      this.setPhase("idle");
      this.emit("update-prompt-changed");
      return;
    }
    this.clearDownloadedUpdate(reason);
    this.setPhase("error");
  }

  private registerEventHandlers(): void {
    autoUpdater.on("error", (error) => {
      const classification = classifyUpdaterError(error);
      const message = getErrorMessage(error);

      if (this.applyPendingChannelIfNeeded("native_error")) {
        logger.updater.warn("Ignoring updater error from deferred channel", {
          error: message,
          classification,
        });
        return;
      }

      if (classification === "read_only_volume") {
        logger.updater.warn("Auto-updater warning", {
          error: message,
          classification,
        });
        this.setPhase("idle");
        return;
      }

      logger.updater.error("Auto-updater error", { error: message });
      this.telemetryService?.captureException(error, {
        source: "auto_updater",
        channel: this.currentChannel,
        classification,
      });

      if (this.staged) {
        logger.updater.warn(
          "Auto-updater error occurred after an update was staged; preserving downloaded update",
          { error: message, classification },
        );
      }
      this.failOrPreserveStaged(classification);
    });

    autoUpdater.on("checking-for-update", () => {
      logger.updater.info("Checking for update...");
      this.setPhase("checking");
      this.emit("checking-for-update");
    });

    autoUpdater.on("update-available", () => {
      logger.updater.info("Update available, downloading...");
      // Reset so isDownloaded() only reflects the current download
      this.staged = false;
      this.setPhase("downloading");
      this.emit("update-available");
    });

    autoUpdater.on("update-not-available", () => {
      logger.updater.info("No update available");
      if (this.applyPendingChannelIfNeeded("native_not_available")) {
        return;
      }
      this.setPhase("idle");
      this.emit("update-not-available");
    });

    autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
      if (this.applyPendingChannelIfNeeded("native_downloaded")) {
        logger.updater.info(
          "Ignoring downloaded update from deferred channel",
          {
            releaseName,
          },
        );
        return;
      }
      this.staged = true;
      this.setPhase("idle");
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
    return this.publicState;
  }

  getUpdatePrompt(): UpdatePrompt | null {
    return computeUpdatePrompt(
      this.lastMetadata,
      this.staged,
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
    return this.staged;
  }

  private async fetchUpdateMetadata(): Promise<UpdateMetadata | null> {
    const platform = process.platform;
    const arch = process.arch;
    // Always use the running version for metadata so the server evaluates
    // policy against what the user is actually running, not what's downloaded.
    const url = `${UPDATE_SERVER}/update-meta/${this.currentChannel}/${platform}-${arch}/${app.getVersion()}`;

    // Anonymous, stable per-install id so the server can bucket this install
    // for staged rollouts. Omit the header entirely if the id isn't ready yet
    // (telemetry initializes machineId asynchronously) — the server then treats
    // the install as unbucketed and applies default policy.
    const deviceId = this.telemetryService?.getMachineId();

    try {
      const response = await net.fetch(url, {
        headers: {
          "User-Agent": getUserAgent(),
          ...getAmicalClientHeaders(),
          ...(deviceId ? { [AMICAL_DEVICE_ID_HEADER]: deviceId } : {}),
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
    if (!app.isPackaged) {
      logger.updater.info("Skipping update check: app is not packaged");
      return;
    }

    if (this.isCheckingOrDownloading) {
      logger.updater.info("Update check already in progress, skipping");
      return;
    }

    // Manual checks should keep the visible action on "Restart to Install"
    // once an update is staged. Background checks may still run to discover
    // newer releases.
    if (userInitiated && this.staged) {
      logger.updater.info("Update already downloaded, skipping manual check");
      this.setPhase("idle");
      return;
    }

    try {
      this.setPhase("checking");
      logger.updater.info("Checking for updates", { userInitiated });

      // Fetch metadata to determine UI behavior. Only update lastMetadata
      // on success — transient failures preserve the previous policy so a
      // pending prompt/force isn't silently dropped.
      const metadata = await this.fetchUpdateMetadata();
      // A channel change during the fetch supersedes this result. Apply the
      // pending channel and let the next manual or scheduled check use it.
      if (this.applyPendingChannelIfNeeded("metadata_superseded")) {
        logger.updater.info("Update check superseded, discarding stale result");
        return;
      }
      if (metadata) {
        this.lastMetadata = metadata;
        this.emit("update-prompt-changed");

        // Only skip Squirrel check on a fresh "none" response. If the fetch
        // failed, always proceed so stale cached "none" can't suppress
        // discovery of newly published releases.
        if (metadata.action === "none") {
          this.setPhase("idle");
          this.emit("update-not-available");
          return;
        }
      }

      // Proceed with native update check (uses effectiveVersion in feed URL,
      // so it discovers newer releases even if one is already downloaded).
      autoUpdater.checkForUpdates();
    } catch (error) {
      logger.updater.error("Failed to check for updates", { error });
      this.failOrPreserveStaged("check_failed");
    }
  }

  quitAndInstall(): void {
    if (!this.staged) {
      logger.updater.warn("Skipping install: update is not downloaded", {
        state: this.publicState,
      });
      return;
    }

    logger.updater.info("Quitting and installing update");
    autoUpdater.quitAndInstall();
  }

  cleanup(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
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
