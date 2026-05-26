import { describe, it, expect } from "vitest";
import { migrateToV12 } from "../../src/db/settings-migrations/v12";

describe("migrateToV12", () => {
  it("converts a concrete selectedLanguage to a single-item languages array", () => {
    const result = migrateToV12({
      dictation: { autoDetectEnabled: false, selectedLanguage: "es" },
    });
    expect(result.dictation).toEqual({
      autoDetectEnabled: false,
      languages: ["es"],
    });
  });

  it("defaults to ['en'] when selectedLanguage is missing", () => {
    const result = migrateToV12({
      dictation: { autoDetectEnabled: true },
    });
    expect(result.dictation).toEqual({
      autoDetectEnabled: true,
      languages: ["en"],
    });
  });

  it("creates a dictation section when absent", () => {
    const result = migrateToV12({});
    expect(result.dictation).toEqual({
      autoDetectEnabled: true,
      languages: ["en"],
    });
  });
});
