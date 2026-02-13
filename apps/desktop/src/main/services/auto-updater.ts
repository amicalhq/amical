import { app } from "electron";
import { EventEmitter } from "events";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as semver from "semver";
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from "electron-updater";
import type {
  AppPreferences,
  SettingsService,
} from "../../services/settings-service";
import { inferUpdateChannelFromVersion } from "../../utils/update-channel";
import { logger } from "../logger";

const BACKGROUND_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_GITHUB_UPDATE_OWNER = "amicalhq";
const DEFAULT_GITHUB_UPDATE_REPO = "amical";
const GITHUB_API_BASE_URL = "https://api.github.com";
const UPDATER_BRIDGE_USER_AGENT = "amical-desktop-updater";
const UPDATER_BRIDGE_TEMP_DIR = "amical-updater-bridge";
const BRIDGE_INSTALLER_FILENAME = "amical-updater-bridge-installer.exe";
const SAFE_INSTALLER_ASSET_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/i;
const INITIAL_UPDATE_CHECK_DELAY_MS = 10_000;
const BRIDGE_INSTALLER_LAUNCH_SETTLE_MS = 500;

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubReleaseAsset[];
}

interface WindowsInstallerMetadata {
  installerName: string;
  sha512?: string;
}

function mapChannelForUpdater(
  channel: NonNullable<AppPreferences["updateChannel"]>,
): string {
  if (channel === "stable") {
    return "latest";
  }
  return channel;
}

export class AutoUpdaterService extends EventEmitter {
  private settingsService: SettingsService;
  private initialized = false;
  private checkingForUpdate = false;
  private updateAvailable = false;
  private autoUpdatesEnabled = true;
  private periodicCheckTimer: NodeJS.Timeout | null = null;
  private listenersRegistered = false;
  private bridgeMigrationInProgress = false;
  private bridgeMigrationAttempted = false;

  private handleCheckingForUpdate = () => {
    logger.updater.info("Checking for updates");
  };

  private handleUpdateAvailable = (info: UpdateInfo) => {
    this.updateAvailable = true;
    logger.updater.info("Update available", { version: info.version });
  };

  private handleUpdateNotAvailable = () => {
    this.updateAvailable = false;
    logger.updater.info("No update available");
  };

  private handleDownloadProgress = (progress: ProgressInfo) => {
    this.emit("download-progress", progress);
  };

  private handleUpdateDownloaded = (info: UpdateInfo) => {
    this.updateAvailable = true;
    logger.updater.info("Update downloaded", { version: info.version });
  };

  private handleUpdaterError = (error: Error) => {
    logger.updater.error("Auto-updater error", {
      error: error.message,
    });
  };

