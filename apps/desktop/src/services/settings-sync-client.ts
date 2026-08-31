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
import { Effect } from "effect";

import type { AuthService } from "./auth-service";
import {
  SettingsSyncContractFailure,
  SettingsSyncDependencyFailure,
  type SettingsSyncClientError,
  type SettingsSyncOperation,
} from "./settings-sync-errors";
import {
  getAmicalClientHeaders,
  getCoreApiUrl,
  getUserAgent,
} from "../utils/http-client";
import {
  AuthenticationRequired,
  CloudNetworkFailure,
  decodeCloudHttpFailure,
} from "../types/errors/cloud-request";
import type {
  CanonicalSyncItem,
  PullCollectionCursor,
  PushSyncResult,
} from "../db/sync";
import type { SyncCollection, SyncPayload, SyncScopeType } from "../db/schema";

export const DESKTOP_SYNC_COLLECTIONS =
  SETTINGS_SYNC_COLLECTIONS satisfies readonly SyncCollection[];

export interface SyncBootstrap {
  scopes: SyncBootstrapScope[];
  collections: SyncCollection[];
  maxPushBatch: number;
  maxPushBytes: number;
  pullLimit: number;
}

export interface SyncBootstrapScope {
  scopeType: SyncScopeType;
  scopeId: string;
  role: string | null;
  canWrite: boolean;
  latestSyncVersion: number;
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

  bootstrap(
    accountId: string,
  ): Effect.Effect<SyncBootstrap, SettingsSyncClientError> {
    return Effect.gen(this, function* () {
      const raw = yield* this.requestJson(
        "bootstrap",
        "/apps/v1/sync/bootstrap",
        {},
      );
      return yield* Effect.try({
        try: () => {
          const body = SettingsSyncBootstrapResponseSchema.parse(raw);
          const userScope = body.scopes.find(
            (scope) =>
              scope.scopeType === "user" &&
              scope.scopeId === accountId &&
              scope.canWrite,
          );
          if (!userScope) {
            throw new Error("Bootstrap omitted the active writable user scope");
          }
          const organizationScopes = body.scopes.filter(
            (scope) => scope.scopeType === "org",
          );
          if (organizationScopes.length > 1) {
            throw new Error(
              "Bootstrap advertised more than one active organization",
            );
          }
          const advertisedCollections = new Set(body.capabilities.collections);
          const collections = DESKTOP_SYNC_COLLECTIONS.filter((collection) =>
            advertisedCollections.has(collection),
          );

          return {
            scopes: [userScope, ...organizationScopes],
            collections,
            maxPushBatch: body.capabilities.maxPushBatch,
            maxPushBytes: body.capabilities.maxPushBytes,
            pullLimit: Math.min(
              body.capabilities.defaultPullLimit,
              body.capabilities.maxPullLimit,
            ),
          };
        },
        catch: (error) => this.contractFailure("bootstrap", "response", error),
      });
    });
  }

