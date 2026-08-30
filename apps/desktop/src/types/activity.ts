import { z } from "zod";

import {
  PROVIDER_TYPES,
  SYSTEM_PROVIDER_INSTANCE_IDS,
  type ProviderType,
} from "../constants/provider-types";
import type { DictationSkill } from "../pipeline/providers/transcription/dictation-skill";
import { parseModelSelectionKey } from "../utils/model-selection";

export const ACTIVITY_MAX_BATCH_SIZE = 500;
export const ACTIVITY_MAX_REQUEST_BYTES = 512 * 1024;
export const ACTIVITY_FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ACTIVITY_APP_TYPE = "default";

const ActivityMetadataTextSchema = z.string().trim().min(1);

export const ModelExecutionSchema = z.enum([
  "local",
  "amical_cloud",
  "provider_cloud",
]);

export const ActivityIdSchema = z.string().uuid();

export const ActivityModelSchema = z
  .object({
    provider: ActivityMetadataTextSchema,
    model: ActivityMetadataTextSchema,
    execution: ModelExecutionSchema,
  })
  .strict();

export const ActivitySkillSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("preset"),
      presetId: ActivityMetadataTextSchema,
    })
    .strict(),
  z.object({ kind: z.literal("custom") }).strict(),
]);

export const ActivitySkillsSchema = z.array(ActivitySkillSchema).nullable();

export const CompletedDictationActivityMetadataSchema = z
  .object({
    wordCount: z.number().int().nonnegative(),
    appType: z.string(),
    skills: ActivitySkillsSchema,
    transcription: ActivityModelSchema,
    formatting: ActivityModelSchema.nullable(),
  })
  .strict();

export const DictationActivitySchema = z
  .object({
    activityId: ActivityIdSchema,
    occurredAt: z
      .string()
      .datetime({ offset: true })
      .refine((value) => value.endsWith("Z"), "Timestamp must be UTC"),
    wordCount: z.number().int().nonnegative(),
    audioDurationMs: z.number().int().positive().nullable(),
    appType: z.string().min(1).max(200).nullable(),
    skills: ActivitySkillsSchema,
    transcription: ActivityModelSchema.nullable(),
    formatting: ActivityModelSchema.nullable(),
  })
  .strict();

export const ActivityBatchSchema = z
  .object({
    activities: z
      .array(DictationActivitySchema)
      .min(1)
      .max(ACTIVITY_MAX_BATCH_SIZE),
  })
  .strict();

export type ModelExecution = z.infer<typeof ModelExecutionSchema>;
export type ActivityModel = z.infer<typeof ActivityModelSchema>;
export type ActivitySkill = z.infer<typeof ActivitySkillSchema>;
export type CompletedDictationActivityMetadata = z.infer<
  typeof CompletedDictationActivityMetadataSchema
>;
export type DictationActivity = z.infer<typeof DictationActivitySchema>;

type EndpointProviderType =
  | typeof PROVIDER_TYPES.ollama
  | typeof PROVIDER_TYPES.openAICompatible;
type FixedExecutionProviderType = Exclude<ProviderType, EndpointProviderType>;

export function normalizeActivityAppType(value: unknown) {
  return normalizeHistoricalActivityAppType(value) ?? DEFAULT_ACTIVITY_APP_TYPE;
}

export function normalizeHistoricalActivityAppType(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase().slice(0, 200) || null;
}

export function sanitizeActivitySkills(
  skills: readonly DictationSkill[] | null,
): ActivitySkill[] | null {
  if (skills === null) return null;

  return skills.flatMap((skill): ActivitySkill[] => {
    const presetId = skill.preset?.trim();
    if (presetId) {
      return [{ kind: "preset", presetId }];
    }
    if (skill.customPrompt !== undefined) {
      return [{ kind: "custom" }];
    }
    return [];
  });
}

export function executionForProviderType(
  providerType: FixedExecutionProviderType,
): ModelExecution {
  switch (providerType) {
    case PROVIDER_TYPES.localWhisper:
      return "local";
    case PROVIDER_TYPES.amical:
      return "amical_cloud";
    case PROVIDER_TYPES.openRouter:
      return "provider_cloud";
  }
}

export function activityModelForProvider(
  providerType: FixedExecutionProviderType,
  model: string,
): ActivityModel {
  return ActivityModelSchema.parse({
    provider:
      providerType === PROVIDER_TYPES.localWhisper
        ? "whisper-cpp"
        : providerType,
    model,
    execution: executionForProviderType(providerType),
  });
}

export function activityModelForEndpointProvider(
  provider: EndpointProviderType,
  model: string,
  endpoint: unknown,
): ActivityModel {
  let execution: ModelExecution = "provider_cloud";
  if (typeof endpoint === "string") {
    try {
      const hostname = new URL(endpoint).hostname.toLowerCase();
      if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.startsWith("127.") ||
        hostname === "[::1]" ||
        hostname === "::1"
      ) {
        execution = "local";
      }
    } catch {
      // Persisted invalid URLs cannot safely be classified as local.
    }
  }

  return ActivityModelSchema.parse({
    provider,
    model,
    execution,
  });
}

export function inferHistoricalActivityModel(
  value: unknown,
): ActivityModel | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (!model) return null;

  const parsed = parseModelSelectionKey(model);
  if (parsed) {
    const providerType = (
      Object.entries(SYSTEM_PROVIDER_INSTANCE_IDS) as Array<
        [keyof typeof PROVIDER_TYPES, string]
      >
    ).find(([, instanceId]) => instanceId === parsed.providerInstanceId)?.[0];
    if (providerType === "openAICompatible" || providerType === "ollama") {
      return null;
    }
    return providerType
      ? activityModelForProvider(PROVIDER_TYPES[providerType], parsed.id)
      : null;
  }

  if (model === "amical-cloud") {
    return activityModelForProvider(PROVIDER_TYPES.amical, model);
  }
  if (model.startsWith("whisper-")) {
    return activityModelForProvider(PROVIDER_TYPES.localWhisper, model);
  }
  return null;
}

export function transcriptionActivityModel(
  model: string,
  usedAmicalCloud: boolean,
): ActivityModel {
  return activityModelForProvider(
    usedAmicalCloud ? PROVIDER_TYPES.amical : PROVIDER_TYPES.localWhisper,
    model,
  );
}

export function activityRequestBytes(
  activities: readonly DictationActivity[],
): number {
  return Buffer.byteLength(JSON.stringify({ activities }), "utf8");
}
