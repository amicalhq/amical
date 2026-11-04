import { z } from 'zod';
import { AppsV1IsoDateTimeSchema } from './common.js';

export const DICTATION_ACTIVITY_LIMITS = {
  maxReportBatch: 500,
  maxReportBytes: 512 * 1024,
  futureToleranceMs: 24 * 60 * 60 * 1000,
} as const;

const ACTIVITY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const DictationActivityIdSchema = z
  .string()
  .transform(value => value.toLowerCase())
  .pipe(z.string().regex(ACTIVITY_ID_RE, 'activityId must be a UUID'));

const MetadataTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    value => !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value),
    'must be well-formed Unicode without null characters'
  );

const AppTypeTextSchema = MetadataTextSchema.transform(value => value.toLowerCase()).pipe(
  MetadataTextSchema
);

export const DictationExecutionSchema = z.enum(['local', 'amical_cloud', 'provider_cloud']);
export type DictationExecution = z.output<typeof DictationExecutionSchema>;

export const DictationModelSchema = z
  .object({
    provider: MetadataTextSchema,
    model: MetadataTextSchema,
    execution: DictationExecutionSchema,
  })
  .strict();
export type DictationModel = z.output<typeof DictationModelSchema>;

export const DictationActivitySkillSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('preset'),
      presetId: MetadataTextSchema,
    })
    .strict(),
  z.object({ kind: z.literal('custom') }).strict(),
]);
export type DictationActivitySkill = z.output<typeof DictationActivitySkillSchema>;

export const DictationActivityReportItemSchema = z
  .object({
    activityId: DictationActivityIdSchema,
    occurredAt: AppsV1IsoDateTimeSchema,
    wordCount: z.number().int().nonnegative().max(2_147_483_647),
    audioDurationMs: z.number().int().positive().max(2_147_483_647).nullable(),
    appType: AppTypeTextSchema.nullable(),
    skills: z.array(DictationActivitySkillSchema).nullable(),
    transcription: DictationModelSchema.nullable(),
    formatting: DictationModelSchema.nullable(),
  })
  .strict();
export type DictationActivityReportItem = z.output<typeof DictationActivityReportItemSchema>;

export const DictationActivityReportRequestSchema = z
  .object({
    activities: z
      .array(DictationActivityReportItemSchema)
      .min(1)
      .max(DICTATION_ACTIVITY_LIMITS.maxReportBatch),
  })
  .strict()
  .superRefine((request, context) => {
    const seen = new Set<string>();
    request.activities.forEach((activity, index) => {
      if (seen.has(activity.activityId)) {
        context.addIssue({
          code: 'custom',
          path: ['activities', index, 'activityId'],
          message: 'activityId must occur at most once per report',
        });
      }
      seen.add(activity.activityId);
    });
  });
export type DictationActivityReportRequest = z.input<typeof DictationActivityReportRequestSchema>;
export type ParsedDictationActivityReportRequest = z.output<
  typeof DictationActivityReportRequestSchema
>;

const WordBreakdownSchema = z
  .object({
    words: z.number().int().nonnegative(),
  })
  .strip();

const ModelWordBreakdownSchema = WordBreakdownSchema.extend({
  provider: z.string().min(1),
  model: z.string().min(1),
  execution: DictationExecutionSchema,
}).strip();

export const DictationActivitySummarySchema = z
  .object({
    totals: z
      .object({
        activities: z.number().int().nonnegative(),
        words: z.number().int().nonnegative(),
        wordsWithAudioDuration: z.number().int().nonnegative(),
        audioDurationMs: z.number().int().positive().nullable(),
      })
      .strip(),
    byAppType: z.array(
      WordBreakdownSchema.extend({
        appType: AppTypeTextSchema.nullable(),
        activities: z.number().int().nonnegative(),
        wordsWithAudioDuration: z.number().int().nonnegative(),
        audioDurationMs: z.number().int().positive().nullable(),
      }).strip()
    ),
    byPlatform: z.array(WordBreakdownSchema.extend({ platform: z.string().min(1) }).strip()),
    byTranscriptionModel: z.array(ModelWordBreakdownSchema),
    byFormattingModel: z.array(ModelWordBreakdownSchema),
  })
  .pick({ totals: true })
  .strip();
export type DictationActivitySummary = z.output<typeof DictationActivitySummarySchema>;

export const DictationActivityReportResponseSchema = z.undefined();
export type DictationActivityReportResponse = z.output<
  typeof DictationActivityReportResponseSchema
>;
