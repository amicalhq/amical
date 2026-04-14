import { describe, expect, it } from "vitest";
import { classifyUpdaterError } from "../../src/main/services/auto-updater";

describe("classifyUpdaterError", () => {
  it("classifies macOS read-only volume updater failures as known noise", () => {
    const error = new Error(
      "Cannot update while running on a read-only volume. The application is on a read-only volume.",
    );

    expect(classifyUpdaterError(error, "darwin")).toBe("read_only_volume");
  });

  it("does not classify the same message as known noise on non-macOS platforms", () => {
    const error = new Error(
      "Cannot update while running on a read-only volume. The application is on a read-only volume.",
    );

    expect(classifyUpdaterError(error, "win32")).toBe("generic");
  });

  it("keeps unrelated updater errors as generic", () => {
    expect(classifyUpdaterError(new Error("Remote release File is empty or corrupted"), "darwin")).toBe(
      "generic",
    );
  });
});
