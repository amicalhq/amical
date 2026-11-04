import { z } from 'zod';

/**
 * Collection sync contracts.
 *
 * The server owns conflict ordering through a server-generated sync version. Clients
 * send whole desired states and the last server version they observed; client
 * clocks never participate in conflict resolution.
 */

export const SYNC_SCOPES = {
  user: 'user',
  org: 'org',
} as const;
export const SyncScopeTypeSchema = z.enum(['user', 'org']);
export type SyncScopeType = z.infer<typeof SyncScopeTypeSchema>;

export const SYNC_COLLECTIONS = {
  vocabulary: 'vocabulary',
  snippet: 'snippet',
  note: 'note',
} as const;
export const SyncCollectionSchema = z.enum(['vocabulary', 'snippet', 'note']);
export type SyncCollection = z.infer<typeof SyncCollectionSchema>;

export const SYNC_LIMITS = {
  maxPushBatch: 100,
  maxPushBytes: 512 * 1024,
  defaultPullLimit: 200,
  maxPullLimit: 500,
  maxPullBytes: 512 * 1024,
} as const;

export const NOTE_SYNC_LIMITS = {
  maxPayloadBytes: 128 * 1024,
  // Applies to the whole push when it contains a note, including tombstones.
  // Three full canonical note conflicts still fit within 512 KiB.
  maxPushBatch: 3,
  maxPullLimit: 20,
} as const;

export function isSyncCollection(value: string): value is SyncCollection {
  return Object.hasOwn(SYNC_COLLECTIONS, value);
}

export function isSyncScopeType(value: string): value is SyncScopeType {
  return Object.hasOwn(SYNC_SCOPES, value);
}

const isPostgresCompatibleString = (value: string) => {
  if (value.includes('\0')) return false;

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return false;
      }
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }

  return true;
};

const SyncKeyTextSchema = z
  .string()
  .min(1)
  .max(60)
  .refine(isPostgresCompatibleString, 'must be well-formed Unicode without null characters');
// Stored rows can hold a blank key, so the payload schemas do not apply this check.
export const SyncKeySchema = SyncKeyTextSchema.refine(
  value => value.trim().length > 0,
  'must not be blank'
);
export const SyncOptionalTextSchema = z
  .string()
  .max(4000)
  .refine(isPostgresCompatibleString, 'must be well-formed Unicode without null characters');
export const SyncRequiredTextSchema = z
  .string()
  .min(1)
  .max(4000)
  .refine(isPostgresCompatibleString, 'must be well-formed Unicode without null characters');

export const VocabularyPayloadSchema = z
  .object({
    word: SyncKeyTextSchema,
    replacement: SyncOptionalTextSchema.nullable().default(null),
  })
  .strict();
export type VocabularyPayloadInput = z.input<typeof VocabularyPayloadSchema>;
export type VocabularyPayload = z.output<typeof VocabularyPayloadSchema>;

export const SnippetPayloadSchema = z
  .object({
    trigger: SyncKeyTextSchema,
    content: SyncRequiredTextSchema,
  })
  .strict();
export type SnippetPayloadInput = z.input<typeof SnippetPayloadSchema>;
export type SnippetPayload = z.output<typeof SnippetPayloadSchema>;

const NoteTextSchema = z
  .string()
  .refine(isPostgresCompatibleString, 'must be well-formed Unicode without null characters');
const NoteBodySchema = z
  .object({
    format: z.literal('markdown'),
    content: NoteTextSchema.max(NOTE_SYNC_LIMITS.maxPayloadBytes),
  })
  .strict();
const NotePayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: NoteTextSchema.max(1024),
    icon: NoteTextSchema.max(64).nullable(),
    body: NoteBodySchema,
    // Display metadata only; client clocks never order sync writes.
    createdAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    updatedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

// Count serialized UTF-8 without requiring Node Buffer or a TextEncoder polyfill
// in clients. JSON.stringify also accounts for quotes and escaped controls.
function notePayloadFits(payload: z.infer<typeof NotePayloadObjectSchema>): boolean {
  let bytes = 0;
  for (const character of JSON.stringify(payload)) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > NOTE_SYNC_LIMITS.maxPayloadBytes) return false;
  }
  return true;
}
const noteSizeMessage = `note payload must be at most ${NOTE_SYNC_LIMITS.maxPayloadBytes} UTF-8 JSON bytes`;
export const NotePayloadSchema = NotePayloadObjectSchema.refine(notePayloadFits, noteSizeMessage);
export type NotePayloadInput = z.input<typeof NotePayloadSchema>;
export type NotePayload = z.output<typeof NotePayloadSchema>;

