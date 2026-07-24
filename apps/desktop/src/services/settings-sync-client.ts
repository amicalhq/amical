import { z } from "zod";

import type { AuthService } from "./auth-service";
import {
  getAmicalClientHeaders,
  getCoreApiUrl,
  getUserAgent,
} from "../utils/http-client";
import {
  axisSyncKeySchema,
  axisSyncOptionalTextSchema,
  axisSyncRequiredTextSchema,
} from "../db/sync-payload";
import type { CanonicalSyncItem, PushSyncResult } from "../db/sync";
import type { SyncCollection, SyncPayload, SyncScopeType } from "../db/schema";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const positiveVersionSchema = z.number().int().positive().safe();
const cursorSchema = z.number().int().nonnegative().safe();
export const DESKTOP_SYNC_COLLECTIONS = [
  "vocabulary",
  "snippet",
] as const satisfies readonly SyncCollection[];
const collectionSchema = z.enum(DESKTOP_SYNC_COLLECTIONS);
const scopeTypeSchema = z.enum(["user", "org"]);

const vocabularyPayloadSchema = z
  .object({
    word: axisSyncKeySchema,
    replacement: axisSyncOptionalTextSchema.nullable(),
  })
  .strict();
const snippetPayloadSchema = z
  .object({
    trigger: axisSyncKeySchema,
    content: axisSyncRequiredTextSchema,
  })
  .strict();

const canonicalEnvelopeSchema = z
  .object({
    collection: z.string().min(1),
    syncId: uuidSchema,
    syncVersion: positiveVersionSchema,
    payload: z.unknown().nullable(),
  })
  .strict();

const bootstrapSchema = z
  .object({
    scopes: z.array(
      z
        .object({
          scopeType: scopeTypeSchema,
          scopeId: z.string().min(1),
          role: z.string().nullable(),
          canWrite: z.boolean(),
          latestSyncVersion: cursorSchema,
        })
        .strict(),
    ),
    capabilities: z
      .object({
        collections: z.array(z.string().min(1)),
        maxPushBatch: z.number().int().positive().max(100),
        maxPushBytes: z.number().int().positive(),
        defaultPullLimit: z.number().int().positive(),
        maxPullLimit: z.number().int().positive(),
        maxPullBytes: z.number().int().positive(),
        oneScopePerPush: z.literal(true),
      })
      .strict(),
  })
  .strict();

const rawPullSchema = z
  .object({
    scopeType: scopeTypeSchema,
    scopeId: z.string().min(1),
    items: z.array(canonicalEnvelopeSchema),
    cursor: cursorSchema,
    hasMore: z.boolean(),
  })
  .strict();

const rawPushResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ok"),
      syncId: uuidSchema,
      syncVersion: positiveVersionSchema,
      applied: z.boolean(),
    })
    .strict(),
  z
    .object({
      status: z.literal("conflict"),
      reason: z.enum(["version_conflict", "duplicate_key_conflict"]),
      syncId: uuidSchema,
      canonical: canonicalEnvelopeSchema.nullable(),
      conflictingItem: canonicalEnvelopeSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("error"),
      syncId: uuidSchema.nullable(),
      reason: z.enum([
        "unauthorized_scope",
        "invalid_payload",
        "invalid_mutation",
      ]),
      message: z.string(),
    })
    .strict(),
]);

const rawPushSchema = z
  .object({ results: z.array(rawPushResultSchema) })
  .strict();

export interface SyncBootstrap {
  collections: SyncCollection[];
  maxPushBatch: number;
  maxPushBytes: number;
  pullLimit: number;
}

export interface SyncPullPage {
  items: CanonicalSyncItem[];
  cursor: number;
  hasMore: boolean;
}

export interface SyncPushMutation {
  collection: SyncCollection;
  scopeType: SyncScopeType;
  scopeId: string;
  syncId: string;
  expectedSyncVersion: number | null;
  payload: SyncPayload | null;
}

export class SettingsSyncHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function parseCanonicalItem(
  raw: z.infer<typeof canonicalEnvelopeSchema>,
): CanonicalSyncItem {
  const collection = collectionSchema.parse(raw.collection);
  if (raw.payload === null) {
    return { ...raw, collection, payload: null };
  }
  const payload =
    collection === "vocabulary"
      ? vocabularyPayloadSchema.parse(raw.payload)
      : snippetPayloadSchema.parse(raw.payload);
  return { ...raw, collection, payload };
}

function payloadKey(
  collection: SyncCollection,
  payload: SyncPayload | null,
): string | null {
  if (payload === null) return null;
  return collection === "vocabulary"
    ? (payload as { word: string }).word
    : (payload as { trigger: string }).trigger;
}

export class SettingsSyncClient {
  constructor(private readonly authService: AuthService) {}

  async bootstrap(
    accountId: string,
    signal: AbortSignal,
  ): Promise<SyncBootstrap> {
    const body = bootstrapSchema.parse(
      await this.requestJson("/apps/v1/sync/bootstrap", {}, signal),
    );
    const userScope = body.scopes.find(
      (scope) =>
        scope.scopeType === "user" &&
        scope.scopeId === accountId &&
        scope.canWrite,
    );
    if (!userScope) {
      throw new Error("Bootstrap omitted the active writable user scope");
    }
    const advertisedCollections = new Set(body.capabilities.collections);
    const collections = DESKTOP_SYNC_COLLECTIONS.filter((collection) =>
      advertisedCollections.has(collection),
    );

    return {
      collections,
      maxPushBatch: body.capabilities.maxPushBatch,
      maxPushBytes: body.capabilities.maxPushBytes,
      pullLimit: body.capabilities.defaultPullLimit,
    };
  }

