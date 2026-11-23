// Release build of the Linux helper, staged at bin/linux-helper.
//
// After the build, the staged binary must pass three checks:
// - size: at most MAX_SIZE_BYTES;
// - glibc: no symbol version above GLIBC 2.35 (Ubuntu 22.04), compared as
//   numbers, so that the package runs on every supported distribution
//   (an error in CI, a warning on a local build);
// - self-check: the binary answers getHelperCapabilities over stdin/stdout.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(packageDir, process.env.CARGO_TARGET_DIR)
  : path.join(packageDir, "target");
const builtBinary = path.join(targetDir, "release", "linux-helper");
const stagedBinary = path.join(packageDir, "bin", "linux-helper");

const MAX_SIZE_BYTES = 6 * 1024 * 1024;
const MAX_GLIBC = [2, 35];
const SELF_CHECK_TIMEOUT_MS = 10_000;

function fail(message) {
  console.error(`linux-helper build: ${message}`);
  process.exit(1);
}

function checkSize() {
  const { size } = fs.statSync(stagedBinary);
  if (size > MAX_SIZE_BYTES) {
    fail(`binary is ${size} bytes; the limit is ${MAX_SIZE_BYTES}`);
  }
  return size;
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function checkGlibc() {
  const result = spawnSync("objdump", ["-T", stagedBinary], {
    encoding: "utf8",
  });
  if (result.error)
    fail(`cannot run objdump (package: binutils): ${result.error.message}`);
  if (result.status !== 0) fail(`objdump failed: ${result.stderr}`);
  const versions = [...result.stdout.matchAll(/GLIBC_(\d+(?:\.\d+)+)/g)].map(
    (match) => match[1].split(".").map(Number),
  );
  if (versions.length === 0) fail("objdump found no GLIBC symbol versions");
  const highest = versions.reduce((a, b) =>
    compareVersions(a, b) >= 0 ? a : b,
  );
  if (compareVersions(highest, MAX_GLIBC) > 0) {
    const message =
      `binary needs GLIBC ${highest.join(".")}; the limit is ${MAX_GLIBC.join(".")}. ` +
      "Build release binaries on Ubuntu 22.04 (or a ubuntu:22.04 container).";
    // A local build on a newer distribution runs on that machine, so only CI,
    // where release binaries are built, treats this as an error.
    if (process.env.CI) fail(message);
    console.warn(`linux-helper build: warning: ${message}`);
  }
  return highest.join(".");
}

// Runs the staged binary as the desktop does and asks for its capabilities.
// The session bus address points nowhere, so the check never touches the
// session of the user who builds.
function selfCheck() {
  return new Promise((resolve, reject) => {
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      DBUS_SESSION_BUS_ADDRESS:
        "unix:path=/nonexistent/linux-helper-self-check",
    };
    const child = spawn(stagedBinary, [], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`no exit within ${SELF_CHECK_TIMEOUT_MS} ms\n${stderr}`),
      );
    }, SELF_CHECK_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const lines = stdout.split("\n").filter((line) => line !== "");
      try {
        if (code !== 0) throw new Error(`exit code ${code}, signal ${signal}`);
        if (lines.length !== 1)
          throw new Error(`expected 1 stdout line, got ${lines.length}`);
        const answer = JSON.parse(lines[0]);
        if (answer.id !== "self-check" || answer.error !== undefined) {
          throw new Error(`unexpected answer: ${lines[0]}`);
        }
        // The test suite checks the whole answer against the schema.
        const { keyInputMode, sessionType } = answer.result ?? {};
        if (
          typeof keyInputMode !== "string" ||
          typeof sessionType !== "string"
        ) {
          throw new Error(`not a capabilities answer: ${lines[0]}`);
        }
        resolve(answer.result);
      } catch (error) {
        reject(new Error(`${error.message}\n${stderr}`));
      }
    });
    child.stdin.end(
      `${JSON.stringify({ id: "self-check", method: "getHelperCapabilities", params: {} })}\n`,
    );
  });
}

if (process.platform !== "linux") fail("the Linux helper builds only on Linux");

try {
  execFileSync("cargo", ["build", "--release", "--locked"], {
    cwd: packageDir,
    stdio: "inherit",
  });
} catch (error) {
  fail(`cargo build failed: ${error.message}`);
}
fs.mkdirSync(path.dirname(stagedBinary), { recursive: true });
fs.copyFileSync(builtBinary, stagedBinary);
fs.chmodSync(stagedBinary, 0o755);

const size = checkSize();
const glibc = checkGlibc();
try {
  const result = await selfCheck();
  console.log(
    `linux-helper: ${stagedBinary} (${size} bytes, GLIBC ${glibc}, ` +
      `self-check ok: keyInputMode=${result.keyInputMode}, sessionType=${result.sessionType})`,
  );
} catch (error) {
  fail(`self-check failed: ${error.message}`);
}
