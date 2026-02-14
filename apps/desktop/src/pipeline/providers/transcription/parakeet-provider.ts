import * as ort from "onnxruntime-node";
import * as path from "node:path";
import {
  TranscriptionProvider,
  TranscribeParams,
  TranscribeContext,
} from "../../core/pipeline-types";
import { ModelService } from "../../../services/model-service";
import { logger } from "../../../main/logger";
import { AppError, ErrorCodes } from "../../../types/error";
import { extractSpeechFromVad } from "../../utils/vad-audio-filter";
import {
  ParakeetFeatureExtractor,
  decodeParakeetCtc,
  loadParakeetVocabulary,
  ParakeetVocabulary,
} from "../../utils/parakeet-feature-extractor";

export class ParakeetProvider implements TranscriptionProvider {
  readonly name = "parakeet-local";

  private session: ort.InferenceSession | null = null;
  private outputName: string | null = null;
  private currentModelId: string | null = null;
  private vocabulary: ParakeetVocabulary | null = null;

  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = [];
  private currentSilenceFrameCount = 0;

  private readonly featureExtractor = new ParakeetFeatureExtractor();

  private readonly FRAME_SIZE = 512;
  private readonly MIN_AUDIO_DURATION_MS = 500;
  private readonly MAX_SILENCE_DURATION_MS = 3000;
  private readonly SAMPLE_RATE = 16000;
  private readonly SPEECH_PROBABILITY_THRESHOLD = 0.2;

  constructor(private readonly modelService: ModelService) {}

  async preloadModel(modelId?: string): Promise<void> {
    await this.initializeModel(modelId);
  }

  async transcribe(params: TranscribeParams): Promise<string> {
    const { audioData, speechProbability = 1, context } = params;
    await this.initializeModel(context.modelId);

    this.frameBuffer.push(audioData);
    this.frameBufferSpeechProbabilities.push(speechProbability);

    const isSpeech = speechProbability > this.SPEECH_PROBABILITY_THRESHOLD;
    if (isSpeech) {
      this.currentSilenceFrameCount = 0;
    } else {
      this.currentSilenceFrameCount++;
    }

    if (!this.shouldTranscribe()) {
      return "";
    }

    return this.doTranscription(context);
  }

  async flush(context: TranscribeContext): Promise<string> {
    if (this.frameBuffer.length === 0) {
      return "";
    }

    await this.initializeModel(context.modelId);
    return this.doTranscription(context);
  }

