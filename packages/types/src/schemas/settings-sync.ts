import { z } from "zod";

// Hand-maintained structural copy of the Axis settings-sync wire contract.
// Axis owns operational limits and advertises them through bootstrap; only
// invariant payload limits remain fixed here until both repositories share it.
export const SETTINGS_SYNC_KEY_MAX_LENGTH = 60;
export const SETTINGS_SYNC_TEXT_MAX_LENGTH = 4000;

export const SETTINGS_SYNC_COLLECTIONS = ["vocabulary", "snippet"] as const;
export const SettingsSyncCollectionSchema = z.enum(SETTINGS_SYNC_COLLECTIONS);
export type SettingsSyncCollection = z.infer<
  typeof SettingsSyncCollectionSchema
>;

export const SettingsSyncScopeTypeSchema = z.enum(["user", "org"]);
export type SettingsSyncScopeType = z.infer<typeof SettingsSyncScopeTypeSchema>;

export const SettingsSyncUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const settingsSyncRequestUuidSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(SettingsSyncUuidSchema);
const settingsSyncVersionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const settingsSyncCursorSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

function isPostgresCompatibleString(value: string): boolean {
  if (value.includes("\0")) return false;

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length ||
        nextCodeUnit < 0xdc00 ||
        nextCodeUnit > 0xdfff
      ) {
        return false;
      }
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }

  return true;
}

export const SettingsSyncKeySchema = z
  .string()
  .min(1)
  .max(SETTINGS_SYNC_KEY_MAX_LENGTH)
  .refine(
    isPostgresCompatibleString,
    "must be well-formed Unicode without null characters",
  )
  .refine((value) => value.trim().length > 0, "must not be blank");
export const SettingsSyncOptionalTextSchema = z
  .string()
  .max(SETTINGS_SYNC_TEXT_MAX_LENGTH)
  .refine(
    isPostgresCompatibleString,
    "must be well-formed Unicode without null characters",
  );
export const SettingsSyncRequiredTextSchema = z
  .string()
  .min(1)
  .max(SETTINGS_SYNC_TEXT_MAX_LENGTH)
  .refine(
    isPostgresCompatibleString,
    "must be well-formed Unicode without null characters",
  );

export const VocabularySyncPayloadSchema = z
  .object({
    word: SettingsSyncKeySchema,
    replacement: SettingsSyncOptionalTextSchema.nullable().default(null),
  })
  .strict();
export type VocabularySyncPayload = z.infer<typeof VocabularySyncPayloadSchema>;

export const SnippetSyncPayloadSchema = z
  .object({
    trigger: SettingsSyncKeySchema,
    content: SettingsSyncRequiredTextSchema,
  })
  .strict();
export type SnippetSyncPayload = z.infer<typeof SnippetSyncPayloadSchema>;
export type SettingsSyncPayload = VocabularySyncPayload | SnippetSyncPayload;

export const SettingsSyncBootstrapResponseSchema = z
  .object({
    scopes: z.array(
      z
        .object({
          scopeType: SettingsSyncScopeTypeSchema,
          scopeId: z.string().min(1),
          role: z.string().nullable(),
          canWrite: z.boolean(),
          latestSyncVersion: settingsSyncCursorSchema,
        })
        .strip(),
    ),
    capabilities: z
      .object({
        // Collection names are open-ended so older clients can ignore newly
        // advertised collections they do not implement.
        collections: z.array(z.string().min(1)),
        maxPushBatch: z.number().int().positive(),
        maxPushBytes: z.number().int().positive(),
        defaultPullLimit: z.number().int().positive(),
        maxPullLimit: z.number().int().positive(),
        maxPullBytes: z.number().int().positive(),
        oneScopePerPush: z.literal(true),
      })
      .strip(),
  })
  .strip();
export type SettingsSyncBootstrapResponse = z.infer<
  typeof SettingsSyncBootstrapResponseSchema
>;

