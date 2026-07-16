import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";
import {
  getAppSettings,
  updateSettingsSection,
} from "../../src/db/app-settings";

/**
 * The settings store is one JSON blob row maintained by read-merge-write.
 * These tests pin the module-level write queue: overlapping writers must not
 * lose sections, and concurrent first-run readers must not race the default
 * insert. Without the queue, both writers read the same base row and the
 * second write silently drops the first's section, and first-run readers
 * double-insert into the UNIQUE settings id.
 */
describe("app-settings write serialization", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("overlapping section writes both persist (no lost update)", async () => {
    await getAppSettings(); // seed the defaults row

    await Promise.all([
      updateSettingsSection("ui", { theme: "dark" }),
      updateSettingsSection("labs", { selfCorrection: true }),
    ]);

    const settings = await getAppSettings();
    expect(settings.ui).toEqual({ theme: "dark" });
    expect(settings.labs).toEqual({ selfCorrection: true });
  });

  it("overlapping writes to the same section apply in call order", async () => {
    await getAppSettings();

    await Promise.all([
      updateSettingsSection("ui", { theme: "dark" }),
      updateSettingsSection("ui", { theme: "light" }),
    ]);

    const settings = await getAppSettings();
    expect(settings.ui).toEqual({ theme: "light" });
  });

  it("concurrent first-run reads create the default row exactly once", async () => {
    const [a, b] = await Promise.all([getAppSettings(), getAppSettings()]);

    expect(a).toEqual(b);
    const settings = await getAppSettings();
    expect(settings.ui).toEqual(a.ui);
  });
});
