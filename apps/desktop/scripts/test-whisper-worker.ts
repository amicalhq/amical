#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { Whisper } from "@amical/whisper-wrapper";

interface CLIOptions {
  model?: string;
  audio?: string;
  language?: string;
  prompt?: string;
  detailed: boolean;
  debug: boolean;
  help?: boolean;
}

function parseArgs(): CLIOptions {
  const options: CLIOptions = {
    detailed: false,
    debug: false,
  };

  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--")) continue;

    const trimmed = rawArg.slice(2);
    if (trimmed === "help" || trimmed === "h") {
      options.help = true;
      continue;
    }

    if (trimmed === "debug") {
      options.debug = true;
      continue;
    }

    const [key, value] = trimmed.split("=");
    if (!value) {
      if (key === "detailed") {
        options.detailed = true;
      }
      continue;
    }

    switch (key) {
      case "model":
        options.model = value;
        break;
      case "audio":
        options.audio = value;
        break;
      case "language":
        options.language = value;
        break;
      case "prompt":
        options.prompt = value;
        break;
      case "detailed":
        options.detailed = value !== "false";
        break;
      case "debug":
        options.debug = value !== "false";
        break;
      default:
        console.warn(`Unknown flag: --${key}`);
        break;
    }
  }

  return options;
}

function usage(): void {
  console.log(
    `Usage: pnpm --filter @amical/desktop tsx scripts/test-whisper-worker.ts [options]\n\n` +
      `Options:\n` +
      `  --model=PATH       Path to whisper model (.bin). Defaults to first model in app data.\n` +
      `  --audio=PATH       Path to WAV file (16kHz mono recommended). Defaults to bundled JFK sample.\n` +
      `  --language=CODE    Language hint (e.g. en, fr). Defaults to auto.\n` +
      `  --prompt=TEXT      Optional initial prompt.\n` +
      `  --detailed         Include timestamps and per-segment output.\n` +
      `  --debug            Print audio statistics before running transcription.\n` +
      `  --help             Show this message.`,
  );
}

function resolveDefaultModelPath(): string {
  const modelsDir = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "amical",
    "models",
  );

  if (!fs.existsSync(modelsDir)) {
    throw new Error(
      `Model directory not found at ${modelsDir}. Provide --model to override.`,
    );
  }

  const candidates = fs
    .readdirSync(modelsDir)
    .filter((name) => name.toLowerCase().endsWith(".bin"))
    .map((name) => {
      const fullPath = path.join(modelsDir, name);
      const stats = fs.statSync(fullPath);
      return { fullPath, size: stats.size };
    })
    .sort((a, b) => b.size - a.size);

  if (candidates.length === 0) {
    throw new Error(
      `No .bin models found in ${modelsDir}. Provide --model to override.`,
    );
  }

  return candidates[0].fullPath;
}

function resolveDefaultAudioPath(): string {
  const audioPath = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "packages",
    "whisper-wrapper",
    "whisper.cpp",
    "samples",
    "jfk.wav",
  );

  if (!fs.existsSync(audioPath)) {
    throw new Error(
      `Sample audio file not found at ${audioPath}. Provide --audio to override.`,
    );
  }

  return audioPath;
}

interface DecodedWav {
  sampleRate: number;
  audio: Float32Array;
}

