import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";

import {
  syncCollectionState,
  syncItemState,
  syncOutbox,
  type SyncCollection,
  type SyncPayload,
  type SyncScopeType,
} from "../schema";
import type { SyncContext } from "./types";

export const collectionWhere = (
  context: Pick<SyncContext, "scopeType" | "scopeId">,
  collection: SyncCollection,
) =>
  and(
    eq(syncCollectionState.scopeType, context.scopeType),
    eq(syncCollectionState.scopeId, context.scopeId),
    eq(syncCollectionState.collection, collection),
  );

export const itemWhere = (identity: {
  scopeType: SyncScopeType;
  scopeId: string;
  collection: SyncCollection;
  syncId: string;
}) =>
  and(
    eq(syncItemState.scopeType, identity.scopeType),
    eq(syncItemState.scopeId, identity.scopeId),
    eq(syncItemState.collection, identity.collection),
    eq(syncItemState.syncId, identity.syncId),
  );

export const outboxWhere = (identity: {
  scopeType: SyncScopeType;
  scopeId: string;
  collection: SyncCollection;
  syncId: string;
}) =>
  and(
    eq(syncOutbox.scopeType, identity.scopeType),
    eq(syncOutbox.scopeId, identity.scopeId),
    eq(syncOutbox.collection, identity.collection),
    eq(syncOutbox.syncId, identity.syncId),
  );

export const payloadsEqual = (
  left: SyncPayload | null,
  right: SyncPayload | null,
): boolean => isDeepStrictEqual(left, right);

export const syncItemKey = (collection: SyncCollection, syncId: string) =>
  `${collection}:${syncId}`;
