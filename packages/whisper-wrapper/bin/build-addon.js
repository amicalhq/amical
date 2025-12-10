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

function resolveLibExecutable(env, arch) {
  const archDir = arch === "ia32" ? "x86" : arch === "arm64" ? "arm64" : "x64";
  const hostDir = arch === "ia32" ? "Hostx86" : "Hostx64";
  const candidates = [];

  const addIfExists = (candidate) => {
    if (candidate && fs.existsSync(candidate) && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  try {
    const whereOutput = execSync("where lib.exe", {
      env,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of whereOutput) {
      addIfExists(line);
    }
  } catch (err) {
    // ignore when lib.exe is not on PATH; fall back to manual probing
  }

  const probeVersionedDir = (dir) => {
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
    for (const entry of entries) {
      const candidate = path.join(dir, entry, "bin", hostDir, archDir, "lib.exe");
      if (fs.existsSync(candidate)) {
        addIfExists(candidate);
        break;
      }
    }
  };

  const probeInstallDir = (installDir) => {
    if (!installDir) return;
    if (fs.existsSync(installDir) && fs.statSync(installDir).isFile()) {
      addIfExists(installDir);
      return;
    }

    const directCandidate = path.join(installDir, "bin", hostDir, archDir, "lib.exe");
    addIfExists(directCandidate);

    const toolsDir = path.join(installDir, "Tools", "MSVC");
    probeVersionedDir(toolsDir);
  };

  probeInstallDir(env.VCToolsInstallDir);
  probeInstallDir(env.VCINSTALLDIR);
  probeInstallDir(env.VSINSTALLDIR && path.join(env.VSINSTALLDIR, "VC"));
  probeVersionedDir("C:/Program Files/Microsoft Visual Studio/2022/Enterprise/VC/Tools/MSVC");
  probeVersionedDir("C:/Program Files/Microsoft Visual Studio/2022/Community/VC/Tools/MSVC");
  probeVersionedDir("C:/Program Files/Microsoft Visual Studio/2022/Professional/VC/Tools/MSVC");
  probeVersionedDir("C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC");

  return candidates[0] || null;
}

function ensureWindowsNodeImportLib(buildVariantDir, arch, env) {
  if (process.platform !== "win32") return;

  const nodeImportLib = path.join(buildVariantDir, "node.lib");
  if (fs.existsSync(nodeImportLib)) return;

  let headersPackageJson;
  try {
    headersPackageJson = require.resolve("node-api-headers/package.json", {
      paths: [pkgDir],
    });
  } catch (err) {
    throw new Error(
      "node-api-headers package not found; cannot generate node.lib on Windows",
    );
  }

  const defPath = path.join(path.dirname(headersPackageJson), "def", "node_api.def");
  if (!fs.existsSync(defPath)) {
    throw new Error(`node_api.def not found at ${defPath}`);
  }

  const machineMap = { x64: "X64", ia32: "X86", arm64: "ARM64" };
  const machine = machineMap[arch] || "X64";

  const libExecutable = resolveLibExecutable(env, arch);
  if (!libExecutable) {
    throw new Error(
      "Unable to locate lib.exe. Ensure the Visual Studio Build Tools are installed and vcvarsall has been applied.",
    );
  }

  console.log(
    `[build-addon] Generating node import library using ${libExecutable} for ${machine} into ${nodeImportLib}`,
  );
  try {
    run(`"${libExecutable}" /def:"${defPath}" /machine:${machine} /out:"${nodeImportLib}"`, {
      env,
    });
  } catch (error) {
    const message =
      "Failed to generate node import library. Ensure Visual Studio build tools are installed.";
    if (error instanceof Error) {
      error.message = `${message}\n${error.message}`;
      throw error;
    }
    throw new Error(message);
  }
}

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
  if (name.includes("-vulkan")) {
    envOverrides.GGML_VULKAN = "1";
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

  ensureWindowsNodeImportLib(buildVariantDir, arch, env);

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
  propagateCMakeBool("GGML_VULKAN");
  propagateCMakeBool("GGML_METAL");
  propagateCMakeBool("GGML_CUDA");
  propagateCMakeBool("GGML_OPENBLAS");
  propagateCMakeBool("GGML_BLAS");
  propagateCMakeBool("GGML_USE_ACCELERATE");

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

  // Remove intermediate build artifacts to keep the package footprint small and avoid
  // extremely long CMake-generated paths that break Windows packaging tools.
  fs.rmSync(buildVariantDir, { recursive: true, force: true });
}



