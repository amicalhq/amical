import { describe, expect, it } from "vitest";
import {
  axisSyncKeySchema,
  axisSyncOptionalTextSchema,
  axisSyncRequiredTextSchema,
  sanitizeLegacySyncText,
  SYNC_KEY_MAX_LENGTH,
  SYNC_TEXT_MAX_LENGTH,
} from "../../src/db/sync-payload";

describe("settings sync payload bounds", () => {
  it("accepts exact authored keys without trimming or changing case", () => {
    const key = "  Mixed Case  ";

    expect(axisSyncKeySchema.parse(key)).toBe(key);
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
      expect(axisSyncKeySchema.safeParse(key).success).toBe(false);
    }

    expect(
      axisSyncKeySchema.safeParse(`${"a".repeat(SYNC_KEY_MAX_LENGTH - 2)}😀`)
        .success,
    ).toBe(true);
  });

  it("matches optional and required Axis text boundaries", () => {
    expect(axisSyncOptionalTextSchema.safeParse("").success).toBe(true);
    expect(axisSyncRequiredTextSchema.safeParse("").success).toBe(false);
    expect(axisSyncRequiredTextSchema.safeParse("   ").success).toBe(true);
    expect(
      axisSyncRequiredTextSchema.safeParse("a".repeat(SYNC_TEXT_MAX_LENGTH))
        .success,
    ).toBe(true);
    expect(
      axisSyncRequiredTextSchema.safeParse("a".repeat(SYNC_TEXT_MAX_LENGTH + 1))
        .success,
    ).toBe(false);
    expect(axisSyncOptionalTextSchema.safeParse("bad\0text").success).toBe(
      false,
    );
    expect(axisSyncOptionalTextSchema.safeParse("bad\ud800text").success).toBe(
      false,
    );
  });

  it("repairs legacy Unicode and never splits a surrogate pair", () => {
    expect(sanitizeLegacySyncText("ok\0\ud800x\udc00😀", 20)).toBe("okx😀");
    expect(
      sanitizeLegacySyncText(
        `${"a".repeat(SYNC_KEY_MAX_LENGTH - 1)}😀tail`,
        SYNC_KEY_MAX_LENGTH,
      ),
    ).toBe("a".repeat(SYNC_KEY_MAX_LENGTH - 1));
  });
});
