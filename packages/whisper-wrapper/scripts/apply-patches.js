#!/usr/bin/env node
/**
 * Applies local patches to the whisper.cpp submodule before building.
 *
 * Patches live in ../patches/ and are applied with `git apply` inside the
 * whisper.cpp directory. Already-applied patches are skipped (idempotent).
 */
const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const WHISPER_CPP_DIR = path.join(__dirname, "..", "whisper.cpp");
const PATCHES_DIR = path.join(__dirname, "..", "patches");

if (!fs.existsSync(PATCHES_DIR)) {
  process.exit(0);
}

const patches = fs
  .readdirSync(PATCHES_DIR)
  .filter((f) => f.endsWith(".patch"))
  .sort();

if (patches.length === 0) {
  process.exit(0);
}

for (const patch of patches) {
  const patchPath = path.join(PATCHES_DIR, patch);

  // Check if already applied
  try {
    execSync(`git apply --check --reverse "${patchPath}"`, {
      cwd: WHISPER_CPP_DIR,
      stdio: "pipe",
    });
    console.log(`[apply-patches] ${patch} — already applied, skipping`);
    continue;
  } catch {
    // Not yet applied — fall through
  }

  // Apply the patch
  try {
    execSync(`git apply "${patchPath}"`, {
      cwd: WHISPER_CPP_DIR,
      stdio: "pipe",
    });
    console.log(`[apply-patches] ${patch} — applied`);
  } catch (e) {
    console.error(`[apply-patches] ${patch} — FAILED: ${e.message}`);
    process.exit(1);
  }
}
