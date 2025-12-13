import * as ort from "onnxruntime-node";
import { logger } from "../main/logger";
import { app } from "electron";
import * as path from "path";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";

export class VADService extends EventEmitter {
  private session: ort.InferenceSession | null = null;
  private modelPath: string | null = null;
  private state: ort.Tensor | null = null;
  private sr: number = 16000;

  // Configuration
  private readonly WINDOW_SIZE_SAMPLES = 512; // 32ms at 16kHz
  private readonly SPEECH_THRESHOLD = 0.1;
  private readonly REDEMPTION_FRAMES = 8;

  // State
  private speechFrameCount = 0;
  private silenceFrameCount = 0;
  private isSpeaking = false;

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    try {
      // Handle both development and production paths
      if (app.isPackaged) {
        // In production, the assets are copied to the resources folder
        this.modelPath = path.join(
          process.resourcesPath,
          "models",
          "silero_vad_v5.onnx",
        );
      } else {
        // In development, use the source path
        this.modelPath = path.join(
          __dirname,
          "../../models/silero_vad_v5.onnx",
        );
      }

      logger.main.info("Loading VAD model from", this.modelPath);

      // Check if the model file exists
      if (!existsSync(this.modelPath)) {
        throw new Error(
          `VAD model file not found at: ${this.modelPath}. ` +
            `Make sure the ONNX model is in the assets folder.`,
        );
      }

      // Load ONNX model
      this.session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ["coreml", "cpu"],
      });

      // Initialize hidden states (h and c)
      this.resetStates();

      logger.main.info("VAD service initialized successfully");
    } catch (error) {
      logger.main.error("Failed to initialize VAD service:", error);
      throw error;
    }
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  private resetStates(): void {
    // Silero VAD uses a state tensor with shape [2, 1, 128]
    const stateSize = 2 * 1 * 128;
    this.state = new ort.Tensor(
      "float32",
      new Float32Array(stateSize).fill(0),
      [2, 1, 128],
    );
  }

  async processBatch(
    audioFrames: Float32Array,
  ): Promise<{ probability: number; isSpeaking: boolean }> {
    if (!this.session || !this.state) {
      throw new Error("VAD service not initialized");
    }

    try {
      // Create input tensor - shape should be [1, audio_length]
      const inputTensor = new ort.Tensor("float32", audioFrames, [
        1,
        audioFrames.length,
      ]);

      const srTensor = new ort.Tensor(
        "int64",
        BigInt64Array.from([BigInt(this.sr)]),
        [],
      );

      // Run inference with input, state, and sr
      const results = await this.session.run({
        input: inputTensor,
        state: this.state,
        sr: srTensor,
      });

      // Update state for next iteration
      this.state = results.stateN as ort.Tensor;

      // Get speech probability
      const output = results.output as ort.Tensor;
      const probability = output.data[0] as number;

      // Apply smoothing logic
      const isSpeaking = this.applySpeechDetectionLogic(probability);

      return { probability, isSpeaking };
    } catch (error) {
      logger.main.error("VAD inference failed:", error);
      throw error;
    }
  }

  private applySpeechDetectionLogic(probability: number): boolean {
    const isSpeechFrame = probability > this.SPEECH_THRESHOLD;

    if (isSpeechFrame) {
      this.speechFrameCount++;
      this.silenceFrameCount = 0;
    } else {
      this.silenceFrameCount++;
      if (this.silenceFrameCount > this.REDEMPTION_FRAMES) {
        this.speechFrameCount = 0;
      }
    }

    // Start speaking after enough speech frames
    if (!this.isSpeaking && this.speechFrameCount >= 3) {
      this.isSpeaking = true;
      this.emit("voice-detected", true);
    }

    // Stop speaking after enough silence
    if (this.isSpeaking && this.silenceFrameCount >= this.REDEMPTION_FRAMES) {
      this.isSpeaking = false;
      this.emit("voice-detected", false);
    }

    return this.isSpeaking;
  }

  async processAudioFrame(
    audioData: Float32Array,
  ): Promise<{ probability: number; isSpeaking: boolean }> {
    // Silero VAD requires exactly 512 samples
    if (audioData.length !== this.WINDOW_SIZE_SAMPLES) {
      // If we have fewer samples (e.g., final buffer flush), pad with zeros
      if (audioData.length < this.WINDOW_SIZE_SAMPLES) {
        const paddedArray = new Float32Array(this.WINDOW_SIZE_SAMPLES);
        paddedArray.set(audioData);
        // Rest is already zeros
        return this.processBatch(paddedArray);
      } else {
        // If we have more samples, just process the first 512
        const truncatedArray = audioData.slice(0, this.WINDOW_SIZE_SAMPLES);
        return this.processBatch(truncatedArray);
      }
    }

    // Process through VAD
    return this.processBatch(audioData);
  }

  getSpeechState(): boolean {
    return this.isSpeaking;
  }

  /**
   * Reset VAD state for a new recording session.
   * This clears the LSTM state and speech detection counters.
   */
  reset(): void {
    this.resetStates();
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.isSpeaking = false;
    logger.main.debug("VAD state reset for new recording session");
  }

  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.state = null;
    logger.main.info("VAD service disposed");
  }
}