  constructor(settingsService: SettingsService) {
    super();
    this.settingsService = settingsService;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      if (!app.isPackaged || process.env.NODE_ENV === "development") {
        logger.updater.info(
          "Auto-updater disabled for development/unpackaged builds",
        );
        this.initialized = true;
        return;
      }

      await this.cleanupStaleBridgeInstaller();
      this.configureFeed();
      this.registerEventHandlers();
      await this.refreshConfiguration();

      if (this.autoUpdatesEnabled) {
        this.scheduleInitialUpdateCheck();
      }

      this.initialized = true;
    } catch (error) {
      this.initialized = false;
      this.cleanup();
      throw error;
    }
  }

  async refreshConfiguration(): Promise<void> {
    const preferences = await this.settingsService.getPreferences();
    this.autoUpdatesEnabled = preferences.autoUpdatesEnabled ?? true;

    const channel =
      preferences.updateChannel ??
      inferUpdateChannelFromVersion(app.getVersion());
    autoUpdater.channel = mapChannelForUpdater(channel);
    autoUpdater.allowPrerelease = channel !== "stable";

    if (this.autoUpdatesEnabled) {
      this.startPeriodicChecks();
    } else {
      this.stopPeriodicChecks();
    }

    logger.updater.info("Updater configuration refreshed", {
      autoUpdatesEnabled: this.autoUpdatesEnabled,
      channel,
      updaterChannel: autoUpdater.channel,
      allowPrerelease: autoUpdater.allowPrerelease,
    });
  }

  async checkForUpdates(userInitiated = false): Promise<void> {
    if (!app.isPackaged || process.env.NODE_ENV === "development") {
      logger.updater.info(
        "Skipping update check in development/unpackaged mode",
      );
      return;
    }

    if (!this.autoUpdatesEnabled && !userInitiated) {
      logger.updater.info(
        "Skipping background update check because auto updates are disabled",
      );
      return;
    }

    if (this.checkingForUpdate) {
      logger.updater.info("Update check already in progress");
      return;
    }

    this.checkingForUpdate = true;
    try {
      if (this.isLegacySquirrelWindowsInstall()) {
        await this.runWindowsBridgeMigration();
        return;
      }

      await autoUpdater.checkForUpdates();
    } catch (error) {
      logger.updater.error("Update check failed", {
        userInitiated,
        error: error instanceof Error ? error.message : String(error),
      });
      if (userInitiated) {
        throw error;
      }
    } finally {
      this.checkingForUpdate = false;
    }
  }

  async checkForUpdatesAndNotify(): Promise<void> {
    await this.checkForUpdates(false);
  }

  isCheckingForUpdate(): boolean {
    return this.checkingForUpdate;
  }

  isUpdateAvailable(): boolean {
    return this.updateAvailable;
  }

  async downloadUpdate(): Promise<void> {
    if (!app.isPackaged || process.env.NODE_ENV === "development") {
      logger.updater.info(
        "Skipping update download in development/unpackaged mode",
      );
      return;
    }

    await autoUpdater.downloadUpdate();
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true);
  }

  cleanup(): void {
    this.stopPeriodicChecks();
    this.checkingForUpdate = false;

    if (!this.listenersRegistered) {
      return;
    }
    this.listenersRegistered = false;

    autoUpdater.removeListener(
      "checking-for-update",
      this.handleCheckingForUpdate,
    );
    autoUpdater.removeListener("update-available", this.handleUpdateAvailable);
    autoUpdater.removeListener(
      "update-not-available",
      this.handleUpdateNotAvailable,
    );
    autoUpdater.removeListener(
      "download-progress",
      this.handleDownloadProgress,
    );
    autoUpdater.removeListener(
      "update-downloaded",
      this.handleUpdateDownloaded,
    );
    autoUpdater.removeListener("error", this.handleUpdaterError);
  }

  private configureFeed(): void {
    const { owner, repo } = this.getFeedConfiguration();

    autoUpdater.setFeedURL({
      provider: "github",
      owner,
      repo,
    });

    logger.updater.info("Updater feed configured", {
      provider: "github",
      owner,
      repo,
    });
  }

  private scheduleInitialUpdateCheck(): void {
    const timer = setTimeout(() => {
      void this.checkForUpdates(false);
    }, INITIAL_UPDATE_CHECK_DELAY_MS);

    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  private getBridgeTempDirectoryPath(): string {
    return path.join(app.getPath("temp"), UPDATER_BRIDGE_TEMP_DIR);
  }

  private getBridgeInstallerPath(): string {
    return path.join(
      this.getBridgeTempDirectoryPath(),
      BRIDGE_INSTALLER_FILENAME,
    );
  }

  private async cleanupStaleBridgeInstaller(): Promise<void> {
    if (process.platform !== "win32") {
      return;
    }

    const staleInstallerPath = this.getBridgeInstallerPath();
    try {
      await unlink(staleInstallerPath);
      logger.updater.info("Removed stale bridge installer", {
        installerPath: staleInstallerPath,
      });
    } catch (error) {
      const errorCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : "";
      if (errorCode !== "ENOENT") {
        logger.updater.warn("Failed to remove stale bridge installer", {
          installerPath: staleInstallerPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private getFeedConfiguration(): { owner: string; repo: string } {
    const owner =
      process.env.UPDATER_GITHUB_OWNER?.trim() || DEFAULT_GITHUB_UPDATE_OWNER;
    const repo =
      process.env.UPDATER_GITHUB_REPO?.trim() || DEFAULT_GITHUB_UPDATE_REPO;

    return { owner, repo };
  }

  private isLegacySquirrelWindowsInstall(): boolean {
    if (process.platform !== "win32") {
      return false;
    }

    const executablePath = app.getPath("exe");
    const hasSquirrelAppSegment = /[\\/]app-/i.test(executablePath);
    if (!hasSquirrelAppSegment) {
      return false;
    }

    const squirrelRoot = path.dirname(path.dirname(executablePath));
    return existsSync(path.join(squirrelRoot, "Update.exe"));
  }

  private async runWindowsBridgeMigration(): Promise<void> {
    if (this.bridgeMigrationInProgress) {
      logger.updater.info("Bridge migration already in progress");
      return;
    }
    if (this.bridgeMigrationAttempted) {
      logger.updater.info(
        "Skipping repeat bridge migration attempt in this session",
      );
      return;
    }

    this.bridgeMigrationInProgress = true;
    this.bridgeMigrationAttempted = true;

    let downloadedInstallerPath: string | null = null;
    try {
      const metadataFile = await this.resolveWindowsMetadataFile();
      const { owner, repo } = this.getFeedConfiguration();
      const release = await this.fetchReleaseForChannel(
        owner,
        repo,
        metadataFile,
      );
      if (!release) {
        throw new Error(
          `No compatible release found for bridge migration metadata "${metadataFile}"`,
        );
      }

      this.assertReleaseIsNotOlderThanCurrentVersion(release.tag_name);

      const metadataAsset = release.assets.find(
        (asset) => asset.name === metadataFile,
      );
      if (!metadataAsset) {
        throw new Error(
          `Release ${release.tag_name} does not contain ${metadataFile}`,
        );
      }

      const metadataText = await this.fetchText(
        metadataAsset.browser_download_url,
      );
      const installerMetadata =
        this.parseWindowsInstallerMetadata(metadataText);
      this.assertSafeInstallerAssetName(installerMetadata.installerName);
      const installerAsset = release.assets.find(
        (asset) => asset.name === installerMetadata.installerName,
      );
      if (!installerAsset) {
        throw new Error(
          `Release ${release.tag_name} does not contain installer ${installerMetadata.installerName}`,
        );
      }

      const tempDirectory = this.getBridgeTempDirectoryPath();
      await mkdir(tempDirectory, { recursive: true });
      downloadedInstallerPath = this.getBridgeInstallerPath();

      logger.updater.info("Downloading NSIS bridge installer", {
        metadataFile,
        releaseTag: release.tag_name,
        installerName: installerAsset.name,
      });
      await this.downloadAsset(
        installerAsset.browser_download_url,
        downloadedInstallerPath,
      );

      if (installerMetadata.sha512) {
        await this.verifySha512(
          downloadedInstallerPath,
          installerMetadata.sha512,
        );
      }

      logger.updater.info("Launching silent NSIS bridge installer", {
        installerPath: downloadedInstallerPath,
      });
      await this.launchSilentNsisInstaller(downloadedInstallerPath);
    } catch (error) {
      logger.updater.error("Windows bridge migration failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (downloadedInstallerPath) {
        await unlink(downloadedInstallerPath).catch(() => {
          // Best-effort cleanup for failed bridge attempts.
        });
      }
    } finally {
      this.bridgeMigrationInProgress = false;
    }
  }

  private async resolveWindowsMetadataFile(): Promise<string> {
    const preferences = await this.settingsService.getPreferences();
    const channel =
      preferences.updateChannel ??
      inferUpdateChannelFromVersion(app.getVersion());
    const updaterChannel = mapChannelForUpdater(channel);
    if (updaterChannel === "latest") {
      return "latest.yml";
    }
    return `${updaterChannel}.yml`;
  }

  private async fetchReleaseForChannel(
    owner: string,
    repo: string,
    metadataFile: string,
  ): Promise<GitHubRelease | null> {
    const releasesUrl = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/releases?per_page=30`;
    const releases = await this.fetchJson<GitHubRelease[]>(releasesUrl);
    const publishedReleases = releases.filter((release) => !release.draft);
    const isStableMetadata = metadataFile === "latest.yml";

    if (isStableMetadata) {
      return (
        publishedReleases.find(
          (release) =>
            !release.prerelease &&
            release.assets.some((asset) => asset.name === metadataFile),
        ) ?? null
      );
    }

    const channel = metadataFile.replace(/\.yml$/i, "");
    return (
      publishedReleases.find(
        (release) =>
          release.prerelease &&
          release.tag_name.toLowerCase().includes(`-${channel}`) &&
          release.assets.some((asset) => asset.name === metadataFile),
      ) ?? null
    );
  }

  private parseWindowsInstallerMetadata(
    metadata: string,
  ): WindowsInstallerMetadata {
    const normalizedMetadata = metadata.replace(/\r\n/g, "\n");
    const fileEntryMatch = normalizedMetadata.match(
      /-\s+url:\s*([^\n]+\.exe)\n\s+sha512:\s*([^\n]+)/i,
    );
    if (fileEntryMatch) {
      return {
        installerName: this.stripYmlValueQuotes(fileEntryMatch[1].trim()),
        sha512: this.stripYmlValueQuotes(fileEntryMatch[2].trim()),
      };
    }

    const fallbackPath = normalizedMetadata.match(
      /^path:\s*([^\n]+\.exe)\s*$/im,
    );
    if (!fallbackPath) {
      throw new Error(
        "Could not parse installer path from windows updater metadata",
      );
    }

    const fallbackSha512 = normalizedMetadata.match(
      /^sha512:\s*([^\n]+)\s*$/im,
    );
    return {
      installerName: this.stripYmlValueQuotes(fallbackPath[1].trim()),
      sha512: fallbackSha512
        ? this.stripYmlValueQuotes(fallbackSha512[1].trim())
        : undefined,
    };
  }

  private stripYmlValueQuotes(value: string): string {
    return value.replace(/^['"]|['"]$/g, "");
  }

  private assertSafeInstallerAssetName(installerName: string): void {
    if (!SAFE_INSTALLER_ASSET_NAME_REGEX.test(installerName)) {
      throw new Error(
        `Unsafe installer asset name in metadata: "${installerName}"`,
      );
    }
  }

  private assertReleaseIsNotOlderThanCurrentVersion(releaseTag: string): void {
    const releaseVersion = this.extractSemverFromTag(releaseTag);
    const currentVersion = this.extractSemverFromTag(app.getVersion());
    if (!releaseVersion || !currentVersion) {
      throw new Error(
        `Unable to compare release version "${releaseTag}" with app version "${app.getVersion()}"`,
      );
    }

    const comparison = semver.compare(releaseVersion, currentVersion);
    if (comparison < 0) {
      throw new Error(
        `Bridge release ${releaseVersion} is older than running app version ${currentVersion}`,
      );
    }
  }

  private extractSemverFromTag(rawVersion: string): string | null {
    const match = rawVersion
      .trim()
      .match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/);
    return match ? semver.valid(match[1]) : null;
  }

  private getGitHubHeaders(): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      "User-Agent": UPDATER_BRIDGE_USER_AGENT,
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: this.getGitHubHeaders() });
    if (!response.ok) {
      throw new Error(
        `GitHub API request failed (${response.status}) for ${url}`,
      );
    }
    return (await response.json()) as T;
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url, { headers: this.getGitHubHeaders() });
    if (!response.ok) {
      throw new Error(`Asset fetch failed (${response.status}) for ${url}`);
    }
    return await response.text();
  }

  private async downloadAsset(
    url: string,
    destinationPath: string,
  ): Promise<void> {
    const response = await fetch(url, { headers: this.getGitHubHeaders() });
    if (!response.ok || !response.body) {
      throw new Error(
        `Installer download failed (${response.status}) for ${url}`,
      );
    }

    const bodyStream = Readable.fromWeb(
      response.body as unknown as import("node:stream/web").ReadableStream,
    );
    const outputFile = createWriteStream(destinationPath);
    await pipeline(bodyStream, outputFile);
  }

  private async verifySha512(
    filePath: string,
    expectedBase64Sha512: string,
  ): Promise<void> {
    const hash = createHash("sha512");
    await pipeline(createReadStream(filePath), hash);

    const actualHash = hash.digest("base64");
    if (actualHash !== expectedBase64Sha512) {
      throw new Error("Installer checksum verification failed");
    }
  }

  private async launchSilentNsisInstaller(
    installerPath: string,
  ): Promise<void> {
    const installerProcess = spawn(installerPath, ["/S"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    await new Promise<void>((resolve, reject) => {
      installerProcess.once("spawn", () => resolve());
      installerProcess.once("error", (error) => {
        reject(
          new Error(
            `Failed to launch silent NSIS bridge installer: ${error.message}`,
          ),
        );
      });
    });

    installerProcess.unref();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, BRIDGE_INSTALLER_LAUNCH_SETTLE_MS);
    });
    app.quit();
  }

  private registerEventHandlers(): void {
    if (this.listenersRegistered) {
      return;
    }
    this.listenersRegistered = true;

    autoUpdater.on("checking-for-update", this.handleCheckingForUpdate);
    autoUpdater.on("update-available", this.handleUpdateAvailable);
    autoUpdater.on("update-not-available", this.handleUpdateNotAvailable);
    autoUpdater.on("download-progress", this.handleDownloadProgress);
    autoUpdater.on("update-downloaded", this.handleUpdateDownloaded);
    autoUpdater.on("error", this.handleUpdaterError);
  }

  private startPeriodicChecks(): void {
    if (this.periodicCheckTimer) {
      return;
    }

    this.periodicCheckTimer = setInterval(() => {
      void this.checkForUpdates(false);
    }, BACKGROUND_CHECK_INTERVAL_MS);
    if (typeof this.periodicCheckTimer.unref === "function") {
      this.periodicCheckTimer.unref();
    }
  }

  private stopPeriodicChecks(): void {
    if (!this.periodicCheckTimer) {
      return;
    }

    clearInterval(this.periodicCheckTimer);
    this.periodicCheckTimer = null;
  }
}
