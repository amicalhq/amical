import * as fs from "node:fs";
import type { TranscriptionProvider } from "../../pipeline/core/pipeline-types";
import {
  getTranscriptionById,
  updateTranscription,
} from "../../db/transcriptions";
import { incrementDailyStats } from "../../db/daily-stats";
import { logger } from "../../main/logger";
import type { ModelService } from "../model-service";
import type { SettingsService } from "../settings-service";
import type { TelemetryService } from "../telemetry-service";
import { countWords } from "../../utils/dictation-stats";
import { isAmicalCloudSelectionValue } from "../../utils/model-selection";
import { loadDictationContext } from "./load-dictation-context";
import {
  accumulateTranscriptionResult,
  mergeDetectedLanguage,
  prepareTranscriptText,
  sanitizeDetectedLanguage,
} from "./prepare-transcript-text";

const VAD_FRAME_SIZE = 512;

export interface RetranscribeHistoryItemDependencies {
  settingsService: SettingsService;
  modelService: ModelService;
  telemetryService: TelemetryService;
  processVadFrames(frames: Float32Array[]): Promise<number[]>;
  providerForSelectedModel(
    selectedModelId: string | null,
  ): TranscriptionProvider;
  withTranscriptionLock<T>(work: () => Promise<T>): Promise<T>;
  wasModelPreloaded(): boolean;
  isVadEnabled(): boolean;
}

