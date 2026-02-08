#!/usr/bin/env node
// Quick smoke-test runner for the whisper.cpp Node addon build.
//
// Usage:
//   node scripts/test-addon.js [--model /path/to/model.bin] [--audio /path/to/audio.wav]
//
// If no flags are provided the script will grab the first *.bin model from
// "~/Library/Application Support/grizzo/models" and the bundled jfk sample.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function resolveBinding() {
  const nativeRoot = path.resolve(__dirname, "..", "native");
  const { platform, arch } = process;
  const candidates = [
    `${platform}-${arch}-metal`,
    `${platform}-${arch}-openblas`,
    `${platform}-${arch}-cuda`,
    `${platform}-${arch}`,
    "cpu-fallback",
  ];

  for (const dir of candidates) {
    const bindingPath = path.join(nativeRoot, dir, "whisper.node");
    if (fs.existsSync(bindingPath)) {
      return bindingPath;
    }
  }

  throw new Error(
    `Unable to locate a whisper.node binary for ${platform}-${arch}. ` +
      `Expected one of: ${candidates.join(", ")}`,
  );
}

function defaultModelPath() {
  const modelsDir = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "grizzo",
    "models",
  );

  if (!fs.existsSync(modelsDir)) {
    throw new Error(
      `Model directory not found at ${modelsDir}. Pass --model to override.`,
    );
  }

  const candidates = fs
    .readdirSync(modelsDir)
    .filter((f) => f.toLowerCase().endsWith(".bin"))
    .map((name) => {
      const fullPath = path.join(modelsDir, name);
      const stats = fs.statSync(fullPath);
      return { name, fullPath, size: stats.size };
    })
    .sort((a, b) => -a.size + b.size);

  if (candidates.length === 0) {
    throw new Error(
      `No .bin model files found in ${modelsDir}. Pass --model to override.`,
    );
  }

  return candidates[0].fullPath;
}

function defaultAudioPath() {
  const audio = path.resolve(
    __dirname,
    "..",
    "whisper.cpp",
    "samples",
    "jfk.wav",
  );

  if (!fs.existsSync(audio)) {
    throw new Error(
      `Sample audio not found at ${audio}. Pass --audio to override.`,
    );
  }

  return audio;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    if (!value) {
      throw new Error(`Flag '${arg}' must be provided as --${key}=<value>`);
    }
    options[key] = value;
  }

  return options;
}

async function main() {
  const opts = parseArgs();
  const modelPath = path.resolve(opts.model || defaultModelPath());
  const audioPath = path.resolve(opts.audio || defaultAudioPath());

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model file not found at ${modelPath}`);
  }
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found at ${audioPath}`);
  }

  const bindingPath = resolveBinding();
  console.log(`> Using addon: ${bindingPath}`);
  console.log(`> Using model: ${modelPath}`);
  console.log(`> Using audio: ${audioPath}`);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const binding = require(bindingPath);

  if (
    typeof binding.init !== "function" ||
    typeof binding.full !== "function" ||
    typeof binding.free !== "function"
  ) {
    throw new Error(
      `Addon at ${bindingPath} does not expose init/full/free APIs.`,
    );
  }

  const handle = binding.init({ model: modelPath, gpu: true });
  try {
    const segments = binding.full(handle, {
      fname_inp: audioPath,
      language: "en",
      no_timestamps: false,
      suppress_blank: true,
      suppress_non_speech_tokens: true,
    });

    console.log("Transcription segments:\n");
    for (const segment of segments) {
      const from = typeof segment.from === "number" ? segment.from : "?";
      const to = typeof segment.to === "number" ? segment.to : "?";
      console.log(`  [${from} -> ${to}] ${segment.text}`);
    }

    console.log("\nDone.");
  } finally {
    binding.free(handle);
  }
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exitCode = 1;
});
