import { describe, it, expect } from "vitest";
import { normalizeTranscriptionBoundaries } from "../../src/utils/boundary-spacing";
import cases from "./boundary-spacing-cases.json";

interface BoundarySpacingCase {
  id: string;
  name: string;
  note?: string;
  beforeText: string | null;
  formatterText: string;
  afterText: string | null;
  expected: string;
}

describe("normalizeTranscriptionBoundaries", () => {
  it.each(cases as BoundarySpacingCase[])("$name", (testCase) => {
    expect(
      normalizeTranscriptionBoundaries(
        testCase.formatterText,
        testCase.beforeText,
        testCase.afterText,
      ),
    ).toBe(testCase.expected);
  });

  it("skips leading handling when beforeText is undefined", () => {
    expect(normalizeTranscriptionBoundaries(" Hello", undefined, "")).toBe(
      " Hello ",
    );
  });

  it("strips leading/trailing newlines", () => {
    expect(normalizeTranscriptionBoundaries("\nHello\n", null, null)).toBe(
      "Hello ",
    );
  });
});
