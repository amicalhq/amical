// Worker process entry point for fork.
//
// Packaged builds run this file from app.asar.unpacked on the bundled plain
// Node binary, which cannot read app.asar. Import nothing at runtime that the
// main process also imports: Rollup moves shared modules into a chunk that
// stays inside app.asar, and the worker then fails to start. Type-only imports
// are fine.
import { Parakeet, Whisper } from "@amical/whisper-wrapper";
import { shouldDropSegment } from "../../utils/segment-filter";
import { resolveWhisperGpuDecision } from "./whisper-gpu-policy";
import type { LocalSpeechEngine } from "../../../constants/models";

// Type definitions for IPC communication
interface WorkerMessage {
  id: number;
  method: string;
  args: unknown[];
}

interface SerializedFloat32Array {
  __type: "Float32Array";
  base64: string;
}

type MethodArg = SerializedFloat32Array | unknown;

// IPC-based logging — sends structured log messages to the main process
function log(level: string, message: string, ...args: unknown[]) {
  process.send?.({
    type: "log",
    level,
    message,
    args: args.map((a) => {
      if (a instanceof Error) return a.message;
      if (typeof a === "object") {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return a;
    }),
  });
}

const logger = {
  transcription: {
    info: (message: string, ...args: unknown[]) =>
      log("info", message, ...args),
    error: (message: string, ...args: unknown[]) =>
      log("error", message, ...args),
    debug: (message: string, ...args: unknown[]) =>
      log("debug", message, ...args),
    warn: (message: string, ...args: unknown[]) =>
      log("warn", message, ...args),
  },
};

let loaded: { path: string; model: Whisper | Parakeet } | null = null;

async function freeLoadedModel(): Promise<void> {
  const current = loaded;
  loaded = null;
  await current?.model.free();
}

// Worker methods
const methods = {
  async initializeModel(
    modelPath: string,
    engine: LocalSpeechEngine,
  ): Promise<void> {
    if (loaded?.path === modelPath) {
      return; // Already initialized with same model
    }

    await freeLoadedModel();

    // Parakeet runs on the same ggml GPU backends as Whisper.
    const gpuDecision = await resolveWhisperGpuDecision();
    logger.transcription.info(
      `Local model GPU ${gpuDecision.useGpu ? "enabled" : "disabled"}: ${gpuDecision.reason}`,
    );

    let model: Whisper | Parakeet;
    try {
      // The constructors load the model file.
      model =
        engine === "parakeet"
          ? new Parakeet(modelPath, { gpu: gpuDecision.useGpu })
          : new Whisper(modelPath, { gpu: gpuDecision.useGpu });
    } catch (e) {
      logger.transcription.error(`Failed to load ${engine} model:`, e);
      throw e;
    }
    loaded = { path: modelPath, model };
    logger.transcription.info(`Initialized ${engine} model: ${modelPath}`);
  },

  async transcribeAudio(
    aggregatedAudio: Float32Array,
    options: {
      languages?: string[];
      initial_prompt: string;
      suppress_blank: boolean;
      suppress_non_speech_tokens: boolean;
      no_timestamps: boolean;
      format?: string;
    },
  ): Promise<{ text: string; detectedLanguage?: string }> {
    const model = loaded?.model;
    if (model instanceof Parakeet) {
      // No prompt, language or padding input; Parakeet detects the language
      // but does not report it. One leading space, like a Whisper segment,
      // because callers join chunks without a separator.
      const text = model.transcribe(aggregatedAudio).trim();
      return { text: text ? ` ${text}` : "" };
    }
    if (!model) {
      throw new Error("Local model is not initialized");
    }

    // Pad audio with silence to ensure at least 1 second of audio (16k samples)
    const SAMPLE_RATE = 16000; // Whisper expects 16kHz input
    const MIN_DURATION_SAMPLES = SAMPLE_RATE * 1 + 4000; // 1 second + extra buffer
    if (aggregatedAudio.length < MIN_DURATION_SAMPLES) {
      const padded = new Float32Array(MIN_DURATION_SAMPLES);
      // Copy the existing audio to the beginning
      padded.set(aggregatedAudio, 0);
      aggregatedAudio = padded;
    }

    const { result } = await model.transcribe(aggregatedAudio, options);
    const transcription = await result;

    // Filter out hallucination/no-speech segments
    const segments = transcription as Array<{
      text: string;
      lang?: string;
      noSpeechProb?: number;
    }>;

    for (const seg of segments) {
      logger.transcription.debug(
        `Segment [noSpeechProb=${seg.noSpeechProb?.toFixed(3) ?? "N/A"}]: "${seg.text.trim().slice(0, 80)}"`,
      );
    }

    const kept = segments.filter((segment) => !shouldDropSegment(segment));
    const droppedCount = segments.length - kept.length;

    logger.transcription.debug(
      `Segments: ${segments.length} total, ${kept.length} kept, ${droppedCount} dropped`,
    );

    const detectedLanguage = segments.find(
      (segment) => typeof segment.lang === "string" && segment.lang.trim(),
    )?.lang;

    return {
      text: kept.map((segment) => segment.text).join(""),
      detectedLanguage,
    };
  },

  async dispose(): Promise<void> {
    await freeLoadedModel();
  },
};

// Handle messages from parent process
process.on("message", async (message: WorkerMessage) => {
  const { id, method, args } = message;

  try {
    // Deserialize Float32Array from IPC
    const deserializedArgs = args.map((arg: MethodArg) => {
      if (
        arg &&
        typeof arg === "object" &&
        "__type" in arg &&
        arg.__type === "Float32Array"
      ) {
        // Copy into a fresh buffer: a small Buffer can start at an offset
        // that is not a multiple of 4, which a Float32Array view rejects.
        const bytes = Buffer.from(
          (arg as SerializedFloat32Array).base64,
          "base64",
        );
        const audio = new Float32Array(bytes.byteLength / 4);
        new Uint8Array(audio.buffer).set(bytes);
        return audio;
      }
      return arg;
    });

    if (method in methods) {
      const methodName = method as keyof typeof methods;
      const fn = methods[methodName] as (
        ...args: unknown[]
      ) => Promise<unknown>;
      const result = await fn(...deserializedArgs);
      process.send!({ id, result });
    } else {
      process.send!({ id, error: `Unknown method: ${method}` });
    }
  } catch (error) {
    process.send!({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Send ready signal
logger.transcription.info("Worker process started");