export async function retranscribeHistoryItem(
  transcriptionId: number,
  dependencies: RetranscribeHistoryItemDependencies,
): Promise<string> {
  const retryStartedAt = performance.now();

  const record = await getTranscriptionById(transcriptionId);
  if (!record) {
    throw new Error("Transcription not found");
  }
  if (!record.audioFile) {
    throw new Error("No audio file associated with this transcription");
  }

  await fs.promises.access(record.audioFile);
  const audioData = await readWavAsFloat32(record.audioFile);
  const context = await loadDictationContext({
    settingsService: dependencies.settingsService,
  });
  const retrySessionId = context.sessionId;
  const vocabulary = context.vocabulary;
  const languages = context.languages;

  const selectedModelId = await dependencies.modelService.getSelectedModel();
  const formatterConfig =
    await dependencies.settingsService.getFormatterConfig();
  const shouldUseCloudFormatting =
    formatterConfig?.enabled &&
    isAmicalCloudSelectionValue(formatterConfig.modelId);

  const frames = splitVadFrames(audioData);
  const vadProbabilities = await dependencies.processVadFrames(frames);

  logger.transcription.info("Starting transcription retry", {
    transcriptionId,
    sessionId: retrySessionId,
    audioFile: record.audioFile,
    audioSamples: audioData.length,
    totalFrames: frames.length,
  });

  const transcriptionResults: string[] = [];
  let detectedLanguage = sanitizeDetectedLanguage(record.detectedLanguage);
  let usedCloudProvider = false;

  await dependencies.withTranscriptionLock(async () => {
    const provider = dependencies
      .providerForSelectedModel(selectedModelId)
      .openSession({
        sessionId: retrySessionId,
        modelId: selectedModelId,
      });
    usedCloudProvider = provider.name === "amical-cloud";

    try {
      for (let index = 0; index < frames.length; index++) {
        const previousChunk =
          transcriptionResults.length > 0
            ? transcriptionResults[transcriptionResults.length - 1]
            : undefined;
        const aggregatedTranscription = transcriptionResults.join("");
        const chunkResult = await provider.transcribe({
          audioData: frames[index],
          speechProbability: vadProbabilities[index],
          context: {
            sessionId: retrySessionId,
            vocabulary,
            languages,
            previousChunk,
            aggregatedTranscription: aggregatedTranscription || undefined,
            formattingEnabled: shouldUseCloudFormatting && usedCloudProvider,
          },
        });

        detectedLanguage = mergeDetectedLanguage(
          detectedLanguage,
          chunkResult.detectedLanguage,
        );
        accumulateTranscriptionResult(
          transcriptionResults,
          chunkResult.text,
          usedCloudProvider,
        );
      }

      const aggregatedTranscription = transcriptionResults.join("");
      const finalResult = await provider.flush({
        sessionId: retrySessionId,
        vocabulary,
        languages,
        aggregatedTranscription: aggregatedTranscription || undefined,
        formattingEnabled: shouldUseCloudFormatting && usedCloudProvider,
      });
      detectedLanguage = mergeDetectedLanguage(
        detectedLanguage,
        finalResult.detectedLanguage,
      );
      accumulateTranscriptionResult(
        transcriptionResults,
        finalResult.text,
        usedCloudProvider,
      );
    } finally {
      provider.cancel();
    }
  });

  const prepared = await prepareTranscriptText(
    {
      text: transcriptionResults.join(""),
      usedCloudProvider,
      context,
      detectedLanguage,
    },
    {
      settingsService: dependencies.settingsService,
      modelService: dependencies.modelService,
    },
  );
  const completeTranscription = prepared.text;
  const speechModelId = usedCloudProvider
    ? "amical-cloud"
    : selectedModelId || "whisper-local";
  const previousWordCount = countWords(
    record.text,
    record.detectedLanguage ?? record.language,
  );

  await updateTranscription(transcriptionId, {
    text: completeTranscription,
    detectedLanguage: prepared.detectedLanguage,
    speechModel: speechModelId,
    formattingModel: prepared.formattingModel,
    meta: {
      ...(typeof record.meta === "object" && record.meta !== null
        ? record.meta
        : {}),
      retried: true,
      retriedAt: new Date().toISOString(),
    },
  });

  if (previousWordCount === 0 && prepared.wordCount > 0) {
    try {
      await incrementDailyStats(prepared.wordCount, new Date(), 0);
    } catch (error) {
      logger.transcription.error("Failed to increment retry dictation stats", {
        transcriptionId,
        error,
      });
    }
  }

  const processingDuration = performance.now() - retryStartedAt;
  const audioDurationSeconds = audioData.length / 16000;

  dependencies.telemetryService.trackTranscriptionCompleted({
    session_id: retrySessionId,
    model_id: speechModelId,
    model_preloaded: dependencies.wasModelPreloaded(),
    total_duration_ms: processingDuration,
    processing_duration_ms: processingDuration,
    audio_duration_seconds: audioDurationSeconds,
    realtime_factor:
      audioDurationSeconds && processingDuration
        ? audioDurationSeconds / (processingDuration / 1000)
        : undefined,
    text_length: completeTranscription.length,
    word_count: prepared.wordCount,
    formatting_enabled: prepared.formattingUsed,
    formatting_model: prepared.formattingModel,
    formatting_duration_ms: prepared.formattingDuration,
    vad_enabled: dependencies.isVadEnabled(),
    is_retry: true,
    languages: languages ?? [],
    vocabulary_size: vocabulary.length,
  });

  logger.transcription.info("Transcription retry completed", {
    transcriptionId,
    sessionId: retrySessionId,
    textLength: completeTranscription.length,
    formattingUsed: prepared.formattingUsed,
  });

  return completeTranscription;
}

function splitVadFrames(audioData: Float32Array): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let offset = 0; offset < audioData.length; offset += VAD_FRAME_SIZE) {
    frames.push(
      audioData.subarray(
        offset,
        Math.min(offset + VAD_FRAME_SIZE, audioData.length),
      ),
    );
  }
  return frames;
}

async function readWavAsFloat32(filePath: string): Promise<Float32Array> {
  const fileBuffer = await fs.promises.readFile(filePath);
  const WAV_HEADER_SIZE = 44;
  const pcmData = fileBuffer.subarray(WAV_HEADER_SIZE);
  const int16Array = new Int16Array(
    pcmData.buffer,
    pcmData.byteOffset,
    pcmData.byteLength / 2,
  );
  const float32Array = new Float32Array(int16Array.length);
  for (let index = 0; index < int16Array.length; index++) {
    float32Array[index] = int16Array[index] / 32768;
  }
  return float32Array;
}