const VocabularyResponsePayloadSchema = VocabularyPayloadSchema.strip();
const SnippetResponsePayloadSchema = SnippetPayloadSchema.strip();
const NoteResponsePayloadSchema = NotePayloadObjectSchema.strip()
  .extend({ body: NoteBodySchema.strip() })
  .refine(notePayloadFits, noteSizeMessage);

export const SyncPayloadSchema = z.union([
  VocabularyPayloadSchema,
  SnippetPayloadSchema,
  NotePayloadSchema,
]);
export type SyncPayloadInput = z.input<typeof SyncPayloadSchema>;
export type SyncPayload = z.output<typeof SyncPayloadSchema>;

const KEY_SOURCES: Record<SyncCollection, (payload: SyncPayload) => string | null> = {
  vocabulary: payload => (payload as VocabularyPayload).word,
  snippet: payload => (payload as SnippetPayload).trigger,
  note: () => null,
};

const PAYLOAD_SCHEMAS: Record<SyncCollection, z.ZodType<SyncPayload>> = {
  vocabulary: VocabularyPayloadSchema,
  snippet: SnippetPayloadSchema,
  note: NotePayloadSchema,
};

/** Settings keys preserve case/whitespace. Notes have no natural key; use their syncId. */
export function deriveSyncKey(collection: 'vocabulary', payload: VocabularyPayload): string;
export function deriveSyncKey(collection: 'snippet', payload: SnippetPayload): string;
export function deriveSyncKey(collection: 'note', payload: NotePayload): null;
export function deriveSyncKey(collection: SyncCollection, payload: SyncPayload): string | null {
  const parsed = PAYLOAD_SCHEMAS[collection].parse(payload);
  return KEY_SOURCES[collection](parsed);
}

export type ParsedSyncPayload =
  | { ok: true; payload: SyncPayload; key: string | null }
  | { ok: false; error: string };

export function parseSyncPayload(collection: SyncCollection, raw: unknown): ParsedSyncPayload {
  const parsed = PAYLOAD_SCHEMAS[collection].safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(issue => `${issue.path.join('.') || 'payload'}: ${issue.message}`)
      .join('; ');
    return { ok: false, error: issues };
  }

  const key = KEY_SOURCES[collection](parsed.data);
  if (key !== null && !key.trim()) return { ok: false, error: 'word/trigger must not be blank' };
  return { ok: true, payload: parsed.data, key };
}

const SYNC_ID_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:nt|voc|snp)_[a-z][a-z0-9]{23})$/;
export const SyncIdSchema = z
  .string()
  .transform(value => value.toLowerCase())
  .pipe(z.string().regex(SYNC_ID_RE, 'syncId must be a UUID or a full prefixed CUID2'));
export type SyncId = z.infer<typeof SyncIdSchema>;
const SyncVersionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const SyncCursorSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const SyncPushMutationBaseSchema = z.object({
  scopeType: SyncScopeTypeSchema,
  scopeId: z.string().min(1),
  syncId: SyncIdSchema,
  expectedSyncVersion: SyncVersionSchema.nullable(),
});

export const SyncPushMutationSchema = z.discriminatedUnion('collection', [
  SyncPushMutationBaseSchema.extend({
    collection: z.literal('vocabulary'),
    payload: VocabularyPayloadSchema.nullable(),
  }).strict(),
  SyncPushMutationBaseSchema.extend({
    collection: z.literal('snippet'),
    payload: SnippetPayloadSchema.nullable(),
  }).strict(),
  SyncPushMutationBaseSchema.extend({
    collection: z.literal('note'),
    scopeType: z.literal('user'),
    payload: NotePayloadSchema.nullable(),
  }).strict(),
]);
export type SyncPushMutation = z.input<typeof SyncPushMutationSchema>;
export type ParsedSyncPushMutation = z.output<typeof SyncPushMutationSchema>;

export const SyncPushRequestSchema = z
  .object({
    mutations: z.array(SyncPushMutationSchema).max(SYNC_LIMITS.maxPushBatch),
  })
  .strict()
  .refine(
    ({ mutations }) =>
      !mutations.some(item => item.collection === 'note') ||
      mutations.length <= NOTE_SYNC_LIMITS.maxPushBatch,
    `pushes containing notes allow at most ${NOTE_SYNC_LIMITS.maxPushBatch} mutations`
  );
export type SyncPushRequest = z.input<typeof SyncPushRequestSchema>;
export type ParsedSyncPushRequest = z.output<typeof SyncPushRequestSchema>;

const SyncCanonicalItemBaseSchema = z.object({
  syncId: SyncIdSchema,
  syncVersion: SyncVersionSchema,
});

