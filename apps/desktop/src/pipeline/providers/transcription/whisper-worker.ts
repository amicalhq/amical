// This file contains just the Whisper-specific operations that need to run in a separate process
import { Whisper } from "@amical/whisper-wrapper";

// Simple console-based logging for worker process
const logger = {
  transcription: {
    info: (message: string, ...args: any[]) =>
      console.log(`[whisper-worker] INFO: ${message}`, ...args),
    error: (message: string, ...args: any[]) =>
      console.error(`[whisper-worker] ERROR: ${message}`, ...args),
    debug: (message: string, ...args: any[]) =>
      console.log(`[whisper-worker] DEBUG: ${message}`, ...args),
  },
};

let whisperInstance: Whisper | null = null;
let currentModelPath: string | null = null;

export async function initializeModel(modelPath: string): Promise<void> {
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
}

export async function transcribeAudio(
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

  const { result } = await whisperInstance.transcribe(aggregatedAudio, options);
  const transcription = await result;

  return transcription
    .map((segment: { text: string }) => segment.text)
    .join(" ")
    .trim();
}

export async function dispose(): Promise<void> {
  if (whisperInstance) {
    await whisperInstance.free();
    whisperInstance = null;
    currentModelPath = null;
  }
}
