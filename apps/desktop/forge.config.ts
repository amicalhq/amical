import "dotenv/config";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { PublisherGithub } from "@electron-forge/publisher-github";
import {
  readdirSync,
  rmdirSync,
  statSync,
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join, normalize } from "node:path";
// Use flora-colossus for finding all dependencies of EXTERNAL_DEPENDENCIES
// flora-colossus is maintained by MarshallOfSound (a top electron-forge contributor)
// already included as a dependency of electron-packager/galactus (so we do NOT have to add it to package.json)
// grabs nested dependencies from tree
import { Walker, DepType, type Module } from "flora-colossus";

let nativeModuleDependenciesToPackage: string[] = [];

export const EXTERNAL_DEPENDENCIES = [
  "electron-squirrel-startup",
  "smart-whisper",
  "@libsql/client",
  "@libsql/darwin-arm64",
  "@libsql/darwin-x64",
  "@libsql/linux-x64-gnu",
  "@libsql/linux-x64-musl",
  "@libsql/win32-x64-msvc",
  "libsql",
  "onnxruntime-node",
  "workerpool",
  // Add any other native modules you need here
];

const config: ForgeConfig = {
  hooks: {
    prePackage: async (_forgeConfig, platform, arch) => {
      console.error("prePackage", { platform, arch });
      const projectRoot = normalize(__dirname);
      // In a monorepo, node_modules are typically at the root level
      const monorepoRoot = join(projectRoot, "../../"); // Go up to monorepo root

      // Copy platform-specific Node.js binary
      console.log(`Copying Node.js binary for ${platform}-${arch}...`);
      const nodeBinarySource = join(
        projectRoot,
        "node-binaries",
        `${platform}-${arch}`,
        platform === "win32" ? "node.exe" : "node",
      );
      const nodeBinaryDest = join(
        projectRoot,
        "node-binaries",
        `${platform}-${arch}`,
      );

      // Check if the binary exists
      if (existsSync(nodeBinarySource)) {
        // Ensure destination directory exists
        if (!existsSync(nodeBinaryDest)) {
          mkdirSync(nodeBinaryDest, { recursive: true });
        }
        console.log(`✓ Node.js binary found for ${platform}-${arch}`);
      } else {
        console.error(
          `✗ Node.js binary not found for ${platform}-${arch} at ${nodeBinarySource}`,
        );
        console.error(
          `  Please run 'pnpm download-node' or 'pnpm download-node:all' first`,
        );
        throw new Error(`Missing Node.js binary for ${platform}-${arch}`);
      }

      const getExternalNestedDependencies = async (
        nodeModuleNames: string[],
        includeNestedDeps = true,
      ) => {
        const foundModules = new Set(nodeModuleNames);
        if (includeNestedDeps) {
          for (const external of nodeModuleNames) {
            type MyPublicClass<T> = {
              [P in keyof T]: T[P];
            };
            type MyPublicWalker = MyPublicClass<Walker> & {
              modules: Module[];
              walkDependenciesForModule: (
                moduleRoot: string,
                depType: DepType,
              ) => Promise<void>;
            };
            const moduleRoot = join(monorepoRoot, "node_modules", external);
            console.log("moduleRoot", moduleRoot);
            // Initialize Walker with monorepo root as base path
            const walker = new Walker(
              monorepoRoot,
            ) as unknown as MyPublicWalker;
            walker.modules = [];
            await walker.walkDependenciesForModule(moduleRoot, DepType.PROD);
            walker.modules
              .filter(
                (dep) => (dep.nativeModuleType as number) === DepType.PROD,
              )
              // Remove the problematic name splitting that breaks scoped packages
              .map((dep) => dep.name)
              .forEach((name) => foundModules.add(name));
          }
        }
        return foundModules;
      };

      const nativeModuleDependencies = await getExternalNestedDependencies(
        EXTERNAL_DEPENDENCIES,
      );
      nativeModuleDependenciesToPackage = Array.from(nativeModuleDependencies);

      // Copy external dependencies to local node_modules
      console.error("Copying external dependencies to local node_modules");
      const localNodeModules = join(projectRoot, "node_modules");
      const rootNodeModules = join(monorepoRoot, "node_modules");

      // Ensure local node_modules directory exists
      if (!existsSync(localNodeModules)) {
        mkdirSync(localNodeModules, { recursive: true });
      }

      console.log(
        `Found ${nativeModuleDependenciesToPackage.length} dependencies to copy`,
      );

      // Copy all required dependencies
      for (const dep of nativeModuleDependenciesToPackage) {
        const rootDepPath = join(rootNodeModules, dep);
        const localDepPath = join(localNodeModules, dep);

        try {
          // Skip if source doesn't exist
          if (!existsSync(rootDepPath)) {
            console.log(`Skipping ${dep}: not found in root node_modules`);
            continue;
          }

          // Skip if target already exists (don't override)
          if (existsSync(localDepPath)) {
            console.log(`Skipping ${dep}: already exists locally`);
            continue;
          }

          // Copy the package
          console.log(`Copying ${dep}...`);
          cpSync(rootDepPath, localDepPath, { recursive: true });
          console.log(`✓ Successfully copied ${dep}`);
        } catch (error) {
          console.error(`Failed to copy ${dep}:`, error);
        }
      }

      // Prune onnxruntime-node to keep only the required binary
      console.log("Pruning onnxruntime-node binaries...");
      const onnxBinRoot = join(localNodeModules, "onnxruntime-node", "bin");
      if (existsSync(onnxBinRoot)) {
        const napiVersionDirs = readdirSync(onnxBinRoot);
        for (const napiVersionDir of napiVersionDirs) {
          const napiVersionPath = join(onnxBinRoot, napiVersionDir);
          if (!statSync(napiVersionPath).isDirectory()) continue;

          const platformDirs = readdirSync(napiVersionPath);
          for (const platformDir of platformDirs) {
            const platformPath = join(napiVersionPath, platformDir);
            if (!statSync(platformPath).isDirectory()) continue;

            // Delete other platform directories
            if (platformDir !== process.platform) {
              console.log(`- Deleting unused platform: ${platformPath}`);
              rmSync(platformPath, { recursive: true, force: true });
            } else {
              // Now in the correct platform dir, prune architectures
              const archDirs = readdirSync(platformPath);
              for (const archDir of archDirs) {
                const archPath = join(platformPath, archDir);
                if (!statSync(archPath).isDirectory()) continue;

                if (archDir !== process.arch) {
                  console.log(`- Deleting unused arch: ${archPath}`);
                  rmSync(archPath, { recursive: true, force: true });
                }
              }
            }
          }
        }
        console.log("✓ Finished pruning onnxruntime-node.");
      } else {
        console.log(
          "Skipping onnxruntime-node pruning, bin directory not found.",
        );
      }
    },
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      try {
        function getItemsFromFolder(
          path: string,
          totalCollection: {
            path: string;
            type: "directory" | "file";
            empty: boolean;
          }[] = [],
        ) {
          try {
            const normalizedPath = normalize(path);
            const childItems = readdirSync(normalizedPath);
            const getItemStats = statSync(normalizedPath);
            if (getItemStats.isDirectory()) {
              totalCollection.push({
                path: normalizedPath,
                type: "directory",
                empty: childItems.length === 0,
              });
            }
            childItems.forEach((childItem) => {
              const childItemNormalizedPath = join(normalizedPath, childItem);
              const childItemStats = statSync(childItemNormalizedPath);
              if (childItemStats.isDirectory()) {
                getItemsFromFolder(childItemNormalizedPath, totalCollection);
              } else {
                totalCollection.push({
                  path: childItemNormalizedPath,
                  type: "file",
                  empty: false,
                });
              }
            });
          } catch {
            return;
          }
          return totalCollection;
        }
        const getItems = getItemsFromFolder(buildPath) ?? [];
        for (const item of getItems) {
          const DELETE_EMPTY_DIRECTORIES = true;
          if (item.empty === true) {
            if (DELETE_EMPTY_DIRECTORIES) {
              const pathToDelete = normalize(item.path);
              // one last check to make sure it is a directory and is empty
              const stats = statSync(pathToDelete);
              if (!stats.isDirectory()) {
                // SKIPPING DELETION: pathToDelete is not a directory
                return;
              }
              const childItems = readdirSync(pathToDelete);
              if (childItems.length !== 0) {
                // SKIPPING DELETION: pathToDelete is not empty
                return;
              }
              rmdirSync(pathToDelete);
            }
          }
        }
      } catch (error) {
        console.error("Error in packageAfterPrune:", error);
        throw error;
      }
    },
  },
  packagerConfig: {
    asar: {
      unpack:
        "{*.node,*.dylib,*.so,*.dll,*.metal,**/whisper.cpp/**,**/.vite/build/whisper-worker-fork.js,**/node_modules/smart-whisper/**,**/node_modules/jest-worker/**}",
    },
    name: "Amical",
    executableName: "Amical",
    icon: "./assets/logo", // Path to your icon file
    appBundleId: "com.amical.desktop", // Proper bundle ID
    extraResource: [
      "../../packages/native-helpers/swift-helper/bin",
      "./src/db/migrations",
      "./node-binaries",
      "./models",
      "./src/assets",
    ],
    extendInfo: {
      NSMicrophoneUsageDescription:
        "This app needs access to your microphone to record audio for transcription.",
    },
    // Code signing configuration for macOS
    ...(process.env.SKIP_CODESIGNING === "true"
      ? {}
      : {
          osxSign: {
            identity: process.env.CODESIGNING_IDENTITY,
          },
          // Notarization for macOS
          ...(process.env.SKIP_NOTARIZATION === "true"
            ? {}
            : {
                osxNotarize: {
                  appleId: process.env.APPLE_ID!,
                  appleIdPassword: process.env.APPLE_APP_PASSWORD!,
                  teamId: process.env.APPLE_TEAM_ID!,
                },
              }),
        }),
    //! issues with monorepo setup and module resolutions
    //! when forge walks paths via flora-colossus
    prune: false,
    ignore: (file: string) => {
      try {
        const filePath = file.toLowerCase();
        const KEEP_FILE = {
          keep: false,
          log: true,
        };
        // NOTE: must return false for empty string or nothing will be packaged
        if (filePath === "") KEEP_FILE.keep = true;
        if (!KEEP_FILE.keep && filePath === "/package.json")
          KEEP_FILE.keep = true;
        if (!KEEP_FILE.keep && filePath === "/node_modules")
          KEEP_FILE.keep = true;
        if (!KEEP_FILE.keep && filePath === "/.vite") KEEP_FILE.keep = true;
        if (!KEEP_FILE.keep && filePath.startsWith("/.vite/"))
          KEEP_FILE.keep = true;
        if (!KEEP_FILE.keep && filePath.startsWith("/node_modules/")) {
          // check if matches any of the external dependencies
          for (const dep of nativeModuleDependenciesToPackage) {
            if (
              filePath === `/node_modules/${dep}/` ||
              filePath === `/node_modules/${dep}`
            ) {
              KEEP_FILE.keep = true;
              break;
            }
            if (filePath === `/node_modules/${dep}/package.json`) {
              KEEP_FILE.keep = true;
              break;
            }
            if (filePath.startsWith(`/node_modules/${dep}/`)) {
              KEEP_FILE.keep = true;
              KEEP_FILE.log = false;
              break;
            }

            // Handle scoped packages: if dep is @scope/package, also keep @scope/ directory
            if (dep.includes("/") && dep.startsWith("@")) {
              const scopeDir = dep.split("/")[0]; // @libsql/client -> @libsql
              if (
                filePath === `/node_modules/${scopeDir}/` ||
                filePath === `/node_modules/${scopeDir}` ||
                filePath.startsWith(`/node_modules/${scopeDir}/`)
              ) {
                KEEP_FILE.keep = true;
                KEEP_FILE.log =
                  filePath === `/node_modules/${scopeDir}/` ||
                  filePath === `/node_modules/${scopeDir}`;
                break;
              }
            }
          }
        }
        if (KEEP_FILE.keep) {
          if (KEEP_FILE.log) console.log("Keeping:", file);
          return false;
        }
        return true;
      } catch (error) {
        console.error("Error in ignore:", error);
        throw error;
      }
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "Amical",
      setupIcon: "./assets/logo.ico",
    }),
    new MakerZIP(
      {
        // macOS ZIP files will be named like: Amical-darwin-arm64-1.0.0.zip
        // The default naming includes platform and arch, which is good for auto-updates
      },
      ["darwin"],
    ), // Required for macOS auto-updates
    new MakerDMG(
      {
        //! @see https://github.com/electron/forge/issues/3517#issuecomment-2428129194
        // macOS DMG files will be named like: Amical-0.0.1-arm64.dmg
        icon: "./assets/logo.icns",
        background: "./assets/dmg_bg.tiff",
      },
      ["darwin"],
    ),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main/main.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "src/main/preload.ts",
          config: "vite.preload.config.mts",
          target: "preload",
        },
        {
          entry: "src/main/onboarding-preload.ts",
          config: "vite.onboarding-preload.config.mts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
        {
          name: "widget_window",
          config: "vite.widget.config.mts",
        },
        {
          name: "onboarding_window",
          config: "vite.onboarding.config.mts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: "amicalhq",
        name: "amical",
      },
      prerelease: true,
      draft: true, // Create draft releases first for review
    }),
  ],
};

export default config;
