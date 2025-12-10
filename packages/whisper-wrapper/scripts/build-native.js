#!/usr/bin/env node
const { execSync } = require("node:child_process");
const path = require("node:path");

function build(targets) {
  const baseEnv = { ...process.env };
  baseEnv.WHISPER_TARGETS = targets.join(",");
  execSync("node ./bin/build-addon.js", {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: baseEnv,
  });
}

if (process.argv.includes("--vulkan")) {
  build(["win32-x64-vulkan", "win32-x64"]);
} else if (process.argv.includes("--cuda")) {
  build(["win32-x64-cuda", "win32-x64"]);
} else {
  build([]);
}
