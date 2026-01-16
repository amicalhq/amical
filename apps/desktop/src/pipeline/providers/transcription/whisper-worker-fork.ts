// Worker process entry point for fork
import { Whisper, getLoadedBindingInfo } from "@amical/whisper-wrapper";

// Type definitions for IPC communication
interface WorkerMessage {
  id: number;
  method: string;
  args: unknown[];
}

interface SerializedFloat32Array {
  __type: "Float32Array";
  data: number[];
}

type MethodArg = SerializedFloat32Array | unknown;

// Simple console-based logging for worker process
const logger = {
  transcription: {
    info: (message: string, ...args: unknown[]) =>
      console.log(`[whisper-worker] INFO: ${message}`, ...args),
    error: (message: string, ...args: unknown[]) =>
      console.error(`[whisper-worker] ERROR: ${message}`, ...args),
    debug: (message: string, ...args: unknown[]) =>
      console.log(`[whisper-worker] DEBUG: ${message}`, ...args),
  },
};

let whisperInstance: Whisper | null = null;
let currentModelPath: string | null = null;

// Worker methods
const methods = {
  async initializeModel(modelPath: string): Promise<void> {
    if (whisperInstance && currentModelPath === modelPath) {
      return; // Already initialized with same model
    }

    // Cleanup existing instance
    if (whisperInstance) {
      await whisperInstance.free();
      whisperInstance = null;
    }

    whisperInstance = new Whisper(modelPath, { gpu: true });
    try {
      await whisperInstance.load();
    } catch (e) {
      logger.transcription.error("Failed to load Whisper model:", e);
      throw e;
    }
    currentModelPath = modelPath;
    logger.transcription.info(`Initialized with model: ${modelPath}`);
  },

  async transcribeAudio(
    aggregatedAudio: Float32Array,
    options: {
      language: string;
      initial_prompt: string;
      suppress_blank: boolean;
      suppress_non_speech_tokens: boolean;
      no_timestamps: boolean;
    },
  ): Promise<string> {
    if (!whisperInstance) {
      throw new Error("Whisper instance is not initialized");
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

    const { result } = await whisperInstance.transcribe(
      aggregatedAudio,
      options,
    );
    const transcription = await result;

    logger.transcription.debug(
      `Transcription segments: ${Array.isArray(transcription) ? transcription.length : "?"}`,
    );
    if (Array.isArray(transcription)) {
      logger.transcription.debug(
        `First segment preview: ${transcription[0]?.text ?? "<none>"}`,
      );
    }

    return transcription
      .map((segment: { text: string }) => segment.text)
      .join("");
  },

  async dispose(): Promise<void> {
    if (whisperInstance) {
      await whisperInstance.free();
      whisperInstance = null;
      currentModelPath = null;
    }
  },

  getBindingInfo(): { path: string; type: string } | null {
    return getLoadedBindingInfo();
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
        const serialized = arg as SerializedFloat32Array;
        if (Array.isArray(serialized.data)) {
          return new Float32Array(serialized.data);
        }
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
