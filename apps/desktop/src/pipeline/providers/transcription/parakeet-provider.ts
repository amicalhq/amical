import * as ort from "onnxruntime-node";
import * as path from "node:path";
import { promises as fs } from "node:fs";
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
  decodeParakeetTokens,
  loadParakeetVocabulary,
  ParakeetVocabulary,
  ParakeetFeatures,
} from "../../utils/parakeet-feature-extractor";

interface ResolvedParakeetPaths {
  encoderModelPath: string;
  decoderJointModelPath: string;
  nemoPreprocessorPath?: string;
  vocabPath: string;
  configPath?: string;
}

interface ParakeetModelConfig {
  features_size?: number;
  max_tokens_per_step?: number;
}

interface EncoderAccessor {
  hiddenSize: number;
  timeSteps: number;
  at: (timeStep: number) => Float32Array;
}

interface TdtDecoderState {
  state1: ort.Tensor;
  state2: ort.Tensor;
}

export class ParakeetProvider implements TranscriptionProvider {
  readonly name = "parakeet-local";

  private tdtPreprocessorSession: ort.InferenceSession | null = null;
  private tdtEncoderSession: ort.InferenceSession | null = null;
  private tdtDecoderJointSession: ort.InferenceSession | null = null;

  private currentModelId: string | null = null;
  private vocabulary: ParakeetVocabulary | null = null;

  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = [];
  private currentSilenceFrameCount = 0;