  reset(): void {
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.currentSilenceFrameCount = 0;
  }

  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.outputName = null;
    this.currentModelId = null;
    this.vocabulary = null;
    this.reset();
  }

  private async doTranscription(context: TranscribeContext): Promise<string> {
    try {
      if (!this.session || !this.vocabulary || !this.outputName) {
        throw new AppError(
          "Parakeet model is not initialized",
          ErrorCodes.WORKER_INITIALIZATION_FAILED,
        );
      }

      const vadProbs = [...this.frameBufferSpeechProbabilities];
      const rawAudio = this.aggregateFrames();
      this.reset();

      const { audio: speechAudio, segments } = extractSpeechFromVad(
        rawAudio,
        vadProbs,
      );

      if (speechAudio.length === 0) {
        logger.transcription.debug(
          "Skipping Parakeet transcription - no speech detected by VAD filter",
        );
        return "";
      }

      logger.transcription.debug("Parakeet VAD filtered audio", {
        before: rawAudio.length,
        after: speechAudio.length,
        segments: segments.length,
      });

      const features = this.featureExtractor.extract(speechAudio);
      const inputTensor = new ort.Tensor(
        "float32",
        features.inputFeatures,
        features.inputShape,
      );
      const lengthTensor = new ort.Tensor(
        "int64",
        BigInt64Array.from([BigInt(features.featuresLength)]),
        [1],
      );

      const results = await this.session.run({
        audio_signal: inputTensor,
        length: lengthTensor,
      });

      const logitsTensor = results[this.outputName] as ort.Tensor;
      const logits =
        logitsTensor.data instanceof Float32Array
          ? logitsTensor.data
          : Float32Array.from(logitsTensor.data as ArrayLike<number>);

      const text = decodeParakeetCtc(
        logits,
        logitsTensor.dims,
        this.vocabulary.tokens,
        this.vocabulary.blankTokenId,
        features.featuresLength,
      );

      logger.transcription.debug("Parakeet transcription completed", {
        textLength: text.length,
        featuresLength: features.featuresLength,
      });

      return text;
    } catch (error) {
      logger.transcription.error("Parakeet transcription failed", { error });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Parakeet transcription failed: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCodes.LOCAL_TRANSCRIPTION_FAILED,
      );
    }
  }

  private async initializeModel(modelId?: string): Promise<void> {
    const requestedId = await this.resolveSelectedParakeetModelId(modelId);
    if (
      this.session &&
      this.vocabulary &&
      this.outputName &&
      this.currentModelId === requestedId
    ) {
      return;
    }

    const { modelPath, vocabPath } = await this.resolveModelPaths(requestedId);

    if (this.session) {
      await this.session.release();
      this.session = null;
    }

    const preferredProviders =
      process.platform === "win32"
        ? (["dml", "cpu"] as const)
        : process.platform === "darwin"
          ? (["coreml", "cpu"] as const)
          : (["cpu"] as const);

    let session: ort.InferenceSession | null = null;
    let providersUsed: readonly string[] = preferredProviders;

    try {
      session = await ort.InferenceSession.create(modelPath, {
        executionProviders: [...preferredProviders],
      });
    } catch (error) {
      if (preferredProviders.length > 1) {
        logger.transcription.warn(
          "Parakeet preferred execution provider unavailable, falling back to CPU",
          {
            requestedProviders: preferredProviders,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        session = await ort.InferenceSession.create(modelPath, {
          executionProviders: ["cpu"],
        });
        providersUsed = ["cpu"];
      } else {
        throw error;
      }
    }

    this.session = session;
    this.outputName =
      session.outputNames.find((name) => /logprob|logits/i.test(name)) ||
      session.outputNames[0] ||
      null;
    this.vocabulary = await loadParakeetVocabulary(vocabPath);
    this.currentModelId = requestedId;

    logger.transcription.info("Initialized local Parakeet model", {
      modelId: requestedId,
      modelPath,
      vocabPath,
      executionProviders: providersUsed,
      outputName: this.outputName,
    });
  }

  private async resolveSelectedParakeetModelId(
    requestedModelId?: string,
  ): Promise<string> {
    const selectedId = requestedModelId || (await this.modelService.getSelectedModel());
    if (!selectedId) {
      throw new AppError(
        "No speech model selected",
        ErrorCodes.MODEL_MISSING,
      );
    }

    if (!selectedId.startsWith("parakeet-")) {
      throw new AppError(
        `Selected model is not a local Parakeet model: ${selectedId}`,
        ErrorCodes.MODEL_MISSING,
      );
    }

    return selectedId;
  }

  private async resolveModelPaths(modelId: string): Promise<{
    modelPath: string;
    vocabPath: string;
  }> {
    const downloadedModels = await this.modelService.getDownloadedModels();
    const downloaded = downloadedModels[modelId];

    if (!downloaded?.localPath) {
      throw new AppError(
        `Parakeet model not downloaded: ${modelId}`,
        ErrorCodes.MODEL_MISSING,
      );
    }

    const modelPath = downloaded.localPath;
    const modelDir = path.dirname(modelPath);

    const localFiles =
      downloaded.originalModel &&
      typeof downloaded.originalModel === "object" &&
      Array.isArray((downloaded.originalModel as { localFiles?: unknown }).localFiles)
        ? ((downloaded.originalModel as { localFiles: unknown[] }).localFiles.filter(
            (value): value is string => typeof value === "string",
          ) as string[])
        : [];

    const vocabPath =
      localFiles.find((filePath) => filePath.endsWith("vocab.txt")) ||
      path.join(modelDir, "vocab.txt");

    return { modelPath, vocabPath };
  }

  private shouldTranscribe(): boolean {
    const audioDurationMs =
      ((this.frameBuffer.length * this.FRAME_SIZE) / this.SAMPLE_RATE) * 1000;
    const silenceDurationMs =
      ((this.currentSilenceFrameCount * this.FRAME_SIZE) / this.SAMPLE_RATE) *
      1000;

    if (
      audioDurationMs >= this.MIN_AUDIO_DURATION_MS &&
      silenceDurationMs > this.MAX_SILENCE_DURATION_MS
    ) {
      return true;
    }

    if (audioDurationMs > 30000) {
      return true;
    }

    return false;
  }

  private aggregateFrames(): Float32Array {
    const totalLength = this.frameBuffer.reduce(
      (sum, frame) => sum + frame.length,
      0,
    );
    const aggregated = new Float32Array(totalLength);

    let offset = 0;
    for (const frame of this.frameBuffer) {
      aggregated.set(frame, offset);
      offset += frame.length;
    }

    return aggregated;
  }
}