function decodeWav(filePath: string): DecodedWav {
  const buffer = fs.readFileSync(filePath);

  if (buffer.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Unsupported WAV file: missing RIFF header");
  }

  if (buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Unsupported WAV file: missing WAVE signature");
  }

  let offset = 12;
  let audioFormat = 1;
  let numChannels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === "fmt ") {
      audioFormat = buffer.readUInt16LE(chunkDataStart);
      numChannels = buffer.readUInt16LE(chunkDataStart + 2);
      sampleRate = buffer.readUInt32LE(chunkDataStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataStart + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkDataStart;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset === -1) {
    throw new Error("Unsupported WAV file: missing data chunk");
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = dataSize / bytesPerSample;
  const samplesPerChannel = frameCount / numChannels;

  const audio = new Float32Array(samplesPerChannel);

  for (let i = 0; i < samplesPerChannel; i++) {
    let sampleSum = 0;

    for (let channel = 0; channel < numChannels; channel++) {
      const sampleIndex = i * numChannels + channel;
      const byteOffset = dataOffset + sampleIndex * bytesPerSample;

      let value = 0;
      if (audioFormat === 3 && bitsPerSample === 32) {
        value = buffer.readFloatLE(byteOffset);
      } else if (bitsPerSample === 16) {
        value = buffer.readInt16LE(byteOffset) / 32768;
      } else if (bitsPerSample === 24) {
        const raw = buffer.readIntLE(byteOffset, 3);
        value = raw / 8388608;
      } else if (bitsPerSample === 32) {
        value = buffer.readInt32LE(byteOffset) / 2147483648;
      } else if (bitsPerSample === 8) {
        value = (buffer.readUInt8(byteOffset) - 128) / 128;
      } else {
        throw new Error(
          `Unsupported WAV format: audioFormat=${audioFormat}, bits=${bitsPerSample}`,
        );
      }

      sampleSum += value;
    }

    audio[i] = sampleSum / numChannels;
  }

  return { sampleRate, audio };
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    usage();
    return;
  }

  const modelPath = path.resolve(options.model ?? resolveDefaultModelPath());
  const audioPath = path.resolve(options.audio ?? resolveDefaultAudioPath());

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model file not found at ${modelPath}`);
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found at ${audioPath}`);
  }

  console.log(`\n> Whisper wrapper: direct invocation`);
  console.log(`> Model:  ${modelPath}`);
  console.log(`> Audio:  ${audioPath}`);
  if (options.debug) {
    const { sampleRate, audio } = decodeWav(audioPath);
    if (sampleRate !== 16000) {
      console.warn(
        `Warning: WAV sample rate is ${sampleRate} Hz. Whisper expects 16000 Hz.`,
      );
    }
    console.log(`> Samples loaded: ${audio.length}`);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    for (let i = 0; i < audio.length; i++) {
      const value = audio[i];
      if (value < min) min = value;
      if (value > max) max = value;
      sum += value;
    }
    const mean = audio.length > 0 ? sum / audio.length : 0;
    console.log(
      `> Audio stats: min=${min.toFixed(5)} max=${max.toFixed(5)} mean=${mean.toFixed(5)}`,
    );
    console.log(
      `> First 16 samples: ${Array.from(audio.slice(0, 16)).map((v) => v.toFixed(5)).join(", ")}`,
    );
  }

  const whisper = new Whisper(modelPath, { gpu: true });

  try {
    console.log("\nInitializing model...");
    await whisper.load();
    console.log("Model initialized.");

    const transcriptionOptions = {
      language: options.language ?? "auto",
      initial_prompt: options.prompt ?? "",
      suppress_blank: true,
      suppress_non_speech_tokens: true,
      no_timestamps: false,
    };

    console.log("Running transcription...");
    const { result } = await whisper.transcribe(null, {
      fname_inp: audioPath,
      ...transcriptionOptions,
    });
    const segments = await result;

    if (options.debug) {
      console.log(`> Raw segment payload: ${JSON.stringify(segments)}`);
    }

    if (!Array.isArray(segments) || segments.length === 0) {
      console.log("\n<empty transcription>");
      return;
    }

    if (options.detailed) {
      console.log("\nSegments:\n");
      for (const segment of segments) {
        const from = typeof segment.from === "number" ? segment.from : "?";
        const to = typeof segment.to === "number" ? segment.to : "?";
        console.log(`  [${from} -> ${to}] ${segment.text}`);
      }
      console.log("\nCombined transcription:\n");
    } else {
      console.log("\nTranscription result:\n");
    }

    const combined = segments
      .map((segment: { text: string }) => segment.text)
      .join(" ")
      .trim();

    console.log(combined);
  } finally {
    console.log("\nDisposing model...");
    await whisper.free();
  }
}

main().catch((error) => {
  console.error("Test run failed:", error);
  process.exitCode = 1;
});
