import {
  DICTATION_ACTIVITY_LIMITS,
  DictationActivityIdSchema,
  DictationActivityReportItemSchema,
  DictationActivityReportRequestSchema,
  DictationExecutionSchema,
  type DictationExecution,
} from "@amical/api-contracts/apps/v1";
import { z } from "zod";

import {
  PROVIDER_TYPES,
  SYSTEM_PROVIDER_INSTANCE_IDS,
  type ProviderType,
} from "../constants/provider-types";
import type { DictationSkill } from "../pipeline/providers/transcription/dictation-skill";
import { parseModelSelectionKey } from "../utils/model-selection";

export const ACTIVITY_MAX_BATCH_SIZE = DICTATION_ACTIVITY_LIMITS.maxReportBatch;
export const ACTIVITY_MAX_REQUEST_BYTES =
  DICTATION_ACTIVITY_LIMITS.maxReportBytes;
export const ACTIVITY_FUTURE_TOLERANCE_MS =
  DICTATION_ACTIVITY_LIMITS.futureToleranceMs;
export const DEFAULT_ACTIVITY_APP_TYPE = "default";

export const ActivityIdSchema = DictationActivityIdSchema;
export const DictationActivitySchema = DictationActivityReportItemSchema;
export const ActivityBatchSchema = DictationActivityReportRequestSchema;

// Metadata saved with each dictation. These local schemas do not apply the
// report's length limits: a long custom model name must not fail a dictation.
// The report schemas above apply the limits when the activity is queued.
const ActivityMetadataTextSchema = z.string().trim().min(1);

export const ActivityModelSchema = z
  .object({
    provider: ActivityMetadataTextSchema,
    model: ActivityMetadataTextSchema,
    execution: DictationExecutionSchema,
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

/** The app type saved with a dictation (transcription meta.activity). */
export function activityAppTypeOf(meta: unknown): string | undefined {
  const activity = (
    meta as { activity?: { appType?: unknown } } | null | undefined
  )?.activity;
  return normalizeHistoricalActivityAppType(activity?.appType) ?? undefined;
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
): DictationExecution {
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
  let execution: DictationExecution = "provider_cloud";
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
