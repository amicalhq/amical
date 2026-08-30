import type { db } from "..";
import type { SyncCollection, SyncPayload, SyncScopeType } from "../schema";

export type SyncDatabase = Pick<
  typeof db,
  "select" | "insert" | "update" | "delete"
>;

export const SYNC_COLLECTIONS = [
  "vocabulary",
  "snippet",
] as const satisfies readonly SyncCollection[];

export const PERSONAL_SCOPE_ID = "";

export interface SyncContext {
  accountId: string;
  scopeType: SyncScopeType;
  scopeId: string;
}

export interface CanonicalSyncItem {
  collection: SyncCollection;
  syncId: string;
  syncVersion: number;
  payload: SyncPayload | null;
}

export interface CapturedSyncHead extends SyncContext {
  collection: SyncCollection;
  syncId: string;
  headPayload: SyncPayload | null;
  headExpectedSyncVersion: number | null;
  headSequence: number;
}

export type PushSyncResult =
  | {
      status: "ok";
      syncId: string;
      syncVersion: number;
      applied: boolean;
    }
  | {
      status: "conflict";
      reason: "version_conflict" | "duplicate_key_conflict";
      syncId: string;
      canonical: CanonicalSyncItem | null;
      conflictingItem?: CanonicalSyncItem;
    }
  | {
      status: "error";
      syncId: string | null;
      reason: "unauthorized_scope" | "invalid_payload" | "invalid_mutation";
      message: string;
    };

export interface AdvertisedSyncScope {
  scopeType: SyncScopeType;
  scopeId: string;
  role: string | null;
  canWrite: boolean;
  latestSyncVersion: number;
}

export interface ReconciledSyncScopes {
  contexts: SyncContext[];
  organizationChanged: boolean;
  capabilityChanged: boolean;
}

export interface LocalSyncMutation {
  collection: SyncCollection;
  syncId: string;
  payload: SyncPayload;
}

export interface PullCollectionPage {
  collection: SyncCollection;
  items: CanonicalSyncItem[];
  cursor: number;
}

export interface PullCollectionCursor {
  collection: SyncCollection;
  cursor: number;
}
