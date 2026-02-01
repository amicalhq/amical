import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { app, nativeImage } from "electron";
import { isMacOS } from "../utils/platform";

const execFileAsync = promisify(execFile);

export interface InstalledApp {
  name: string;
  bundleId: string;
  icon: string;
}

interface ScannedApp {
  name: string;
  bundleId: string;
  appPath: string;
  iconPath: string | null;
}

const CONCURRENCY = 5;

export class InstalledAppsService {
  private iconCache = new Map<string, string>();

  async getInstalledApps(): Promise<InstalledApp[]> {
    const apps = await this.scanAndSort();
    const results: InstalledApp[] = [];

    for (let i = 0; i < apps.length; i += CONCURRENCY) {
      const chunk = apps.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.allSettled(
        chunk.map(async (a) => ({
          name: a.name,
          bundleId: a.bundleId,
          icon: await this.getIconAsDataUrl(a.appPath, a.iconPath),
        })),
      );

      for (const r of chunkResults) {
        if (r.status === "fulfilled") {
          results.push(r.value);
        }
      }
    }

    return results;
  }

  /**
   * macOS 15 workaround: app.getFileIcon returns generic "blueprint" icons.
   * Convert .icns to PNG via sips, then load with nativeImage.
   */
  private async getIconAsDataUrl(
    appPath: string,
    iconPath: string | null,
  ): Promise<string> {
    const cached = this.iconCache.get(appPath);
    if (cached) return cached;

    let dataUrl: string | undefined;

    if (process.platform === "darwin" && iconPath) {
      let tempPng: string | null = null;
      try {
        tempPng = path.join(
          os.tmpdir(),
          `amical-icon-${crypto.randomUUID()}.png`,
        );

        await execFileAsync("sips", [
          "-s",
          "format",
          "png",
          "-z",
          "64",
          "64",
          iconPath,
          "--out",
          tempPng,
        ]);

        const buffer = await fs.readFile(tempPng);
        const image = nativeImage.createFromBuffer(buffer);

        if (!image.isEmpty()) {
          dataUrl = image.toDataURL();
        }
      } catch {
        // Fall back to default Electron API
      } finally {
        if (tempPng) {
          await fs.rm(tempPng, { force: true }).catch(() => {});
        }
      }
    }

    if (!dataUrl) {
      const image = await app.getFileIcon(appPath, { size: "normal" });
      dataUrl = image.toDataURL();
    }

    this.iconCache.set(appPath, dataUrl);
    return dataUrl;
  }

  private async scanAndSort(): Promise<ScannedApp[]> {
    if (!isMacOS()) {
      return [];
    }

    const dirs = ["/Applications"];
    const results: ScannedApp[] = [];

    for (const dir of dirs) {
      try {
        const entries = await fs.readdir(dir);
        const appEntries = entries.filter((e) => e.endsWith(".app"));

        const settled = await Promise.allSettled(
          appEntries.map((entry) => this.readPlist(path.join(dir, entry))),
        );

        for (const result of settled) {
          if (result.status === "fulfilled" && result.value) {
            results.push(result.value);
          }
        }
      } catch {
        // Directory not found or inaccessible, skip
      }
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  private async readPlist(appPath: string): Promise<ScannedApp | null> {
    const plistPath = path.join(appPath, "Contents", "Info.plist");
    try {
      const { stdout } = await execFileAsync("plutil", [
        "-convert",
        "json",
        "-o",
        "-",
        plistPath,
      ]);
      const plist = JSON.parse(stdout);
      const bundleId = plist.CFBundleIdentifier;
      if (!bundleId) return null;

      const name =
        plist.CFBundleDisplayName ||
        plist.CFBundleName ||
        path.basename(appPath, ".app");

      // Resolve icon path from CFBundleIconFile / CFBundleIconName
      const iconFile = plist.CFBundleIconFile || plist.CFBundleIconName;
      let iconPath: string | null = null;
      if (iconFile) {
        const iconName = iconFile.endsWith(".icns")
          ? iconFile
          : `${iconFile}.icns`;
        iconPath = path.join(appPath, "Contents", "Resources", iconName);
      }

      return { name, bundleId, appPath, iconPath };
    } catch {
      return null;
    }
  }
}
