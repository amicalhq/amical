// Worker process entry point for fork
import { Whisper } from "@amical/smart-whisper";

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

    const { Whisper } = await import("@amical/smart-whisper");
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

    return transcription
      .map((segment) => segment.text)
      .join(" ")
      .trim();
  },

  async dispose(): Promise<void> {
    if (whisperInstance) {
      await whisperInstance.free();
      whisperInstance = null;
      currentModelPath = null;
    }
  },
};

// Handle messages from parent process
process.on("message", async (message: any) => {
  const { id, method, args } = message;

  try {
    // Deserialize Float32Array from IPC
    const deserializedArgs = args.map((arg: any) => {
      if (arg && arg.__type === "Float32Array" && Array.isArray(arg.data)) {
        return new Float32Array(arg.data);
      }
      return arg;
    });

    if (method in methods) {
      const result = await (methods as any)[method](...deserializedArgs);
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
