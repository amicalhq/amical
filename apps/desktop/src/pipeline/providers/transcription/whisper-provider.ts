import {
  TranscriptionProvider,
  TranscribeParams,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { ModelManagerService } from "../../../services/model-manager";
import { Whisper } from "smart-whisper";

export class WhisperProvider implements TranscriptionProvider {
  readonly name = "whisper-local";

  private modelManager: ModelManagerService;
  private whisperInstance: Whisper | null = null;

  constructor(modelManager: ModelManagerService) {
    this.modelManager = modelManager;
  }

  async transcribe(params: TranscribeParams): Promise<string> {
    try {
      await this.initializeWhisper();

      // Extract parameters from the new structure
      const { audioData, context } = params;
      const { vocabulary, previousChunk, aggregatedTranscription } = context;

      // Convert audio buffer to the format expected by smart-whisper
      const audioFloat32Array = await this.convertAudioBuffer(audioData);

      logger.transcription.debug(
        `Starting transcription, audio size: ${audioData.length}`,
        previousChunk
          ? `Previous chunk: ${previousChunk.substring(0, 50)}...`
          : "No previous chunk",
        aggregatedTranscription
          ? `Aggregated length: ${aggregatedTranscription.length}`
          : "No aggregated transcription",
      );

      // Transcribe using smart-whisper
      if (!this.whisperInstance) {
        throw new Error("Whisper instance is not initialized");
      }

      // Generate initial prompt from vocabulary and recent context
      const initialPrompt = this.generateInitialPrompt(
        vocabulary,
        aggregatedTranscription,
      );

      const { result } = await this.whisperInstance.transcribe(
        audioFloat32Array,
        {
          language: "auto",
          initial_prompt: initialPrompt,
        },
      );

      const transcription = await result;

      // Combine all transcription segments into a single string
      const text = transcription
        .map((segment) => segment.text)
        .join(" ")
        .trim();

      logger.transcription.debug(
        `Transcription completed, length: ${text.length}`,
      );

      return text;
    } catch (error) {
      logger.transcription.error("Transcription failed:", error);
      throw new Error(`Transcription failed: ${error}`);
    }
  }

  private generateInitialPrompt(
    vocabulary?: Map<string, string>,
    aggregatedTranscription?: string,
  ): string {
    const promptParts: string[] = [];

    // Add vocabulary terms if available
    if (vocabulary && vocabulary.size > 0) {
      // Extract vocabulary keys (the actual terms) and join with commas
      const vocabularyTerms = Array.from(vocabulary.keys());
      const vocabularyText = vocabularyTerms.join(", ");
      promptParts.push(vocabularyText);
    }

    // Add last 8 words from aggregated transcription if available
    if (aggregatedTranscription && aggregatedTranscription.trim().length > 0) {
      const words = aggregatedTranscription.trim().split(/\s+/);
      const lastWords = words.slice(-8).join(" ");
      if (lastWords.length > 0) {
        promptParts.push(lastWords);
      }
    }

    // Combine parts with a separator, or return empty string if no context
    const prompt = promptParts.join(". ");

    logger.transcription.debug(`Generated initial prompt: "${prompt}"`);

    return prompt;
  }

  private async initializeWhisper(): Promise<void> {
    if (this.whisperInstance) {
      return; // Already initialized
    }

    const modelPath = await this.modelManager.getBestAvailableModelPath();
    if (!modelPath) {
      throw new Error(
        "No Whisper models available. Please download a model first.",
      );
    }

    try {
      const { Whisper } = await import("smart-whisper");
      this.whisperInstance = new Whisper(modelPath, { gpu: true });
      logger.transcription.info(`Initialized with model: ${modelPath}`);
    } catch (error) {
      logger.transcription.error(`Failed to initialize:`, error);
      throw new Error(`Failed to initialize smart-whisper: ${error}`);
    }
  }

  private async convertAudioBuffer(audioData: Buffer): Promise<Float32Array> {
    try {
      // Convert buffer to Float32Array (simplified)
      const float32Array = new Float32Array(audioData.length / 4);
      for (let i = 0; i < float32Array.length; i++) {
        float32Array[i] = audioData.readFloatLE(i * 4);
      }
      return float32Array;
    } catch (error) {
      logger.transcription.warn(
        "Audio conversion failed, trying alternative method",
      );

      // Fallback: convert as if it's PCM data
      const samples = new Float32Array(audioData.length / 2);
      for (let i = 0; i < samples.length; i++) {
        const sample = audioData.readInt16LE(i * 2);
        samples[i] = sample / 32768.0;
      }
      return samples;
    }
  }

  // Simple cleanup method
  async dispose(): Promise<void> {
    if (this.whisperInstance) {
      try {
        await this.whisperInstance.free();
        logger.transcription.debug("Instance freed");
      } catch (error) {
        logger.transcription.warn("Error freeing instance:", error);
      } finally {
        this.whisperInstance = null;
      }
    }
  }
}
