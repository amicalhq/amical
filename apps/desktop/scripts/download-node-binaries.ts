#!/usr/bin/env tsx

import * as https from "node:https";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createWriteStream, mkdirSync, chmodSync } from "node:fs";

// Node.js version to download
const NODE_VERSION = "22.17.0";

// Platform/arch types
type Platform = "darwin" | "win32" | "linux";
type Architecture = "arm64" | "x64";

interface PlatformConfig {
  platform: Platform;
  arch: Architecture;
  url: string;
  binary: string;
}

// Platform configurations
const PLATFORMS: PlatformConfig[] = [
  {
    platform: "darwin",
    arch: "arm64",
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    binary: "bin/node",
  },
  {
    platform: "darwin",
    arch: "x64",
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    binary: "bin/node",
  },
  {
    platform: "win32",
    arch: "x64",
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
    binary: "node.exe",
  },
  {
    platform: "linux",
    arch: "x64",
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`,
    binary: "bin/node",
  },
];

const RESOURCES_DIR = path.join(__dirname, "..", "node-binaries");

// Parse command line arguments
const args = process.argv.slice(2);
const downloadAll = args.includes("--all");

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);

    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error("Redirect without location header"));
            return;
          }
          https
            .get(redirectUrl, async (redirectResponse) => {
              if (redirectResponse.statusCode !== 200) {
                reject(
                  new Error(
                    `Failed to download: ${redirectResponse.statusCode}`,
                  ),
                );
                return;
              }

              // Show download progress
              const totalSize = parseInt(
                redirectResponse.headers["content-length"] || "0",
                10,
              );
              let downloadedSize = 0;

              redirectResponse.on("data", (chunk) => {
                downloadedSize += chunk.length;
                if (totalSize > 0) {
                  const percent = Math.round(
                    (downloadedSize / totalSize) * 100,
                  );
                  process.stdout.write(`\r  Downloading: ${percent}%`);
                }
              });

              await pipeline(redirectResponse, file);
              process.stdout.write("\n");
              resolve();
            })
            .on("error", reject);
        } else if (response.statusCode === 200) {
          // Direct download
          const totalSize = parseInt(
            response.headers["content-length"] || "0",
            10,
          );
          let downloadedSize = 0;

          response.on("data", (chunk) => {
            downloadedSize += chunk.length;
            if (totalSize > 0) {
              const percent = Math.round((downloadedSize / totalSize) * 100);
              process.stdout.write(`\r  Downloading: ${percent}%`);
            }
          });

          pipeline(response, file)
            .then(() => {
              process.stdout.write("\n");
              resolve();
            })
            .catch(reject);
        } else {
          reject(new Error(`Failed to download: ${response.statusCode}`));
        }
      })
      .on("error", reject);
  });
}

async function extractArchive(
  archivePath: string,
  platform: Platform,
): Promise<string> {
  const tempDir = path.join(path.dirname(archivePath), "temp");
  mkdirSync(tempDir, { recursive: true });

  console.log("  Extracting archive...");

  if (platform === "win32") {
    // Use unzip command (available on macOS) to extract zip files
    execSync(
      `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tempDir}' -Force"`,
      { stdio: "inherit" },
    );
  } else {
    // Use tar for Unix-like systems
    execSync(`tar -xzf "${archivePath}" -C "${tempDir}"`, { stdio: "inherit" });
  }

  return tempDir;
}

async function downloadNodeBinary(config: PlatformConfig): Promise<void> {
  const { platform, arch, url, binary } = config;
  const platformDir = path.join(RESOURCES_DIR, `${platform}-${arch}`);
  const binaryPath = path.join(
    platformDir,
    platform === "win32" ? "node.exe" : "node",
  );

  // Skip if already exists
  if (fs.existsSync(binaryPath)) {
    console.log(`✓ ${platform}-${arch} binary already exists`);
    return;
  }

  console.log(`\nDownloading Node.js for ${platform}-${arch}...`);

  // Create directory
  mkdirSync(platformDir, { recursive: true });

  // Download archive
  const archiveExt = platform === "win32" ? ".zip" : ".tar.gz";
  const archivePath = path.join(
    platformDir,
    `node-v${NODE_VERSION}${archiveExt}`,
  );

  try {
    await downloadFile(url, archivePath);
    console.log("  Download complete");

    // Extract archive
    const tempDir = await extractArchive(archivePath, platform);

    // Find the node binary in extracted files
    // Windows uses different directory naming convention (win instead of win32)
    const extractedDirName =
      platform === "win32"
        ? `node-v${NODE_VERSION}-win-${arch}`
        : `node-v${NODE_VERSION}-${platform}-${arch}`;
    const extractedBinaryPath = path.join(tempDir, extractedDirName, binary);

    // Verify binary exists
    if (!fs.existsSync(extractedBinaryPath)) {
      throw new Error(
        `Binary not found at expected path: ${extractedBinaryPath}`,
      );
    }

    // Copy binary to final location
    console.log("  Installing binary...");
    fs.copyFileSync(extractedBinaryPath, binaryPath);

    // Make executable on Unix-like systems
    if (platform !== "win32") {
      chmodSync(binaryPath, "755");
    }

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(archivePath);

    console.log(`✓ Successfully installed ${platform}-${arch} binary`);
  } catch (error) {
    console.error(
      `✗ Failed to download ${platform}-${arch}:`,
      error instanceof Error ? error.message : error,
    );
    // Clean up on failure
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }
    throw error;
  }
}

function getCurrentPlatform(): PlatformConfig | undefined {
  const currentPlatform = process.platform as string;
  const currentArch = process.arch as string;

  return PLATFORMS.find(
    (p) => p.platform === currentPlatform && p.arch === currentArch,
  );
}

async function main() {
  console.log(`Node.js Binary Downloader v${NODE_VERSION}`);
  console.log("=====================================\n");

  // Create base directory
  mkdirSync(RESOURCES_DIR, { recursive: true });

  if (downloadAll) {
    console.log("Mode: Download all platforms\n");

    // Download binaries for all platforms
    let success = 0;
    let failed = 0;

    for (const platform of PLATFORMS) {
      try {
        await downloadNodeBinary(platform);
        success++;
      } catch (error) {
        failed++;
      }
    }

    console.log(`\nSummary: ${success} succeeded, ${failed} failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } else {
    console.log("Mode: Download current platform only\n");

    // Download only for current platform
    const currentPlatform = getCurrentPlatform();

    if (!currentPlatform) {
      console.error(
        `✗ Unsupported platform: ${process.platform}-${process.arch}`,
      );
      console.error("  Supported platforms:");
      PLATFORMS.forEach((p) => {
        console.error(`    - ${p.platform}-${p.arch}`);
      });
      process.exit(1);
    }

    await downloadNodeBinary(currentPlatform);
  }

  console.log("\nDone! Node.js binaries available at:", RESOURCES_DIR);
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error("\nFatal error:", error);
    process.exit(1);
  });
}

// Export for potential programmatic use
export { downloadNodeBinary, PLATFORMS, NODE_VERSION, getCurrentPlatform };
