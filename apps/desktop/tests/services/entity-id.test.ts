import { describe, expect, it } from "vitest";
import {
  createEntityId,
  SettingsSyncIdSchema,
  SettingsSyncPushMutationSchema,
  SettingsSyncCanonicalItemSchema,
} from "@amical/types";

const legacyId = "11111111-1111-4111-8111-111111111111";

describe("sync entity IDs", () => {
  it.each([
    ["note", "nt"],
    ["vocabulary", "voc"],
    ["snippet", "snp"],
  ] as const)(
    "generates complete %s IDs accepted on both sides of sync",
    (collection, prefix) => {
      const id = createEntityId(collection);
      expect(id).toMatch(new RegExp(`^${prefix}_[a-z][a-z0-9]{23}$`));
      expect(SettingsSyncIdSchema.parse(id)).toBe(id);
      if (collection !== "note")
        expect(
          SettingsSyncPushMutationSchema.parse({
            collection,
            scopeType: "user",
            scopeId: "alice",
            syncId: id,
            expectedSyncVersion: 1,
            payload: null,
          }).syncId,
        ).toBe(id);
      expect(
        SettingsSyncCanonicalItemSchema.parse({
          collection,
          syncId: id,
          syncVersion: 2,
          payload: null,
        }).syncId,
      ).toBe(id);
    },
  );

  it("keeps existing UUID identities unchanged", () => {
    expect(SettingsSyncIdSchema.parse(legacyId)).toBe(legacyId);
    expect(
      SettingsSyncPushMutationSchema.parse({
        collection: "vocabulary",
        scopeType: "user",
        scopeId: "alice",
        syncId: legacyId.toUpperCase(),
        expectedSyncVersion: null,
        payload: null,
      }).syncId,
    ).toBe(legacyId);
  });

  it.each([
    "nt_abc",
    "nt_" + "a".repeat(23),
    "nt_" + "a".repeat(25),
    "nt_1" + "a".repeat(23),
    "usr_" + "a".repeat(24),
    "nt_" + "a".repeat(23) + "/",
    " nt_" + "a".repeat(24),
  ])("rejects malformed or truncated IDs: %s", (id) => {
    expect(SettingsSyncIdSchema.safeParse(id).success).toBe(false);
  });
});
