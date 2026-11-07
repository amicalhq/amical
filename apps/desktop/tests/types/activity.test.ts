import { describe, expect, it } from "vitest";

import { PROVIDER_TYPES } from "../../src/constants/provider-types";
import {
  ActivityBatchSchema,
  activityModelForEndpointProvider,
  activityModelForProvider,
  DictationActivitySchema,
  inferHistoricalActivityModel,
  normalizeActivityAppType,
  sanitizeActivitySkills,
  transcriptionActivityModel,
} from "../../src/types/activity";

const ACTIVITY_ID = "11111111-1111-4111-8111-111111111111";

describe("dictation activity metadata", () => {
  it("normalizes, caps, and defaults app type", () => {
    expect(normalizeActivityAppType("  EMail  ")).toBe("email");
    expect(normalizeActivityAppType(" X ".repeat(150))).toHaveLength(200);
    expect(normalizeActivityAppType("   ")).toBe("default");
    expect(normalizeActivityAppType(undefined)).toBe("default");
  });

  it("preserves formatting semantics while removing private skill data", () => {
    expect(sanitizeActivitySkills(null)).toBeNull();
    expect(sanitizeActivitySkills([])).toEqual([]);
    expect(
      sanitizeActivitySkills([
        { preset: " instruct ", args: { tone: ["formal"] } },
        {
          customPrompt: "private prompt",
          args: { privateArgument: ["private value"] },
        },
      ]),
    ).toEqual([{ kind: "preset", presetId: "instruct" }, { kind: "custom" }]);
  });

  it("maps local, Amical-managed, direct-provider, and local-provider execution", () => {
    expect(transcriptionActivityModel("whisper-large-v3-turbo", false)).toEqual(
      {
        provider: "whisper-cpp",
        model: "whisper-large-v3-turbo",
        execution: "local",
      },
    );
    expect(transcriptionActivityModel("amical-cloud", true)).toEqual({
      provider: "amical",
      model: "amical-cloud",
      execution: "amical_cloud",
    });
    expect(
      activityModelForProvider(PROVIDER_TYPES.openRouter, "openai/gpt-4.1"),
    ).toEqual({
      provider: "openrouter",
      model: "openai/gpt-4.1",
      execution: "provider_cloud",
    });
    expect(
      activityModelForEndpointProvider(
        PROVIDER_TYPES.openAICompatible,
        "local-model",
        "http://localhost:1234/v1",
      ),
    ).toEqual({
      provider: "openai-compatible",
      model: "local-model",
      execution: "local",
    });
    expect(
      activityModelForEndpointProvider(
        PROVIDER_TYPES.openAICompatible,
        "hosted-model",
        "https://models.example.com/v1",
      ),
    ).toEqual({
      provider: "openai-compatible",
      model: "hosted-model",
      execution: "provider_cloud",
    });
    expect(
      activityModelForEndpointProvider(
        PROVIDER_TYPES.ollama,
        "llama3",
        "http://127.0.0.1:11434",
      ),
    ).toEqual({
      provider: "ollama",
      model: "llama3",
      execution: "local",
    });
  });

  it("recovers only unambiguous historical model metadata", () => {
    expect(inferHistoricalActivityModel("whisper-base")).toEqual({
      provider: "whisper-cpp",
      model: "whisper-base",
      execution: "local",
    });
    expect(inferHistoricalActivityModel("amical-cloud")).toEqual({
      provider: "amical",
      model: "amical-cloud",
      execution: "amical_cloud",
    });
    expect(
      inferHistoricalActivityModel(
        "system-openrouter::language::openai/gpt-4.1-mini",
      ),
    ).toEqual({
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      execution: "provider_cloud",
    });
    expect(
      inferHistoricalActivityModel(
        "custom-provider::language::openai/gpt-4.1-mini",
      ),
    ).toBeNull();
    expect(
      inferHistoricalActivityModel(
        "system-openai-compatible::language::local-or-hosted-model",
      ),
    ).toBeNull();
    expect(
      inferHistoricalActivityModel(
        "system-ollama::language::local-or-hosted-model",
      ),
    ).toBeNull();
    expect(inferHistoricalActivityModel("gpt-4o-mini")).toBeNull();
  });

  it("creates the exact public activity shape without private content", () => {
    const activity = DictationActivitySchema.parse({
      activityId: ACTIVITY_ID,
      occurredAt: "2026-08-28T08:30:00.000Z",
      wordCount: 142,
      audioDurationMs: 32_000,
      appType: normalizeActivityAppType(" Email "),
      skills: sanitizeActivitySkills([
        { customPrompt: "must not persist", args: { secret: ["value"] } },
      ]),
      transcription: transcriptionActivityModel("whisper-tiny", false),
      formatting: activityModelForProvider(
        PROVIDER_TYPES.openRouter,
        "openai/gpt-4.1-mini",
      ),
    });

    expect(activity).toEqual({
      activityId: ACTIVITY_ID,
      occurredAt: "2026-08-28T08:30:00.000Z",
      wordCount: 142,
      audioDurationMs: 32_000,
      appType: "email",
      skills: [{ kind: "custom" }],
      transcription: {
        provider: "whisper-cpp",
        model: "whisper-tiny",
        execution: "local",
      },
      formatting: {
        provider: "openrouter",
        model: "openai/gpt-4.1-mini",
        execution: "provider_cloud",
      },
    });
    expect(JSON.stringify(activity)).not.toContain("must not persist");
    expect(JSON.stringify(activity)).not.toContain("secret");
  });

  it("accepts explicit null only for unavailable historical metadata", () => {
    const historical = {
      activityId: ACTIVITY_ID,
      occurredAt: "2024-01-02T03:04:05.000Z",
      wordCount: 3,
      audioDurationMs: null,
      appType: null,
      skills: null,
      transcription: null,
      formatting: null,
    };

    expect(DictationActivitySchema.parse(historical)).toEqual(historical);
    expect(
      DictationActivitySchema.safeParse({
        ...historical,
        audioDurationMs: undefined,
      }).success,
    ).toBe(false);
  });

  it("rejects batches above the server item limit", () => {
    const item = DictationActivitySchema.parse({
      activityId: ACTIVITY_ID,
      occurredAt: "2026-08-28T08:30:00.000Z",
      wordCount: 4,
      audioDurationMs: 1,
      appType: "default",
      skills: null,
      transcription: transcriptionActivityModel("whisper-tiny", false),
      formatting: null,
    });

    expect(
      ActivityBatchSchema.safeParse({
        activities: Array.from({ length: 501 }, () => item),
      }).success,
    ).toBe(false);
  });
});