  private featureSize = 80;
  private maxTokensPerStep = 10;
  private featureExtractor = new ParakeetFeatureExtractor(80);

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
    await this.releaseSessions();
    this.currentModelId = null;
    this.vocabulary = null;
    this.reset();
  }

  private async doTranscription(_context: TranscribeContext): Promise<string> {
    try {
      if (!this.vocabulary) {
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

      const features = await this.extractFeatures(speechAudio);
      return this.transcribeTdt(features);
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

  private async extractFeatures(
    audioData: Float32Array,
  ): Promise<ParakeetFeatures> {
    if (!this.tdtPreprocessorSession) {
      return this.featureExtractor.extract(audioData);
    }

    try {
      const waveformInputName = this.findName(
        this.tdtPreprocessorSession.inputNames,
        [/waveforms/i, /audio/i],
        0,
      );
      const waveformLengthInputName = this.findName(
        this.tdtPreprocessorSession.inputNames,
        [/waveforms_lens/i, /length/i],
        1,
      );
      const featuresOutputName = this.findName(
        this.tdtPreprocessorSession.outputNames,
        [/^features$/i, /mel/i],
        0,
      );
      const featuresLengthOutputName = this.findName(
        this.tdtPreprocessorSession.outputNames,
        [/features_lens/i, /length/i],
        1,
      );

      const waveformTensor = new ort.Tensor("float32", audioData, [
        1,
        audioData.length,
      ]);
      const waveformLengthTensor = this.createIntegerTensorForInput(
        this.tdtPreprocessorSession,
        waveformLengthInputName,
        [audioData.length],
        [1],
      );

      const preprocessorResults = await this.tdtPreprocessorSession.run({
        [waveformInputName]: waveformTensor,
        [waveformLengthInputName]: waveformLengthTensor,
      });

      const featuresTensor = preprocessorResults[
        featuresOutputName
      ] as ort.Tensor;
      const featuresLengthTensor = preprocessorResults[
        featuresLengthOutputName
      ] as ort.Tensor;
      const featuresData = this.toFloat32Array(featuresTensor.data);
      const dims = featuresTensor.dims;

      if (dims.length !== 3 || dims[0] !== 1) {
        throw new AppError(
          `Unexpected Parakeet preprocessor output dims: ${dims.join("x")}`,
          ErrorCodes.WORKER_INITIALIZATION_FAILED,
        );
      }

      const featuresSize = Number(dims[1]);
      const frameCount = Number(dims[2]);
      if (
        !Number.isFinite(featuresSize) ||
        !Number.isFinite(frameCount) ||
        featuresSize <= 0 ||
        frameCount <= 0
      ) {
        throw new AppError(
          `Invalid Parakeet preprocessor output dims: ${dims.join("x")}`,
          ErrorCodes.WORKER_INITIALIZATION_FAILED,
        );
      }

      const featureLengths = this.toBigInt64Array(featuresLengthTensor.data);
      const featuresLength = Math.max(
        1,
        Math.min(frameCount, Number(featureLengths[0] ?? BigInt(frameCount))),
      );

      return {
        inputFeatures: featuresData,
        inputShape: [1, featuresSize, frameCount],
        featuresLength,
      };
    } catch (error) {
      logger.transcription.warn(
        "Parakeet TDT ONNX preprocessor failed, falling back to JS feature extraction",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return this.featureExtractor.extract(audioData);
    }
  }

  private async transcribeTdt(features: ParakeetFeatures): Promise<string> {
    if (
      !this.tdtEncoderSession ||
      !this.tdtDecoderJointSession ||
      !this.vocabulary
    ) {
      throw new AppError(
        "Parakeet TDT model is not initialized",
        ErrorCodes.WORKER_INITIALIZATION_FAILED,
      );
    }

    const encoderInputName = this.findName(
      this.tdtEncoderSession.inputNames,
      [/audio_signal/i],
      0,
    );
    const encoderLengthName = this.findName(
      this.tdtEncoderSession.inputNames,
      [/length/i],
      1,
    );

    const encoderOutName = this.findName(
      this.tdtEncoderSession.outputNames,
      [/^outputs$/i],
      0,
    );
    const encodedLengthName = this.findName(
      this.tdtEncoderSession.outputNames,
      [/encoded_lengths/i, /length/i],
      1,
    );

    const encoderInputTensor = new ort.Tensor(
      "float32",
      features.inputFeatures,
      features.inputShape,
    );
    const encoderLengthTensor = this.createIntegerTensorForInput(
      this.tdtEncoderSession,
      encoderLengthName,
      [features.featuresLength],
      [1],
    );

    const encoderResults = await this.tdtEncoderSession.run({
      [encoderInputName]: encoderInputTensor,
      [encoderLengthName]: encoderLengthTensor,
    });

    const encoderTensor = encoderResults[encoderOutName] as ort.Tensor;
    const encodedLengthTensor = encoderResults[encodedLengthName] as ort.Tensor;

    const accessor = this.createEncoderAccessor(encoderTensor);
    const encodedLengths = this.toBigInt64Array(encodedLengthTensor.data);
    const encodedLength = Math.max(
      1,
      Math.min(
        accessor.timeSteps,
        Number(encodedLengths[0] ?? BigInt(accessor.timeSteps)),
      ),
    );

    const decoderOutputName = this.findName(
      this.tdtDecoderJointSession.outputNames,
      [/^outputs$/i],
      0,
    );
    const outputState1Name = this.findName(
      this.tdtDecoderJointSession.outputNames,
      [/output_states_1/i],
      1,
    );
    const outputState2Name = this.findName(
      this.tdtDecoderJointSession.outputNames,
      [/output_states_2/i],
      2,
    );

    const decoderEncoderInputName = this.findName(
      this.tdtDecoderJointSession.inputNames,
      [/encoder_outputs/i],
      0,
    );
    const decoderTargetsInputName = this.findName(
      this.tdtDecoderJointSession.inputNames,
      [/targets/i],
      1,
    );
    const decoderTargetLengthInputName = this.findName(
      this.tdtDecoderJointSession.inputNames,
      [/target_length/i],
      2,
    );
    const inputState1Name = this.findName(
      this.tdtDecoderJointSession.inputNames,
      [/input_states_1/i],
      3,
    );
    const inputState2Name = this.findName(
      this.tdtDecoderJointSession.inputNames,
      [/input_states_2/i],
      4,
    );

    let state = this.createInitialTdtState(
      this.tdtDecoderJointSession,
      inputState1Name,
      inputState2Name,
      accessor.hiddenSize,
    );

    const tokenIds: number[] = [];
    const blankTokenId = this.vocabulary.blankTokenId;

    let t = 0;
    let emittedTokens = 0;
    let guard = 0;
    const guardLimit = encodedLength * Math.max(8, this.maxTokensPerStep * 4);

    while (t < encodedLength && guard++ < guardLimit) {
      const encoderStepTensor = new ort.Tensor("float32", accessor.at(t), [
        1,
        accessor.hiddenSize,
        1,
      ]);

      const lastTokenId =
        tokenIds.length > 0 ? tokenIds[tokenIds.length - 1] : blankTokenId;
      const targetsTensor = this.createIntegerTensorForInput(
        this.tdtDecoderJointSession,
        decoderTargetsInputName,
        [lastTokenId],
        [1, 1],
      );
      const targetLengthTensor = this.createIntegerTensorForInput(
        this.tdtDecoderJointSession,
        decoderTargetLengthInputName,
        [1],
        [1],
      );

      const decoderResults = await this.tdtDecoderJointSession.run({
        [decoderEncoderInputName]: encoderStepTensor,
        [decoderTargetsInputName]: targetsTensor,
        [decoderTargetLengthInputName]: targetLengthTensor,
        [inputState1Name]: state.state1,
        [inputState2Name]: state.state2,
      });

      const outputTensor = decoderResults[decoderOutputName] as ort.Tensor;
      const outputData = this.toFloat32Array(outputTensor.data);
      const vocabSize = this.vocabulary.tokens.length;

      if (outputData.length < vocabSize) {
        throw new AppError(
          "Unexpected TDT decoder output shape",
          ErrorCodes.WORKER_INITIALIZATION_FAILED,
        );
      }

      const token = this.argmax(outputData, 0, vocabSize);
      const stepCount =
        outputData.length > vocabSize
          ? this.argmax(outputData, vocabSize, outputData.length - vocabSize)
          : 0;

      if (token !== blankTokenId) {
        tokenIds.push(token);
        emittedTokens++;

        state = {
          state1: decoderResults[outputState1Name] as ort.Tensor,
          state2: decoderResults[outputState2Name] as ort.Tensor,
        };
      }

      if (stepCount > 0) {
        t += stepCount;
        emittedTokens = 0;
      } else if (
        token === blankTokenId ||
        emittedTokens >= this.maxTokensPerStep
      ) {
        t += 1;
        emittedTokens = 0;
      }
    }

    if (guard >= guardLimit) {
      logger.transcription.warn("TDT decoding stopped by safety guard", {
        encodedLength,
        emittedTokens: tokenIds.length,
      });
    }

    return decodeParakeetTokens(tokenIds, this.vocabulary.tokens);
  }

  private async initializeModel(modelId?: string): Promise<void> {
    const requestedId = await this.resolveSelectedParakeetModelId(modelId);
    if (
      this.vocabulary &&
      this.currentModelId === requestedId &&
      this.tdtEncoderSession &&
      this.tdtDecoderJointSession
    ) {
      return;
    }

    const resolved = await this.resolveModelPaths(requestedId);
    await this.releaseSessions();

    const config = await this.loadModelConfig(resolved.configPath);
    this.featureSize =
      typeof config.features_size === "number" ? config.features_size : 128;
    this.maxTokensPerStep =
      typeof config.max_tokens_per_step === "number"
        ? config.max_tokens_per_step
        : 10;
    this.featureExtractor = new ParakeetFeatureExtractor(this.featureSize);

    this.vocabulary = await loadParakeetVocabulary(resolved.vocabPath);

    const preferredProviders =
      process.platform === "win32"
        ? (["dml", "cpu"] as const)
        : process.platform === "darwin"
          ? (["coreml", "cpu"] as const)
          : (["cpu"] as const);

    let preprocessorProviders: readonly string[] | null = null;
    if (resolved.nemoPreprocessorPath) {
      const preprocessorResult = await this.createSessionWithFallback(
        resolved.nemoPreprocessorPath,
        preferredProviders,
      );
      this.tdtPreprocessorSession = preprocessorResult.session;
      preprocessorProviders = preprocessorResult.providersUsed;
    }

    const encoderResult = await this.createSessionWithFallback(
      resolved.encoderModelPath,
      preferredProviders,
    );
    const decoderResult = await this.createSessionWithFallback(
      resolved.decoderJointModelPath,
      preferredProviders,
    );

    this.tdtEncoderSession = encoderResult.session;
    this.tdtDecoderJointSession = decoderResult.session;

    logger.transcription.info("Initialized local Parakeet model", {
      modelId: requestedId,
      nemoPreprocessorPath: resolved.nemoPreprocessorPath || null,
      encoderModelPath: resolved.encoderModelPath,
      decoderJointModelPath: resolved.decoderJointModelPath,
      vocabPath: resolved.vocabPath,
      executionProviders: {
        preprocessor: preprocessorProviders,
        encoder: encoderResult.providersUsed,
        decoder: decoderResult.providersUsed,
      },
      featureSize: this.featureSize,
      maxTokensPerStep: this.maxTokensPerStep,
    });

    this.currentModelId = requestedId;
  }

  private async createSessionWithFallback(
    modelPath: string,
    preferredProviders: readonly string[],
  ): Promise<{
    session: ort.InferenceSession;
    providersUsed: readonly string[];
  }> {
    try {
      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: [...preferredProviders],
      });
      return { session, providersUsed: preferredProviders };
    } catch (error) {
      if (preferredProviders.length > 1) {
        logger.transcription.warn(
          "Parakeet preferred execution provider unavailable, falling back to CPU",
          {
            requestedProviders: preferredProviders,
            modelPath,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        const session = await ort.InferenceSession.create(modelPath, {
          executionProviders: ["cpu"],
        });
        return { session, providersUsed: ["cpu"] };
      }
      throw error;
    }
  }

  private async releaseSessions(): Promise<void> {
    if (this.tdtPreprocessorSession) {
      await this.tdtPreprocessorSession.release();
      this.tdtPreprocessorSession = null;
    }
    if (this.tdtEncoderSession) {
      await this.tdtEncoderSession.release();
      this.tdtEncoderSession = null;
    }
    if (this.tdtDecoderJointSession) {
      await this.tdtDecoderJointSession.release();
      this.tdtDecoderJointSession = null;
    }
  }

  private async resolveSelectedParakeetModelId(
    requestedModelId?: string,
  ): Promise<string> {
    const selectedId =
      requestedModelId || (await this.modelService.getSelectedModel());
    if (!selectedId) {
      throw new AppError("No speech model selected", ErrorCodes.MODEL_MISSING);
    }

    if (!selectedId.startsWith("parakeet-")) {
      throw new AppError(
        `Selected model is not a local Parakeet model: ${selectedId}`,
        ErrorCodes.MODEL_MISSING,
      );
    }

    return selectedId;
  }

  private async resolveModelPaths(
    modelId: string,
  ): Promise<ResolvedParakeetPaths> {
    const downloadedModels = await this.modelService.getDownloadedModels();
    const downloaded = downloadedModels[modelId];

    if (!downloaded?.localPath) {
      throw new AppError(
        `Parakeet model not downloaded: ${modelId}`,
        ErrorCodes.MODEL_MISSING,
      );
    }

    const modelDir = path.dirname(downloaded.localPath);
    const localFiles =
      downloaded.originalModel &&
      typeof downloaded.originalModel === "object" &&
      Array.isArray(
        (downloaded.originalModel as { localFiles?: unknown }).localFiles,
      )
        ? (
            downloaded.originalModel as { localFiles: unknown[] }
          ).localFiles.filter(
            (value): value is string => typeof value === "string",
          )
        : [downloaded.localPath];

    const findFile = (pattern: RegExp): string | undefined =>
      localFiles.find((filePath) => pattern.test(path.basename(filePath)));

    const vocabPath =
      findFile(/^vocab\.txt$/i) || path.join(modelDir, "vocab.txt");

    const decoderJointPathCandidate =
      findFile(/^decoder_joint-model(?:\.int8)?\.onnx$/i) ||
      path.join(modelDir, "decoder_joint-model.int8.onnx");
    const encoderPathCandidate =
      findFile(/^encoder-model(?:\.int8)?\.onnx$/i) ||
      path.join(modelDir, "encoder-model.int8.onnx");
    const decoderJointModelPath = (await this.fileExists(
      decoderJointPathCandidate,
    ))
      ? decoderJointPathCandidate
      : undefined;
    const encoderModelPath = (await this.fileExists(encoderPathCandidate))
      ? encoderPathCandidate
      : undefined;

    if (!decoderJointModelPath || !encoderModelPath) {
      throw new AppError(
        `Parakeet TDT artifacts are incomplete for ${modelId}`,
        ErrorCodes.MODEL_MISSING,
      );
    }

    const configPath =
      findFile(/^config\.json$/i) || path.join(modelDir, "config.json");
    const nemoPathCandidate =
      findFile(/^nemo\d+\.onnx$/i) || path.join(modelDir, "nemo128.onnx");
    const nemoPreprocessorPath = (await this.fileExists(nemoPathCandidate))
      ? nemoPathCandidate
      : undefined;

    return {
      encoderModelPath,
      decoderJointModelPath,
      nemoPreprocessorPath,
      vocabPath,
      configPath,
    };
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async loadModelConfig(
    configPath?: string,
  ): Promise<ParakeetModelConfig> {
    if (!configPath) {
      return {};
    }

    try {
      const content = await fs.readFile(configPath, "utf8");
      const parsed = JSON.parse(content) as ParakeetModelConfig;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private createEncoderAccessor(encoderTensor: ort.Tensor): EncoderAccessor {
    const dims = encoderTensor.dims;
    const data = this.toFloat32Array(encoderTensor.data);

    if (dims.length !== 3 || dims[0] !== 1) {
      throw new AppError(
        `Unexpected Parakeet encoder output dims: ${dims.join("x")}`,
        ErrorCodes.WORKER_INITIALIZATION_FAILED,
      );
    }

    const dim1 = Number(dims[1]);
    const dim2 = Number(dims[2]);

    if (
      !Number.isFinite(dim1) ||
      !Number.isFinite(dim2) ||
      dim1 <= 0 ||
      dim2 <= 0
    ) {
      throw new AppError(
        `Invalid Parakeet encoder output dims: ${dims.join("x")}`,
        ErrorCodes.WORKER_INITIALIZATION_FAILED,
      );
    }

    // Typical NeMo output shape is [1, hidden, time].
    const hiddenFirst = dim1 >= dim2;
    const hiddenSize = hiddenFirst ? dim1 : dim2;
    const timeSteps = hiddenFirst ? dim2 : dim1;

    return {
      hiddenSize,
      timeSteps,
      at: (timeStep: number): Float32Array => {
        const step = Math.max(0, Math.min(timeSteps - 1, timeStep));
        const vector = new Float32Array(hiddenSize);

        if (hiddenFirst) {
          for (let h = 0; h < hiddenSize; h++) {
            vector[h] = data[h * timeSteps + step] ?? 0;
          }
        } else {
          for (let h = 0; h < hiddenSize; h++) {
            vector[h] = data[step * hiddenSize + h] ?? 0;
          }
        }

        return vector;
      },
    };
  }

  private createInitialTdtState(
    session: ort.InferenceSession,
    state1InputName: string,
    state2InputName: string,
    fallbackHiddenSize: number,
  ): TdtDecoderState {
    const state1Shape = this.getInputTensorShape(session, state1InputName);
    const state2Shape = this.getInputTensorShape(session, state2InputName);

    const layers = this.dimToNumber(state1Shape?.[0], 2);
    const hidden1 = this.dimToNumber(state1Shape?.[2], fallbackHiddenSize);
    const hidden2 = this.dimToNumber(state2Shape?.[2], hidden1);

    return {
      state1: new ort.Tensor("float32", new Float32Array(layers * hidden1), [
        layers,
        1,
        hidden1,
      ]),
      state2: new ort.Tensor("float32", new Float32Array(layers * hidden2), [
        layers,
        1,
        hidden2,
      ]),
    };
  }

  private getInputTensorShape(
    session: ort.InferenceSession,
    inputName: string,
  ): ReadonlyArray<number | string> | null {
    const index = session.inputNames.indexOf(inputName);
    if (index < 0) {
      return null;
    }

    const metadata = session.inputMetadata[index];
    if (!metadata || !metadata.isTensor) {
      return null;
    }

    return metadata.shape;
  }

  private dimToNumber(
    value: number | string | undefined,
    fallback: number,
  ): number {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    return fallback;
  }

  private createIntegerTensorForInput(
    session: ort.InferenceSession,
    inputName: string,
    values: number[],
    dims: readonly number[],
  ): ort.Tensor {
    const inputType = this.getInputTensorType(session, inputName);
    if (inputType === "int32") {
      return new ort.Tensor(
        "int32",
        Int32Array.from(values.map((value) => Math.trunc(value))),
        Array.from(dims),
      );
    }

    // Default to int64 for NeMo/Parakeet paths that use long tensors.
    return new ort.Tensor(
      "int64",
      BigInt64Array.from(values.map((value) => BigInt(Math.trunc(value)))),
      Array.from(dims),
    );
  }

  private getInputTensorType(
    session: ort.InferenceSession,
    inputName: string,
  ): ort.Tensor.Type | null {
    const index = session.inputNames.indexOf(inputName);
    if (index < 0) {
      return null;
    }

    const metadata = session.inputMetadata[index];
    if (!metadata || !metadata.isTensor) {
      return null;
    }

    return metadata.type;
  }

  private findName(
    names: readonly string[],
    patterns: RegExp[],
    fallbackIndex = 0,
  ): string {
    for (const pattern of patterns) {
      const matched = names.find((name) => pattern.test(name));
      if (matched) {
        return matched;
      }
    }
    return names[fallbackIndex] || names[0] || "";
  }

  private toFloat32Array(data: ort.Tensor["data"]): Float32Array {
    if (data instanceof Float32Array) {
      return data;
    }
    return Float32Array.from(data as ArrayLike<number>);
  }

  private toBigInt64Array(data: ort.Tensor["data"]): BigInt64Array {
    if (data instanceof BigInt64Array) {
      return data;
    }
    const values = Array.from(data as ArrayLike<number>, (value) =>
      BigInt(Math.trunc(value)),
    );
    return BigInt64Array.from(values);
  }

  private argmax(values: Float32Array, start: number, length: number): number {
    let bestIndex = 0;
    let bestValue = -Number.MAX_VALUE;

    for (let i = 0; i < length; i++) {
      const value = values[start + i] ?? -Number.MAX_VALUE;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }

    return bestIndex;
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
