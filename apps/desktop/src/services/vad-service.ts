import type * as ort from "onnxruntime-node";
import { logger } from "../main/logger";
import { app } from "electron";
import * as path from "path";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";

type OrtModule = typeof import("onnxruntime-node");

export class VADService extends EventEmitter {
  private ort: OrtModule | null = null;
  private session: ort.InferenceSession | null = null;
  private modelPath: string | null = null;
  private state: ort.Tensor | null = null;
  private sr: number = 16000;

  // Configuration
  private readonly WINDOW_SIZE_SAMPLES = 512; // 32ms at 16kHz
  private readonly CTX_SIZE = 64; // Context size for v6
  private readonly INPUT_SIZE = 576; // CTX_SIZE + WINDOW_SIZE_SAMPLES
  private readonly SPEECH_THRESHOLD = 0.1;
  private readonly REDEMPTION_FRAMES = 8;

  // State
  private context: Float32Array = new Float32Array(64).fill(0); // v6 context buffer
  private speechFrameCount = 0;
  private silenceFrameCount = 0;
  private isSpeaking = false;
  // When true, real VAD is unavailable and every frame is treated as speech
  // (probability 1) through the same smoothing logic, so consumers see the
  // exact same contract (results, events, state) as with the real model.
  private fallbackMode = false;

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    try {
      // Load onnxruntime-node lazily so a broken native binding (e.g. the
      // bundled onnxruntime.dll losing the load race to a stale System32 copy
      // right after install) degrades to the fallback shim instead of
      // crashing the main process at require time.
      this.ort = await import("onnxruntime-node");

      // Handle both development and production paths
      if (app.isPackaged) {
        // In production, the assets are copied to the resources folder
        this.modelPath = path.join(
          process.resourcesPath,
          "models",
          "silero_vad_v6.onnx",
        );
      } else {
        // In development, use the source path
        this.modelPath = path.join(
          __dirname,
          "../../models/silero_vad_v6.onnx",
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
      this.session = await this.ort.InferenceSession.create(this.modelPath, {
        executionProviders: ["coreml", "cpu"],
      });

      // Initialize hidden states (h and c)
      this.resetStates();

      logger.main.info("VAD service initialized successfully");
    } catch (error) {
      this.enterFallbackMode("initialize", error);
    }
  }

  /**
   * Switch to the mocked shim: every frame reports speechProbability 1.
   * Emits "vad-fallback" once so the service manager can report to PostHog.
   */
  private enterFallbackMode(stage: string, error: unknown): void {
    if (this.fallbackMode) return;
    this.fallbackMode = true;
    // Release the native ONNX session before dropping the reference. On the
    // inference-failure path the session is still fully loaded, and nulling it
    // without release() would strand its native memory — dispose() would then
    // see a null session and skip the release. Fire-and-forget (and guarded so
    // this error path can never itself throw): we don't block the fallback.
    const session = this.session;
    this.session = null;
    if (session) {
      try {
        void session.release().catch((releaseError) => {
          logger.main.error(
            "VAD: failed to release ONNX session on fallback:",
            releaseError,
          );
        });
      } catch (releaseError) {
        logger.main.error(
          "VAD: failed to release ONNX session on fallback:",
          releaseError,
        );
      }
    }
    logger.main.error(
      `VAD unavailable (${stage}); falling back to speechProbability=1 shim:`,
      error,
    );
    this.emit("vad-fallback", { stage, error });
  }

  private fallbackResult(): { probability: number; isSpeaking: boolean } {
    return { probability: 1, isSpeaking: this.applySpeechDetectionLogic(1) };
  }

  private resetStates(): void {
    if (!this.ort) return;
    // Silero VAD uses a state tensor with shape [2, 1, 128]
    const stateSize = 2 * 1 * 128;
    this.state = new this.ort.Tensor(
      "float32",
      new Float32Array(stateSize).fill(0),
      [2, 1, 128],
    );
  }

  async processBatch(
    audioFrames: Float32Array,
  ): Promise<{ probability: number; isSpeaking: boolean }> {
    if (this.fallbackMode || !this.ort || !this.session || !this.state) {
      return this.fallbackResult();
    }

    try {
      // v6: Create combined input [context | frame] with fixed size 576
      const input = new Float32Array(this.INPUT_SIZE);
      input.set(this.context, 0);
      input.set(audioFrames, this.CTX_SIZE);

      const inputTensor = new this.ort.Tensor("float32", input, [
        1,
        this.INPUT_SIZE,
      ]);

      const srTensor = new this.ort.Tensor(
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

      // v6: Use dynamic output name detection for robustness
      const outName = this.session.outputNames[0];
      const stateName = this.session.outputNames.find((n) => n !== outName)!;

      // Update state for next iteration
      this.state = results[stateName] as ort.Tensor;

      // Get speech probability
      const probability = (results[outName].data as Float32Array)[0];

      // v6: Update context = last CTX_SIZE samples of the input
      this.context = input.slice(this.INPUT_SIZE - this.CTX_SIZE);

      // Apply smoothing logic
      const isSpeaking = this.applySpeechDetectionLogic(probability);

      return { probability, isSpeaking };
    } catch (error) {
      this.enterFallbackMode("inference", error);
      return this.fallbackResult();
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
    }

    // Stop speaking after enough silence
    if (this.isSpeaking && this.silenceFrameCount >= this.REDEMPTION_FRAMES) {
      this.isSpeaking = false;
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

  /**
   * Reset VAD state for a new recording session.
   * This clears the LSTM state, context buffer, and speech detection counters.
   */
  reset(): void {
    this.resetStates();
    this.context = new Float32Array(this.CTX_SIZE).fill(0); // Reset v6 context buffer
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
