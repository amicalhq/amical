import { describe, expect, it } from "vitest";
import {
  cloudSyncKeySchema,
  cloudSyncOptionalTextSchema,
  cloudSyncRequiredTextSchema,
  SYNC_KEY_MAX_LENGTH,
  SYNC_TEXT_MAX_LENGTH,
  trimmedSyncKeySchema,
} from "../../src/db/sync-payload";

describe("settings sync payload bounds", () => {
  it("accepts exact authored keys without trimming or changing case", () => {
    const key = "  Mixed Case  ";

    expect(cloudSyncKeySchema.parse(key)).toBe(key);
  });

  it("rejects blank, NUL, malformed, and over-limit keys", () => {
    const invalidKeys = [
      " \t\n ",
      "nul\0key",
      `bad\ud800key`,
      `bad\udc00key`,
      "a".repeat(SYNC_KEY_MAX_LENGTH + 1),
      `${"a".repeat(SYNC_KEY_MAX_LENGTH - 1)}😀`,
    ];

    for (const key of invalidKeys) {
      expect(cloudSyncKeySchema.safeParse(key).success).toBe(false);
    }

    expect(
      cloudSyncKeySchema.safeParse(`${"a".repeat(SYNC_KEY_MAX_LENGTH - 2)}😀`)
        .success,
    ).toBe(true);
  });

  it("matches optional and required cloud text boundaries", () => {
    expect(cloudSyncOptionalTextSchema.safeParse("").success).toBe(true);
    expect(cloudSyncRequiredTextSchema.safeParse("").success).toBe(false);
    expect(cloudSyncRequiredTextSchema.safeParse("   ").success).toBe(true);
    expect(
      cloudSyncRequiredTextSchema.safeParse("a".repeat(SYNC_TEXT_MAX_LENGTH))
        .success,
    ).toBe(true);
    expect(
      cloudSyncRequiredTextSchema.safeParse(
        "a".repeat(SYNC_TEXT_MAX_LENGTH + 1),
      ).success,
    ).toBe(false);
    expect(cloudSyncOptionalTextSchema.safeParse("bad\0text").success).toBe(
      false,
    );
    expect(cloudSyncOptionalTextSchema.safeParse("bad\ud800text").success).toBe(
      false,
    );
  });

  it("trims editor keys before applying cloud validation", () => {
    expect(trimmedSyncKeySchema.parse("  Mixed Case  ")).toBe("Mixed Case");
    expect(trimmedSyncKeySchema.safeParse("  bad\0key  ").success).toBe(false);
    expect(trimmedSyncKeySchema.safeParse("  bad\ud800key  ").success).toBe(
      false,
    );
  });
});