export const SettingsSyncPullCollectionRequestSchema = z
  .object({
    collection: SettingsSyncCollectionSchema,
    cursor: settingsSyncCursorSchema,
    limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const SettingsSyncPullRequestSchema = z
  .object({
    scopeType: SettingsSyncScopeTypeSchema,
    scopeId: z.string().min(1),
    collections: z
      .array(SettingsSyncPullCollectionRequestSchema)
      .min(1)
      .max(SETTINGS_SYNC_COLLECTIONS.length)
      .superRefine((collections, context) => {
        const seen = new Set<SettingsSyncCollection>();
        collections.forEach((request, index) => {
          if (seen.has(request.collection)) {
            context.addIssue({
              code: "custom",
              path: [index, "collection"],
              message: "collection must be requested at most once",
            });
          }
          seen.add(request.collection);
        });
      }),
  })
  .strict();
export type SettingsSyncPullRequest = z.infer<
  typeof SettingsSyncPullRequestSchema
>;

export const SettingsSyncCanonicalItemSchema = z
  .object({
    // Kept open-ended for additive collection support. The client validates a
    // requested collection's payload after matching the enclosing block.
    collection: z.string().min(1),
    syncId: SettingsSyncUuidSchema,
    syncVersion: settingsSyncVersionSchema,
    payload: z.unknown().nullable(),
  })
  .strip();
export type SettingsSyncCanonicalItem = z.infer<
  typeof SettingsSyncCanonicalItemSchema
>;

export const SettingsSyncPullResponseSchema = z
  .object({
    scopeType: SettingsSyncScopeTypeSchema,
    scopeId: z.string().min(1),
    collections: z.array(
      z
        .object({
          collection: z.string().min(1),
          items: z.array(SettingsSyncCanonicalItemSchema),
          cursor: settingsSyncCursorSchema,
          hasMore: z.boolean(),
        })
        .strip(),
    ),
  })
  .strip();
export type SettingsSyncPullResponse = z.infer<
  typeof SettingsSyncPullResponseSchema
>;

const settingsSyncPushMutationBase = {
  scopeType: SettingsSyncScopeTypeSchema,
  scopeId: z.string().min(1),
  syncId: settingsSyncRequestUuidSchema,
  expectedSyncVersion: settingsSyncVersionSchema.nullable(),
};

export const SettingsSyncPushMutationSchema = z.discriminatedUnion(
  "collection",
  [
    z
      .object({
        ...settingsSyncPushMutationBase,
        collection: z.literal("vocabulary"),
        payload: VocabularySyncPayloadSchema.nullable(),
      })
      .strict(),
    z
      .object({
        ...settingsSyncPushMutationBase,
        collection: z.literal("snippet"),
        payload: SnippetSyncPayloadSchema.nullable(),
      })
      .strict(),
  ],
);
export type SettingsSyncPushMutation = z.infer<
  typeof SettingsSyncPushMutationSchema
>;

export const SettingsSyncPushRequestSchema = z
  .object({
    mutations: z.array(SettingsSyncPushMutationSchema),
  })
  .strict();
export type SettingsSyncPushRequest = z.infer<
  typeof SettingsSyncPushRequestSchema
>;

export const SettingsSyncPushResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ok"),
      syncId: SettingsSyncUuidSchema,
      syncVersion: settingsSyncVersionSchema,
      applied: z.boolean(),
    })
    .strip(),
  z
    .object({
      status: z.literal("conflict"),
      reason: z.enum(["version_conflict", "duplicate_key_conflict"]),
      syncId: SettingsSyncUuidSchema,
      canonical: SettingsSyncCanonicalItemSchema.nullable(),
      conflictingItem: SettingsSyncCanonicalItemSchema.optional(),
    })
    .strip(),
  z
    .object({
      status: z.literal("error"),
      syncId: SettingsSyncUuidSchema.nullable(),
      reason: z.enum([
        "unauthorized_scope",
        "invalid_payload",
        "invalid_mutation",
      ]),
      message: z.string(),
    })
    .strip(),
]);
export type SettingsSyncPushResult = z.infer<
  typeof SettingsSyncPushResultSchema
>;

export const SettingsSyncPushResponseSchema = z
  .object({ results: z.array(SettingsSyncPushResultSchema) })
  .strip();
export type SettingsSyncPushResponse = z.infer<
  typeof SettingsSyncPushResponseSchema
>;
