import type {
  SyncCanonicalItem,
  SyncPushResult,
} from "@amical/api-contracts/apps/v1";
import type { db } from "..";
import type { SyncCollection, SyncPayload, SyncScopeType } from "../schema";

export type {
  SyncCanonicalItem as CanonicalSyncItem,
  SyncPushResult as PushSyncResult,
} from "@amical/api-contracts/apps/v1";

export type SyncDatabase = Pick<
  typeof db,
  "select" | "insert" | "update" | "delete"
>;

export const PERSONAL_SCOPE_ID = "";

export interface SyncContext {
  accountId: string;
  scopeType: SyncScopeType;
  scopeId: string;
}

export interface CapturedSyncHead extends SyncContext {
  collection: SyncCollection;
  syncId: string;
  headPayload: SyncPayload | null;
  headExpectedSyncVersion: number | null;
  headSequence: number;
}

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
  items: SyncCanonicalItem[];
  cursor: number;
}

export interface PullCollectionCursor {
  collection: SyncCollection;
  cursor: number;
}
