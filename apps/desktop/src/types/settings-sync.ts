import {
  SyncPullCollectionRequestSchema,
  SyncPullQuerySchema,
  SyncPushMutationSchema,
  SyncPushRequestSchema,
  type SyncCollection,
} from "@amical/api-contracts/apps/v1";
import { z } from "zod";

// The collections this app implements. A new collection in the contract must
// not start to sync here until the app supports it.
export const SETTINGS_SYNC_COLLECTIONS = [
  "vocabulary",
  "snippet",
  "note",
] as const satisfies readonly SyncCollection[];

// The contract's request schemas fix the current server limits. The server
// advertises its limits through bootstrap, so these schemas keep the shape
// rules without those numbers: a released app must accept a limit that the
// server raises later.
export const SettingsSyncPullCollectionRequestSchema =
  SyncPullCollectionRequestSchema.extend({
    limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  });

export const SettingsSyncPullRequestSchema = SyncPullQuerySchema.extend({
  collections: z
    .array(SettingsSyncPullCollectionRequestSchema)
    .min(1)
    .refine(
      (requests) =>
        new Set(requests.map((request) => request.collection)).size ===
        requests.length,
      "collection must be requested at most once",
    ),
}).refine(
  ({ scopeType, collections }) =>
    scopeType === "user" ||
    !collections.some((item) => item.collection === "note"),
  "Notes only support user scope",
);

export const SettingsSyncPushRequestSchema = SyncPushRequestSchema.safeExtend({
  mutations: z.array(SyncPushMutationSchema),
});
