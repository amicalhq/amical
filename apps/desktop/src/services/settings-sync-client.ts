import {
  SETTINGS_SYNC_COLLECTIONS,
  SettingsSyncBootstrapResponseSchema,
  SettingsSyncCollectionSchema,
  SettingsSyncPullRequestSchema,
  SettingsSyncPullResponseSchema,
  SettingsSyncPushRequestSchema,
  SettingsSyncPushResponseSchema,
  SnippetSyncPayloadSchema,
  VocabularySyncPayloadSchema,
  type SettingsSyncCanonicalItem,
} from "@amical/types";

import type { AuthService } from "./auth-service";
import {
  getAmicalClientHeaders,
  getCoreApiUrl,
  getUserAgent,
} from "../utils/http-client";
import type {
  CanonicalSyncItem,
  PullCollectionCursor,
  PushSyncResult,
} from "../db/sync";
import type { SyncCollection, SyncPayload, SyncScopeType } from "../db/schema";

export const DESKTOP_SYNC_COLLECTIONS =
  SETTINGS_SYNC_COLLECTIONS satisfies readonly SyncCollection[];

export interface SyncBootstrap {
  collections: SyncCollection[];
  maxPushBatch: number;
  maxPushBytes: number;
  pullLimit: number;
}

export interface SyncPullCollectionPage {
  collection: SyncCollection;
  items: CanonicalSyncItem[];
  cursor: number;
  hasMore: boolean;
}

export interface SyncPullPage {
  collections: SyncPullCollectionPage[];
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

function parseCanonicalItem(raw: SettingsSyncCanonicalItem): CanonicalSyncItem {
  const collection = SettingsSyncCollectionSchema.parse(raw.collection);
  if (raw.payload === null) {
    return { ...raw, collection, payload: null };
  }
  const payload =
    collection === "vocabulary"
      ? VocabularySyncPayloadSchema.parse(raw.payload)
      : SnippetSyncPayloadSchema.parse(raw.payload);
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
    const body = SettingsSyncBootstrapResponseSchema.parse(
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
    cursors: readonly PullCollectionCursor[],
    limit: number,
    signal: AbortSignal,
  ): Promise<SyncPullPage> {
    const request = SettingsSyncPullRequestSchema.parse({
      scopeType,
      scopeId,
      collections: cursors.map(({ collection, cursor }) => ({
        collection,
        cursor,
        limit,
      })),
    });
    const url = getCoreApiUrl("/apps/v1/sync/pull");
    url.searchParams.set("scopeType", request.scopeType);
    url.searchParams.set("scopeId", request.scopeId);
    url.searchParams.set("collections", JSON.stringify(request.collections));

    const raw = SettingsSyncPullResponseSchema.parse(
      await this.requestJson(url, {}, signal),
    );
    if (raw.scopeType !== scopeType || raw.scopeId !== scopeId) {
      throw new Error("Pull response scope does not match request");
    }

    const cursorByCollection = new Map(
      cursors.map((cursor) => [cursor.collection, cursor.cursor]),
    );
    if (cursorByCollection.size !== cursors.length) {
      throw new Error("Pull request contains duplicate collections");
    }
    if (raw.collections.length !== cursors.length) {
      throw new Error("Pull response collection count does not match request");
    }

    const pageByCollection = new Map<SyncCollection, SyncPullCollectionPage>();
    for (const block of raw.collections) {
      const collection = SettingsSyncCollectionSchema.safeParse(
        block.collection,
      );
      if (!collection.success || !cursorByCollection.has(collection.data)) {
        throw new Error("Pull response contains an unrequested collection");
      }
      if (pageByCollection.has(collection.data)) {
        throw new Error("Pull response contains a duplicate collection");
      }

      const inputCursor = cursorByCollection.get(collection.data)!;
      if (block.cursor < inputCursor) {
        throw new Error("Pull response cursor moved backwards");
      }
      if (block.hasMore && block.items.length === 0) {
        throw new Error("Pull response cannot make cursor progress");
      }
      if (block.items.length === 0 && block.cursor !== inputCursor) {
        throw new Error("Empty pull response advanced the cursor");
      }

      let previousVersion = inputCursor;
      const items = block.items.map((item) => {
        if (item.collection !== collection.data) {
          throw new Error("Pull item collection does not match its block");
        }
        if (
          item.syncVersion <= previousVersion ||
          item.syncVersion > block.cursor
        ) {
          throw new Error("Pull items are not strictly cursor ordered");
        }
        previousVersion = item.syncVersion;
        return parseCanonicalItem(item);
      });
      if (
        items.length > 0 &&
        block.cursor !== items[items.length - 1].syncVersion
      ) {
        throw new Error("Pull cursor does not match the last item");
      }

      pageByCollection.set(collection.data, {
        collection: collection.data,
        items,
        cursor: block.cursor,
        hasMore: block.hasMore,
      });
    }

    return {
      collections: cursors.map(({ collection }) => {
        const page = pageByCollection.get(collection);
        if (!page) throw new Error("Pull response omitted a collection");
        return page;
      }),
    };
  }

  async push(
    mutations: SyncPushMutation[],
    signal: AbortSignal,
  ): Promise<PushSyncResult[]> {
    const request = SettingsSyncPushRequestSchema.parse({ mutations });
    const raw = SettingsSyncPushResponseSchema.parse(
      await this.requestJson(
        "/apps/v1/sync/push",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        signal,
      ),
    );
    if (raw.results.length !== mutations.length) {
      throw new Error("Push response result count does not match request");
    }

    return raw.results.map((result, index) => {
      const mutation = request.mutations[index];
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
