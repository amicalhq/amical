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
  lstatSync,
  readlinkSync,
  copyFileSync,
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
  "@libsql/client",
  "@libsql/darwin-arm64",
  "@libsql/darwin-x64",
  "@libsql/linux-x64-gnu",
  "@libsql/linux-x64-musl",
  "@libsql/win32-x64-msvc",
  "libsql",
  "onnxruntime-node",
  "@amical/whisper-wrapper",
  // Add any other native modules you need here
];

const config: ForgeConfig = {
  hooks: {
    prePackage: async (_forgeConfig, platform, arch) => {
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

      // Check if the binary exists
      if (existsSync(nodeBinarySource)) {
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
          cpSync(rootDepPath, localDepPath, {
            recursive: true,
            dereference: true,
            force: true,
          });
          console.log(`✓ Successfully copied ${dep}`);
        } catch (error) {
          console.error(`Failed to copy ${dep}:`, error);
        }
      }

      // Prune heavy native sources that trigger MAX_PATH on Windows packages
      const whisperWrapperPath = join(
        localNodeModules,
        "@amical",
        "whisper-wrapper",
      );
      const whisperPruneTargets = [
        join(whisperWrapperPath, "whisper.cpp"),
        join(whisperWrapperPath, "build"),
        join(whisperWrapperPath, ".cmake-js"),
      ];
      for (const target of whisperPruneTargets) {
        if (existsSync(target)) {
          console.log(`Pruning ${target} from packaged output`);
          rmSync(target, { recursive: true, force: true });
        }
      }

      // Second pass: Replace any symlinks with dereferenced copies
      console.log("Checking for symlinks in copied dependencies...");
      for (const dep of nativeModuleDependenciesToPackage) {
        const localDepPath = join(localNodeModules, dep);

        try {
          if (existsSync(localDepPath)) {
            const stats = lstatSync(localDepPath);
            if (stats.isSymbolicLink()) {
              console.log(
                `Found symlink for ${dep}, replacing with dereferenced copy...`,
              );

              // Read where the symlink points to
              const symlinkTarget = readlinkSync(localDepPath);
              let absoluteTarget = symlinkTarget;
              if (process.platform !== "win32") {
                absoluteTarget = join(localDepPath, "..", symlinkTarget);
              }
              const sourcePath = normalize(absoluteTarget);

              console.log(`  Symlink points to: ${sourcePath}`);

              // Remove the symlink
              rmSync(localDepPath, { recursive: true, force: true });

              // Copy with dereference to get actual content
              cpSync(sourcePath, localDepPath, {
                recursive: true,
                force: true,
                dereference: true, // Follow symlinks and copy actual content
              });

              console.log(
                `✓ Successfully replaced symlink for ${dep} with actual content`,
              );
            }
          }
        } catch (error) {
          console.error(`Failed to check/replace symlink for ${dep}:`, error);
        }
      }

      // Prune onnxruntime-node to keep only the required binary
      const targetPlatform = platform;
      const targetArch = arch;

      console.log(
        `Pruning onnxruntime-node binaries for ${targetPlatform}/${targetArch}...`,
      );
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

            // Delete unused platforms except Linux (keep for compatibility)
            if (platformDir !== targetPlatform && platformDir !== "linux") {
              console.log(`- Deleting unused platform: ${platformPath}`);
              rmSync(platformPath, { recursive: true, force: true });
            } else if (platformDir === targetPlatform) {
              // Now in the correct platform dir, prune architectures
              const archDirs = readdirSync(platformPath);
              for (const archDir of archDirs) {
                const archPath = join(platformPath, archDir);
                if (!statSync(archPath).isDirectory()) continue;

                if (archDir !== targetArch) {
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
    // NOTE: This hook does NOT run when prune: false is set in packagerConfig (line 467).
    // The empty directory cleanup code below is currently dead code.
    // DLL bundling has been moved to postPackage which always runs.
    packageAfterPrune: async (
      _forgeConfig,
      buildPath,
      _electronVersion,
      _platform,
    ) => {
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
    postPackage: async (_forgeConfig, options) => {
      const { outputPaths, platform } = options;
      // =====================================================================
      // Bundle VC++ Runtime DLLs for Windows
      // =====================================================================
      //
      // WHY: onnxruntime-node (used by VAD service for voice activity detection)
      // depends on Visual C++ runtime DLLs. These are NOT bundled by onnxruntime-node
      // and are expected to be installed on the user's system.
      //
      // PROBLEM: Some Windows machines don't have VC++ Redistributable installed,
      // causing "DLL initialization routine failed" errors on app startup.
      //
      // SOLUTION: Bundle the required DLLs from the build machine's System32.
      // Windows DLL search order finds them in the app directory first.
      //
      // REQUIREMENTS:
      // - Build machine must have VC++ runtime (GitHub Actions windows-2025 has VS2022)
      // - Target: Windows 10+ (ucrtbase.dll is built into the OS)
      //
      // DLLs needed by onnxruntime_binding.node:
      // - msvcp140.dll      : VC++ Standard Library (C++ runtime)
      // - vcruntime140.dll  : VC++ Runtime (core C runtime)
      // - vcruntime140_1.dll: VC++ Runtime extension (C++17+ features)
      //
      // NOTE: This runs in postPackage (not packageAfterPrune) because prune: false
      // is set in packagerConfig, which disables the packageAfterPrune hook.
      // =====================================================================
      if (platform === "win32") {
        const vcRuntimeDlls = [
          "msvcp140.dll",
          "vcruntime140.dll",
          "vcruntime140_1.dll",
        ];

        for (const outputPath of outputPaths) {
          console.log(
            `[postPackage] Bundling VC++ runtime DLLs for Windows at ${outputPath}...`,
          );
          for (const dll of vcRuntimeDlls) {
            const src = `C:\\Windows\\System32\\${dll}`;
            const dest = join(outputPath, dll);
            try {
              copyFileSync(src, dest);
              console.log(`  ✓ Copied ${dll}`);
            } catch (error) {
              console.error(`  ✗ Failed to copy ${dll}:`, error);
              throw new Error(
                `Failed to bundle ${dll}. The build machine must have Visual C++ runtime installed. ` +
                  `On GitHub Actions, use a Windows runner with Visual Studio (e.g., windows-2025).`,
              );
            }
          }
        }
        console.log("✓ VC++ runtime DLLs bundled successfully");
      }
    },
  },
  packagerConfig: {
    asar: {
      unpack:
        "{*.node,*.dylib,*.so,*.dll,*.metal,**/node_modules/@amical/whisper-wrapper/**,**/whisper.cpp/**,**/.vite/build/whisper-worker-fork.js,**/node_modules/jest-worker/**,**/onnxruntime-node/bin/**}",
    },
    name: "Grizzo",
    executableName: "Grizzo",
    icon: "./assets/logo", // Path to your icon file
    appBundleId: "com.grizzo.desktop", // Proper bundle ID
    extraResource: [
      `${process.platform === "win32" ? "../../packages/native-helpers/windows-helper/bin" : "../../packages/native-helpers/swift-helper/bin"}`,
      "./src/db/migrations",
      // Only include the platform-specific node binary
      `./node-binaries/${process.platform}-${process.arch}/node${
        process.platform === "win32" ? ".exe" : ""
      }`,
      "./models",
      "./assets",
    ],
    extendInfo: {
      NSMicrophoneUsageDescription:
        "This app needs access to your microphone to record audio for transcription.",
      CFBundleURLTypes: [
        {
          CFBundleURLSchemes: ["grizzo"],
          CFBundleURLName: "com.grizzo.desktop",
        },
      ],
    },
    protocols: [
      {
        name: "Grizzo",
        schemes: ["grizzo"],
      },
    ],
    // Code signing configuration for macOS
    ...(process.env.SKIP_CODESIGNING === "true"
      ? {}
      : {
          osxSign: {
            identity: process.env.CODESIGNING_IDENTITY,
            // Apply different entitlements based on file path
            optionsForFile: (filePath: string) => {
              // Apply minimal entitlements to Node binary
              if (filePath.includes("node-binaries")) {
                return {
                  entitlements: "./entitlements.node.plist",
                  hardenedRuntime: true,
                };
              }
              // Use default entitlements for everything else
              // https://www.npmjs.com/package/@electron/osx-sign#opts
              // !still need to do any
              return null as any;
            },
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
            // But not for our workspace packages
            if (dep.includes("/") && dep.startsWith("@")) {
              const scopeDir = dep.split("/")[0]; // @libsql/client -> @libsql
              // for workspace packages only keep the actual package
              if (scopeDir === "@amical") {
                if (
                  filePath.startsWith(`/node_modules/${dep}`) ||
                  filePath === `/node_modules/${scopeDir}`
                ) {
                  KEEP_FILE.keep = true;
                  KEEP_FILE.log = true;
                }
                continue;
              }
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
      name: "Grizzo",
      setupIcon: "./assets/logo.ico",
    }),
    new MakerZIP(
      {
        // macOS ZIP files will be named like: Grizzo-darwin-arm64-1.0.0.zip
        // The default naming includes platform and arch, which is good for auto-updates
      },
      ["darwin"],
    ), // Required for macOS auto-updates
    new MakerDMG(
      {
        //! @see https://github.com/electron/forge/issues/3517#issuecomment-2428129194
        // macOS DMG files will be named like: Grizzo-0.0.1-arm64.dmg
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
        owner: "kousaku-maron",
        name: "amical",
      },
      prerelease: true,
      draft: true, // Create draft releases first for review
    }),
  ],
};

export default config;