  async pull(
    scopeType: SyncScopeType,
    scopeId: string,
    cursor: number,
    limit: number,
    signal: AbortSignal,
    collections: readonly SyncCollection[] = DESKTOP_SYNC_COLLECTIONS,
  ): Promise<SyncPullPage> {
    const url = getCoreApiUrl("/apps/v1/sync/pull");
    url.searchParams.set("scopeType", scopeType);
    url.searchParams.set("scopeId", scopeId);
    url.searchParams.set("cursor", String(cursor));
    url.searchParams.set("limit", String(limit));

    const raw = rawPullSchema.parse(await this.requestJson(url, {}, signal));
    if (raw.scopeType !== scopeType || raw.scopeId !== scopeId) {
      throw new Error("Pull response scope does not match request");
    }
    if (raw.cursor < cursor) {
      throw new Error("Pull response cursor moved backwards");
    }
    if (raw.hasMore && raw.items.length === 0) {
      throw new Error("Pull response cannot make cursor progress");
    }
    if (raw.items.length === 0 && raw.cursor !== cursor) {
      throw new Error("Empty pull response advanced the cursor");
    }

    let previousVersion = cursor;
    for (const item of raw.items) {
      if (
        item.syncVersion <= previousVersion ||
        item.syncVersion > raw.cursor
      ) {
        throw new Error("Pull items are not strictly cursor ordered");
      }
      previousVersion = item.syncVersion;
    }
    if (
      raw.items.length > 0 &&
      raw.cursor !== raw.items[raw.items.length - 1].syncVersion
    ) {
      throw new Error("Pull cursor does not match the last item");
    }

    const enabledCollections = new Set<string>(collections);
    const items = raw.items
      .filter((item) => enabledCollections.has(item.collection))
      .map(parseCanonicalItem);

    return { items, cursor: raw.cursor, hasMore: raw.hasMore };
  }

  async push(
    mutations: SyncPushMutation[],
    signal: AbortSignal,
  ): Promise<PushSyncResult[]> {
    const raw = rawPushSchema.parse(
      await this.requestJson(
        "/apps/v1/sync/push",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mutations }),
        },
        signal,
      ),
    );
    if (raw.results.length !== mutations.length) {
      throw new Error("Push response result count does not match request");
    }

    return raw.results.map((result, index) => {
      const mutation = mutations[index];
      if (result.syncId !== mutation.syncId) {
        throw new Error("Push response result identity does not match request");
      }
      if (result.status === "ok") {
        if (
          mutation.expectedSyncVersion !== null &&
          (result.syncVersion < mutation.expectedSyncVersion ||
            (result.applied &&
              result.syncVersion <= mutation.expectedSyncVersion))
        ) {
          throw new Error("Push success returned an invalid sync version");
        }
        return result;
      }
      if (result.status === "error") return result;

      const canonical = result.canonical
        ? parseCanonicalItem(result.canonical)
        : null;
      if (
        canonical &&
        (canonical.syncId !== result.syncId ||
          canonical.collection !== mutation.collection)
      ) {
        throw new Error("Conflict canonical identity does not match result");
      }
      const conflictingItem = result.conflictingItem
        ? parseCanonicalItem(result.conflictingItem)
        : undefined;
      if (
        conflictingItem &&
        conflictingItem.collection !== mutation.collection
      ) {
        throw new Error("Conflicting item collection does not match request");
      }
      if (result.reason === "duplicate_key_conflict" && !conflictingItem) {
        throw new Error("Duplicate conflict omitted the winning item");
      }
      if (
        result.reason === "duplicate_key_conflict" &&
        conflictingItem &&
        (conflictingItem.syncId === result.syncId ||
          conflictingItem.payload === null ||
          payloadKey(conflictingItem.collection, conflictingItem.payload) !==
            payloadKey(mutation.collection, mutation.payload))
      ) {
        throw new Error("Duplicate conflict winner does not match request key");
      }
      if (result.reason === "version_conflict" && conflictingItem) {
        throw new Error("Version conflict included an unrelated item");
      }
      if (
        result.reason === "version_conflict" &&
        ((mutation.expectedSyncVersion === null && canonical === null) ||
          (mutation.expectedSyncVersion !== null &&
            canonical !== null &&
            canonical.syncVersion <= mutation.expectedSyncVersion))
      ) {
        throw new Error("Version conflict returned a non-conflicting version");
      }
      if (
        result.reason === "duplicate_key_conflict" &&
        ((mutation.expectedSyncVersion === null && canonical !== null) ||
          (mutation.expectedSyncVersion !== null &&
            canonical?.syncVersion !== mutation.expectedSyncVersion))
      ) {
        throw new Error("Duplicate conflict canonical does not match base");
      }
      return { ...result, canonical, conflictingItem };
    });
  }

  private async requestJson(
    path: string | URL,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<unknown> {
    const token = await this.authService.getIdToken();
    if (!token) throw new SettingsSyncHttpError("Sign in required", 401);

    const response = await fetch(
      typeof path === "string" ? getCoreApiUrl(path) : path,
      {
        ...init,
        signal,
        headers: {
          "User-Agent": getUserAgent(),
          ...getAmicalClientHeaders(),
          ...init.headers,
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (!response.ok) {
      throw new SettingsSyncHttpError(
        `Settings sync request failed with ${response.status}`,
        response.status,
      );
    }
    return response.json();
  }
}
