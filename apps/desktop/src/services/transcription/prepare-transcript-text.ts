import type { FormattingProvider } from "../../pipeline/core/pipeline-types";
import {
  createRemoteFormattingProvider,
  type RemoteFormattingProviderType,
} from "../../pipeline/providers/formatting/remote-formatting-provider-registry";
import { PROVIDER_TYPES } from "../../constants/provider-types";
import { logger } from "../../main/logger";
import { normalizeTranscriptionBoundaries } from "../../utils/boundary-spacing";
import { countWords } from "../../utils/dictation-stats";
import {
  findModelBySelectionValue,
  getModelSelectionKey,
  getSpeechModelSelectionKey,
  isAmicalCloudSelectionValue,
} from "../../utils/model-selection";
import { applyTextReplacements } from "../../utils/text-replacement";
import type { ModelService } from "../model-service";
import type { SettingsService } from "../settings-service";
import type { DictationContext } from "./types";

type FormattingProviderFactory = typeof createRemoteFormattingProvider;

export interface PrepareTranscriptTextDependencies {
  settingsService: SettingsService;
  modelService: Pick<ModelService, "getSyncedProviderModels">;
  createFormattingProvider?: FormattingProviderFactory;
}

export interface PrepareTranscriptTextInput {
  text: string;
  usedCloudProvider: boolean;
  context: DictationContext;
  detectedLanguage?: string | null;
}

export interface PreparedTranscriptText {
  text: string;
  language: string;
  detectedLanguage?: string;
  wordCount: number;
  formattingUsed: boolean;
  formattingModel?: string;
  formattingDuration?: number;
}

async function formatWithProvider(
  provider: FormattingProvider,
  text: string,
  context: DictationContext,
): Promise<{ text: string; duration: number } | null> {
  const startedAt = performance.now();

  try {
    const formattedText = await provider.format({
      text,
      context: {
        style: context.formattingStyle,
        vocabulary: context.vocabulary,
        accessibilityContext: context.accessibilityContext,
        aggregatedTranscription: text,
      },
    });
    const duration = performance.now() - startedAt;

    logger.transcription.info("Text formatted successfully", {
      originalLength: text.length,
      formattedLength: formattedText.length,
      formattingDuration: duration,
    });

    return { text: formattedText, duration };
  } catch (error) {
    logger.transcription.error("Formatting failed, using unformatted text", {
      error,
    });
    return null;
  }
}

export async function prepareTranscriptText(
  input: PrepareTranscriptTextInput,
  dependencies: PrepareTranscriptTextDependencies,
): Promise<PreparedTranscriptText> {
  let text = input.text;
  let formattingUsed = false;
  let formattingModel: string | undefined;
  let formattingDuration: number | undefined;

  const formatterConfig =
    await dependencies.settingsService.getFormatterConfig();

  if (!formatterConfig || !formatterConfig.enabled) {
    logger.transcription.debug("Formatting skipped: disabled in config");
  } else if (!text.trim().length) {
    logger.transcription.debug("Formatting skipped: empty transcription");
  } else if (isAmicalCloudSelectionValue(formatterConfig.modelId)) {
    if (!input.usedCloudProvider) {
      logger.transcription.warn(
        "Formatting skipped: Amical Cloud formatting requires cloud transcription",
      );
    } else {
      formattingUsed = true;
      formattingModel = getSpeechModelSelectionKey("amical-cloud");
    }
  } else {
    const modelId =
      formatterConfig.modelId ||
      (await dependencies.settingsService.getDefaultLanguageModel());
    if (!modelId) {
      logger.transcription.debug(
        "Formatting skipped: no default language model",
      );
    } else {
      const allModels =
        await dependencies.modelService.getSyncedProviderModels();
      const model = findModelBySelectionValue(
        allModels.filter((entry) => entry.type === "language"),
        modelId,
      );

      if (!model) {
        logger.transcription.warn("Formatting skipped: model not found", {
          modelId,
        });
      } else if (model.providerType !== PROVIDER_TYPES.localWhisper) {
        const createFormattingProvider =
          dependencies.createFormattingProvider ??
          createRemoteFormattingProvider;
        const provider = await createFormattingProvider(
          dependencies.settingsService,
          model.providerType as RemoteFormattingProviderType,
          model.id,
        );

        if (!provider) {
          logger.transcription.warn(
            "Formatting skipped: provider config missing",
            {
              provider: model.provider,
            },
          );
        } else {
          logger.transcription.info("Starting formatting", {
            provider: model.provider,
            model: model.id,
          });
          const result = await formatWithProvider(
            provider,
            text,
            input.context,
          );
          if (result) {
            text = result.text;
            formattingDuration = result.duration;
            formattingUsed = true;
            formattingModel = getModelSelectionKey(
              model.providerInstanceId,
              model.type,
              model.id,
            );
          }
        }
      } else {
        logger.transcription.warn("Formatting skipped: unsupported provider", {
          provider: model.provider,
        });
      }
    }
  }

  const textBeforeReplacements = text;
  if (input.context.replacements.size > 0) {
    const beforeReplacements = text;
    text = applyTextReplacements(text, input.context.replacements);
    if (beforeReplacements !== text) {
      logger.transcription.info("Applied vocabulary replacements", {
        replacementCount: input.context.replacements.size,
        originalLength: beforeReplacements.length,
        newLength: text.length,
      });
    }
  }

  const textSelection =
    input.context.accessibilityContext?.context?.textSelection;
  const completeText = input.usedCloudProvider
    ? text
    : normalizeTranscriptionBoundaries(
        text,
        textSelection?.preSelectionText,
        textSelection?.postSelectionText,
      );
  const language = singleRequestedLanguage(input.context.languages);
  const detectedLanguage = sanitizeDetectedLanguage(input.detectedLanguage);

  return {
    text: completeText,
    language,
    detectedLanguage,
    wordCount: countWords(textBeforeReplacements, detectedLanguage ?? language),
    formattingUsed,
    formattingModel,
    formattingDuration,
  };
}

export function accumulateTranscriptionResult(
  results: string[],
  newText: string,
  isCloudProvider: boolean,
): void {
  if (!newText.trim()) {
    return;
  }
  if (isCloudProvider && results.length > 0) {
    results.length = 0;
  }
  results.push(newText);
}

export function sanitizeDetectedLanguage(
  detectedLanguage?: string | null,
): string | undefined {
  const trimmed = detectedLanguage?.trim();
  return trimmed ? trimmed : undefined;
}

export function singleRequestedLanguage(
  languages: string[] | undefined,
): string {
  return languages?.length === 1 ? languages[0] : "auto";
}

export function mergeDetectedLanguage(
  currentLanguage?: string,
  nextLanguage?: string,
): string | undefined {
  return (
    sanitizeDetectedLanguage(nextLanguage) ??
    sanitizeDetectedLanguage(currentLanguage)
  );
}
