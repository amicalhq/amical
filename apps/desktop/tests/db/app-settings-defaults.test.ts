import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { app } from "electron";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";
import { getAppSettings } from "../../src/db/app-settings";

/**
 * First-run seeding of dictation defaults: concrete languages (English + the
 * OS language) with auto-detect off, so first dictations carry a language
 * constraint. Existing installs are untouched — this only runs when no
 * settings row exists.
 */
describe("default settings seed", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("seeds English plus the OS language with auto-detect off", async () => {
    vi.mocked(app.getPreferredSystemLanguages).mockReturnValue([
      "hi-IN",
      "en-IN",
    ]);

    const settings = await getAppSettings();

    expect(settings.dictation).toEqual({
      autoDetectEnabled: false,
      languages: ["en", "hi"],
    });
    expect(settings.labs).toEqual({
      selfCorrection: false,
    });
  });

  it("does not duplicate English when the OS language is English", async () => {
    vi.mocked(app.getPreferredSystemLanguages).mockReturnValue(["en-US"]);

    const settings = await getAppSettings();

    expect(settings.dictation).toEqual({
      autoDetectEnabled: false,
      languages: ["en"],
    });
  });

  it("falls back to English only for unsupported OS languages", async () => {
    vi.mocked(app.getPreferredSystemLanguages).mockReturnValue(["eo-001"]);

    const settings = await getAppSettings();

    expect(settings.dictation).toEqual({
      autoDetectEnabled: false,
      languages: ["en"],
    });
  });

  it("persists the seeded defaults", async () => {
    vi.mocked(app.getPreferredSystemLanguages).mockReturnValue(["fr-FR"]);

    await getAppSettings();
    // Change the reported locale; the stored row must win on re-read.
    vi.mocked(app.getPreferredSystemLanguages).mockReturnValue(["ja-JP"]);
    const settings = await getAppSettings();

    expect(settings.dictation?.languages).toEqual(["en", "fr"]);
  });
});