  pull(
    scopeType: SyncScopeType,
    scopeId: string,
    cursors: readonly PullCollectionCursor[],
    limit: number,
  ): Effect.Effect<SyncPullPage, SettingsSyncClientError> {
    return Effect.gen(this, function* () {
      const url = yield* Effect.try({
        try: () => {
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
          url.searchParams.set(
            "collections",
            JSON.stringify(request.collections),
          );
          return url;
        },
        catch: (error) => this.contractFailure("pull", "request", error),
      });
      const response = yield* this.requestJson("pull", url, {});

      return yield* Effect.try({
        try: () => {
          const raw = SettingsSyncPullResponseSchema.parse(response);
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
            throw new Error(
              "Pull response collection count does not match request",
            );
          }

          const pageByCollection = new Map<
            SyncCollection,
            SyncPullCollectionPage
          >();
          for (const block of raw.collections) {
            const collection = SettingsSyncCollectionSchema.safeParse(
              block.collection,
            );
            if (
              !collection.success ||
              !cursorByCollection.has(collection.data)
            ) {
              throw new Error(
                "Pull response contains an unrequested collection",
              );
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
                throw new Error(
                  "Pull item collection does not match its block",
                );
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
        },
        catch: (error) => this.contractFailure("pull", "response", error),
      });
    });
  }

  push(
    mutations: SyncPushMutation[],
  ): Effect.Effect<PushSyncResult[], SettingsSyncClientError> {
    return Effect.gen(this, function* () {
      const request = yield* Effect.try({
        try: () => SettingsSyncPushRequestSchema.parse({ mutations }),
        catch: (error) => this.contractFailure("push", "request", error),
      });
      const response = yield* this.requestJson("push", "/apps/v1/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      return yield* Effect.try({
        try: () => {
          const raw = SettingsSyncPushResponseSchema.parse(response);
          if (raw.results.length !== mutations.length) {
            throw new Error(
              "Push response result count does not match request",
            );
          }

          return raw.results.map((result, index) => {
            const mutation = request.mutations[index];
            if (result.syncId !== mutation.syncId) {
              throw new Error(
                "Push response result identity does not match request",
              );
            }
            if (result.status === "ok") {
              if (
                mutation.expectedSyncVersion !== null &&
                (result.syncVersion < mutation.expectedSyncVersion ||
                  (result.applied &&
                    result.syncVersion <= mutation.expectedSyncVersion))
              ) {
                throw new Error(
                  "Push success returned an invalid sync version",
                );
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
              throw new Error(
                "Conflict canonical identity does not match result",
              );
            }
            const conflictingItem = result.conflictingItem
              ? parseCanonicalItem(result.conflictingItem)
              : undefined;
            if (
              conflictingItem &&
              conflictingItem.collection !== mutation.collection
            ) {
              throw new Error(
                "Conflicting item collection does not match request",
              );
            }
            if (
              result.reason === "duplicate_key_conflict" &&
              !conflictingItem
            ) {
              throw new Error("Duplicate conflict omitted the winning item");
            }
            if (
              result.reason === "duplicate_key_conflict" &&
              conflictingItem &&
              (conflictingItem.syncId === result.syncId ||
                conflictingItem.payload === null ||
                payloadKey(
                  conflictingItem.collection,
                  conflictingItem.payload,
                ) !== payloadKey(mutation.collection, mutation.payload))
            ) {
              throw new Error(
                "Duplicate conflict winner does not match request key",
              );
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
              throw new Error(
                "Version conflict returned a non-conflicting version",
              );
            }
            if (
              result.reason === "duplicate_key_conflict" &&
              ((mutation.expectedSyncVersion === null && canonical !== null) ||
                (mutation.expectedSyncVersion !== null &&
                  canonical?.syncVersion !== mutation.expectedSyncVersion))
            ) {
              throw new Error(
                "Duplicate conflict canonical does not match base",
              );
            }
            return { ...result, canonical, conflictingItem };
          });
        },
        catch: (error) => this.contractFailure("push", "response", error),
      });
    });
  }

  private requestJson(
    operation: SettingsSyncOperation,
    path: string | URL,
    init: RequestInit,
  ): Effect.Effect<unknown, SettingsSyncClientError> {
    return Effect.gen(this, function* () {
      const token = yield* this.authService.getIdToken().pipe(
        Effect.mapError(
          (error) =>
            new SettingsSyncDependencyFailure({
              message: "Unable to read the settings sync authentication token",
              dependency: "authentication",
              cause: error,
            }),
        ),
      );
      if (!token) {
        return yield* Effect.fail(
          new AuthenticationRequired({
            message: "Sign in required",
            meta: { httpStatus: 401 },
          }),
        );
      }

      const requestController = new AbortController();
      return yield* Effect.gen(this, function* () {
        const url = yield* Effect.try({
          try: () => (typeof path === "string" ? getCoreApiUrl(path) : path),
          catch: (error) => this.contractFailure(operation, "request", error),
        });
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              ...init,
              signal: requestController.signal,
              headers: {
                "User-Agent": getUserAgent(),
                ...getAmicalClientHeaders(),
                ...init.headers,
                Authorization: `Bearer ${token}`,
              },
            }),
          catch: (error) =>
            new CloudNetworkFailure({
              message:
                error instanceof Error
                  ? error.message
                  : "Settings sync network request failed",
              cause: error,
            }),
        });
        if (!response.ok) {
          const body = yield* Effect.promise(async () => {
            try {
              return await response.json();
            } catch {
              return undefined;
            }
          });
          return yield* Effect.fail(
            decodeCloudHttpFailure({
              status: response.status,
              statusText: response.statusText,
              body,
              fallbackMessage: `Settings sync request failed with ${response.status}`,
              retryAfter: response.headers?.get("Retry-After") ?? undefined,
            }),
          );
        }
        return yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (error) => this.contractFailure(operation, "response", error),
        });
      }).pipe(
        Effect.onInterrupt(() => Effect.sync(() => requestController.abort())),
      );
    });
  }

  private contractFailure(
    operation: SettingsSyncOperation,
    phase: "request" | "response",
    cause: unknown,
  ): SettingsSyncContractFailure {
    return new SettingsSyncContractFailure({
      message:
        cause instanceof Error
          ? cause.message
          : `Invalid settings sync ${phase}`,
      operation,
      phase,
      cause,
    });
  }
}
