import { describe, expect, it, vi } from "vitest";
import { PROVIDER_TYPES } from "../../src/constants/provider-types";
import type { ModelService } from "../../src/services/model-service";
import type { SettingsService } from "../../src/services/settings-service";
import {
  accumulateTranscriptionResult,
  mergeDetectedLanguage,
  prepareTranscriptText,
  type PrepareTranscriptTextDependencies,
  singleRequestedLanguage,
} from "../../src/services/transcription/prepare-transcript-text";
import type { DictationContext } from "../../src/services/transcription/types";
import { getSpeechModelSelectionKey } from "../../src/utils/model-selection";

type SyncedModel = Awaited<
  ReturnType<
    Pick<ModelService, "getSyncedProviderModels">["getSyncedProviderModels"]
  >
>[number];

function createFormatterModel(): SyncedModel {
  return {
    id: "formatter-model",
    providerType: PROVIDER_TYPES.openRouter,
    providerInstanceId: "system-openrouter",
    provider: "OpenRouter",
    name: "Formatter",
    type: "language",
    size: null,
    context: null,
    description: null,
    localPath: null,
    sizeBytes: null,
    checksum: null,
    downloadedAt: null,
    originalModel: null,
    speed: null,
    accuracy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createContext(
  overrides: Partial<DictationContext> = {},
): DictationContext {
  return {
    sessionId: "session-1",
    vocabulary: [],
    replacements: new Map(),
    languages: ["en"],
    formattingStyle: "formal",
    audio: { source: "microphone" },
    accessibilityContext: null,
    cloudFormattingEnabled: false,
    isInstruct: false,
    ...overrides,
  };
}

function createDependencies(options?: {
  formatterConfig?: { enabled: boolean; modelId?: string } | null;
  models?: Awaited<
    ReturnType<
      Pick<ModelService, "getSyncedProviderModels">["getSyncedProviderModels"]
    >
  >;
  createFormattingProvider?: PrepareTranscriptTextDependencies["createFormattingProvider"];
}): PrepareTranscriptTextDependencies {
  const settingsService = {
    getFormatterConfig: vi.fn(
      async () => options?.formatterConfig ?? { enabled: false },
    ),
    getDefaultLanguageModel: vi.fn(async () => undefined),
  } as unknown as SettingsService;
  const modelService = {
    getSyncedProviderModels: vi.fn(async () => options?.models ?? []),
  };

  return {
    settingsService,
    modelService,
    createFormattingProvider: options?.createFormattingProvider,
  };
}

describe("prepareTranscriptText", () => {
  it("applies replacements after formatting policy and counts the pre-replacement text", async () => {
    const result = await prepareTranscriptText(
      {
        text: "hello",
        usedCloudProvider: false,
        context: createContext({
          replacements: new Map([["hello", "hello world"]]),
        }),
        detectedLanguage: " en ",
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      text: "hello world ",
      language: "en",
      detectedLanguage: "en",
      wordCount: 1,
      formattingUsed: false,
    });
  });

  it("normalizes local boundaries using the insertion context", async () => {
    const result = await prepareTranscriptText(
      {
        text: "hello",
        usedCloudProvider: false,
        context: createContext({
          accessibilityContext: {
            context: {
              textSelection: {
                preSelectionText: "Before ",
                postSelectionText: " after",
              },
            },
          } as DictationContext["accessibilityContext"],
        }),
      },
      createDependencies(),
    );

    expect(result.text).toBe("hello");
  });

  it("recognizes formatting already performed by Amical Cloud and skips local boundary changes", async () => {
    const createFormattingProvider = vi.fn();
    const result = await prepareTranscriptText(
      {
        text: "cloud result",
        usedCloudProvider: true,
        context: createContext(),
      },
      createDependencies({
        formatterConfig: { enabled: true, modelId: "amical-cloud" },
        createFormattingProvider,
      }),
    );

    expect(result).toMatchObject({
      text: "cloud result",
      formattingUsed: true,
      formattingModel: getSpeechModelSelectionKey("amical-cloud"),
    });
    expect(createFormattingProvider).not.toHaveBeenCalled();
  });

  it("does not apply Amical Cloud formatting to a local transcription", async () => {
    const createFormattingProvider = vi.fn();
    const result = await prepareTranscriptText(
      {
        text: "local result",
        usedCloudProvider: false,
        context: createContext(),
      },
      createDependencies({
        formatterConfig: { enabled: true, modelId: "amical-cloud" },
        createFormattingProvider,
      }),
    );

    expect(result).toMatchObject({
      text: "local result ",
      formattingUsed: false,
    });
    expect(createFormattingProvider).not.toHaveBeenCalled();
  });

  it("runs a selected remote formatter before replacements", async () => {
    const format = vi.fn(async () => "formatted shortcut");
    const createFormattingProvider = vi.fn(async () => ({
      name: "fake-formatter",
      format,
    })) as PrepareTranscriptTextDependencies["createFormattingProvider"];
    const result = await prepareTranscriptText(
      {
        text: "raw",
        usedCloudProvider: false,
        context: createContext({
          replacements: new Map([["shortcut", "expanded text"]]),
        }),
      },
      createDependencies({
        formatterConfig: { enabled: true, modelId: "formatter-model" },
        models: [createFormatterModel()],
        createFormattingProvider,
      }),
    );

    expect(format).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "raw",
        context: expect.objectContaining({
          aggregatedTranscription: "raw",
        }),
      }),
    );
    expect(result.text).toBe("formatted expanded text ");
    expect(result.wordCount).toBe(2);
    expect(result.formattingUsed).toBe(true);
    expect(result.formattingModel).toBe(
      "system-openrouter::language::formatter-model",
    );
  });

  it("uses unformatted text when a remote formatter fails", async () => {
    const createFormattingProvider = vi.fn(async () => ({
      name: "fake-formatter",
      format: vi.fn(async () => {
        throw new Error("formatter unavailable");
      }),
    })) as PrepareTranscriptTextDependencies["createFormattingProvider"];

    const result = await prepareTranscriptText(
      {
        text: "raw text",
        usedCloudProvider: false,
        context: createContext(),
      },
      createDependencies({
        formatterConfig: { enabled: true, modelId: "formatter-model" },
        models: [createFormatterModel()],
        createFormattingProvider,
      }),
    );

    expect(result).toMatchObject({
      text: "raw text ",
      formattingUsed: false,
    });
  });
});

describe("transcription result helpers", () => {
  it("appends local deltas and replaces cumulative cloud results", () => {
    const localResults = ["first"];
    accumulateTranscriptionResult(localResults, " second", false);
    expect(localResults).toEqual(["first", " second"]);

    const cloudResults = ["first"];
    accumulateTranscriptionResult(cloudResults, "first second", true);
    expect(cloudResults).toEqual(["first second"]);
  });

  it("normalizes requested and detected languages", () => {
    expect(singleRequestedLanguage(undefined)).toBe("auto");
    expect(singleRequestedLanguage(["en", "es"])).toBe("auto");
    expect(singleRequestedLanguage(["ja"])).toBe("ja");
    expect(mergeDetectedLanguage(" en ", " ")).toBe("en");
    expect(mergeDetectedLanguage("en", " ja ")).toBe("ja");
  });
});
