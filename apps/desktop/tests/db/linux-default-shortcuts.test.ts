import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

vi.mock("../../src/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isLinux: () => true,
  isMacOS: () => false,
  isWindows: () => false,
}));

import { getAppSettings } from "../../src/db/app-settings";
import {
  type ShortcutsConfig,
  type ShortcutType,
  validateShortcutBindings,
} from "../../src/utils/shortcut-validation";

describe("Linux default shortcuts", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("seeds shortcuts that pass Linux validation", async () => {
    const shortcuts = (await getAppSettings()).shortcuts as ShortcutsConfig;
    expect(shortcuts.pushToTalk).toEqual([[29, 56, 57]]); // Ctrl+Alt+Space

    for (const type of Object.keys(shortcuts) as ShortcutType[]) {
      expect(
        validateShortcutBindings({
          candidateBindings: shortcuts[type],
          candidateType: type,
          shortcutsByType: shortcuts,
          platform: "linux",
        }),
      ).toEqual({ valid: true });
    }
  });
});
