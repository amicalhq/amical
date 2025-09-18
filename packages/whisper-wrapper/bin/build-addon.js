#!/usr/bin/env node
/*
 * build-addon.js
 * --------------------------------------------------
 * Compiles the whisper.cpp Node addon (examples/addon.node) for the current
 * platform/arch with acceleration flags, then places the resulting
 * `whisper.node` binary in native/<target>/.
 *
 * NOTE: This is an initial scaffold. It expects the whisper.cpp sources to be
 * vendored at `./whisper.cpp` (git submodule or manual copy). You can refine
 * the build flags as needed.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function run(cmd, opts = {}) {
  console.log(`[build-addon] ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

const pkgDir = path.resolve(__dirname, "..");
const addonDir = path.join(pkgDir, "addon");
const whisperDir = path.join(pkgDir, "whisper.cpp");

if (!fs.existsSync(addonDir) || !fs.existsSync(whisperDir)) {
  console.error(
    "whisper.cpp sources not found. Please add them to packages/whisper-wrapper/whisper.cpp",
  );
  process.exit(1);
}

const buildDir = path.join(pkgDir, "build");
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir);

const cacheDir = path.join(pkgDir, ".cmake-js");
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);

const homeDir = path.join(pkgDir, ".home");
if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir);

function variantFromName(name, platform, arch) {
  const envOverrides = {};
  if (name === "cpu-fallback") {
    return { name, env: envOverrides };
  }

  if (!name.includes("-")) {
    // expand shorthand like "metal" to full name
    name = `${platform}-${arch}-${name}`;
  } else if (!name.startsWith(platform)) {
    console.warn(
      `[build-addon] Warning: variant '${name}' does not match current platform (${platform}), skipping.`,
    );
    return null;
  }

  if (name.includes("-metal")) {
    envOverrides.GGML_METAL = "1";
    envOverrides.GGML_USE_ACCELERATE = "1";
  }
  if (name.includes("-openblas")) {
    envOverrides.GGML_OPENBLAS = "1";
    envOverrides.GGML_BLAS = "1";
  }
  if (name.includes("-cuda")) {
    envOverrides.GGML_CUDA = "1";
  }
  if (name.startsWith("darwin-")) {
    envOverrides.GGML_USE_ACCELERATE = envOverrides.GGML_USE_ACCELERATE || "1";
  }

  return { name, env: envOverrides };
}

function computeVariants(platform, arch) {
  const overrides = (process.env.WHISPER_TARGETS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const result = [];

  if (overrides.length > 0) {
    for (const override of overrides) {
      const variant = variantFromName(override, platform, arch);
      if (variant) result.push(variant);
    }
    return result;
  }

  if (platform === "darwin") {
    const metal = variantFromName(`${platform}-${arch}-metal`, platform, arch);
    if (metal) result.push(metal);
  }

  const primary = variantFromName(`${platform}-${arch}`, platform, arch);
  if (primary) result.push(primary);

  return result;
}

const { platform, arch } = process;
const variants = computeVariants(platform, arch);

if (variants.length === 0) {
  console.warn("[build-addon] No variants requested, building default cpu-fallback.");
  const fallback = variantFromName("cpu-fallback", platform, arch);
  if (fallback) variants.push(fallback);
}

for (const variant of variants) {
  const buildVariantDir = path.join(buildDir, variant.name.replace(/[\\/]/g, "_"));
  fs.rmSync(buildVariantDir, { recursive: true, force: true });
  fs.mkdirSync(buildVariantDir, { recursive: true });

  const env = {
    ...process.env,
    CMAKE_JS_CACHE: cacheDir,
    HOME: homeDir,
    CMAKE_JS_NODE_DIR: path.resolve(process.execPath, "..", ".."),
    ...variant.env,
  };

  console.log(`[build-addon] Building variant ${variant.name}`);

  const cmakeParts = [
    "npx cmake-js compile",
    `-O "${buildVariantDir}"`,
    "-B Release",
    `-d "${addonDir}"`,
    "-T whisper_node",
    "--CD node_runtime=node",
  ];

  const propagateCMakeBool = (key) => {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      cmakeParts.push(`--CD${key}=${value}`);
    }
  };

  propagateCMakeBool("GGML_NATIVE");

  run(cmakeParts.join(" "), {
    cwd: addonDir,
    env,
  });

  const builtBinary = path.join(buildVariantDir, "Release", "whisper.node");
  if (!fs.existsSync(builtBinary)) {
    throw new Error(`Build succeeded but whisper.node not found for variant ${variant.name}`);
  }

  const targetDir = path.join(pkgDir, "native", variant.name);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(builtBinary, path.join(targetDir, "whisper.node"));
  console.log(`[build-addon] copied to native/${variant.name}/whisper.node`);

  if (platform === "darwin") {
    const targetBinary = path.join(targetDir, "whisper.node");
    try {
      run(`codesign --force --sign - "${targetBinary}"`);
      console.log("[build-addon] codesigned", targetBinary);
    } catch (err) {
      console.warn(
        `[build-addon] warning: codesign failed for ${targetBinary}: ${err.message}`,
      );
    }
  }
}