export const SyncCanonicalItemSchema = z.discriminatedUnion('collection', [
  SyncCanonicalItemBaseSchema.extend({
    collection: z.literal('vocabulary'),
    payload: VocabularyResponsePayloadSchema.nullable(),
  }).strip(),
  SyncCanonicalItemBaseSchema.extend({
    collection: z.literal('snippet'),
    payload: SnippetResponsePayloadSchema.nullable(),
  }).strip(),
  SyncCanonicalItemBaseSchema.extend({
    collection: z.literal('note'),
    payload: NoteResponsePayloadSchema.nullable(),
  }).strip(),
]);
export type SyncCanonicalItem = z.infer<typeof SyncCanonicalItemSchema>;

export const SyncPushResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ok'),
      syncId: SyncIdSchema,
      syncVersion: SyncVersionSchema,
      applied: z.boolean(),
    })
    .strip(),
  z
    .object({
      status: z.literal('conflict'),
      reason: z.enum(['version_conflict', 'duplicate_key_conflict']),
      syncId: SyncIdSchema,
      canonical: SyncCanonicalItemSchema.nullable(),
      conflictingItem: SyncCanonicalItemSchema.optional(),
    })
    .strip(),
  z
    .object({
      syncId: SyncIdSchema.nullable(),
      status: z.literal('error'),
      reason: z.enum(['unauthorized_scope', 'invalid_payload', 'invalid_mutation']),
      message: z.string(),
    })
    .strip(),
]);
export type SyncPushResult = z.infer<typeof SyncPushResultSchema>;

export const SyncPushResponseSchema = z.object({ results: z.array(SyncPushResultSchema) }).strip();
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;

export const SyncBootstrapResponseSchema = z
  .object({
    scopes: z.array(
      z
        .object({
          scopeType: SyncScopeTypeSchema,
          scopeId: z.string().min(1),
          role: z.string().nullable(),
          canWrite: z.boolean(),
          latestSyncVersion: SyncCursorSchema,
        })
        .strip()
    ),
    capabilities: z
      .object({
        collections: z.array(z.string().min(1)),
        maxPushBatch: z.number().int().positive(),
        maxPushBytes: z.number().int().positive(),
        defaultPullLimit: z.number().int().positive(),
        maxPullLimit: z.number().int().positive(),
        maxPullBytes: z.number().int().positive(),
        oneScopePerPush: z.boolean(),
        note: z
          .object({
            scopeType: z.literal('user'),
            maxPayloadBytes: z.number().int().positive(),
            maxPushBatch: z.number().int().positive(),
            maxPullLimit: z.number().int().positive(),
          })
          .strip()
          .optional(),
      })
      .strip(),
  })
  .strip();
export type SyncBootstrapResponse = z.infer<typeof SyncBootstrapResponseSchema>;

export const SyncPullCollectionRequestSchema = z
  .object({
    collection: SyncCollectionSchema,
    cursor: SyncCursorSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(SYNC_LIMITS.maxPullLimit)
      .optional()
      .default(SYNC_LIMITS.defaultPullLimit),
  })
  .strict();
export type SyncPullCollectionRequest = z.input<typeof SyncPullCollectionRequestSchema>;
export type ParsedSyncPullCollectionRequest = z.output<typeof SyncPullCollectionRequestSchema>;

const SyncPullCollectionsQuerySchema = z
  .string()
  .transform((raw, context) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      context.addIssue({ code: 'custom', message: 'collections must be valid JSON' });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(SyncPullCollectionRequestSchema)
      .min(1)
      .max(Object.keys(SYNC_COLLECTIONS).length)
      .superRefine((collections, context) => {
        const seen = new Set<SyncCollection>();
        collections.forEach((request, index) => {
          if (seen.has(request.collection)) {
            context.addIssue({
              code: 'custom',
              path: [index, 'collection'],
              message: 'collection must be requested at most once',
            });
          }
          seen.add(request.collection);
        });
      })
  );

export const SyncPullQuerySchema = z
  .object({
    scopeType: SyncScopeTypeSchema,
    scopeId: z.string().min(1),
    collections: SyncPullCollectionsQuerySchema,
  })
  .strict();
export type SyncPullQuery = z.input<typeof SyncPullQuerySchema>;
export type ParsedSyncPullQuery = z.output<typeof SyncPullQuerySchema>;

export const SyncPullResponseSchema = z
  .object({
    scopeType: SyncScopeTypeSchema,
    scopeId: z.string().min(1),
    collections: z.array(
      z
        .object({
          collection: SyncCollectionSchema,
          items: z.array(SyncCanonicalItemSchema),
          cursor: SyncCursorSchema,
          hasMore: z.boolean(),
        })
        .strip()
    ),
  })
  .strip();
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;
