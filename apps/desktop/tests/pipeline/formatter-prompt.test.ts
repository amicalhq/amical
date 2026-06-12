import { describe, expect, it } from "vitest";
import type { GetAccessibilityContextResult } from "@amical/types";
import { detectApplicationType } from "../../src/pipeline/providers/formatting/formatter-prompt";
import {
  ONBOARDING_WINDOW_TITLE,
  TRY_IT_WINDOW_TITLES,
} from "../../src/constants/window-titles";

const ctx = (bundleId: string | null, title: string | null) =>
  ({
    context: {
      application: { bundleIdentifier: bundleId },
      windowInfo: title === null ? null : { title, url: null },
    },
  }) as unknown as GetAccessibilityContextResult;

describe("detectApplicationType — Amical's own surfaces", () => {
  it("treats the onboarding email try-it as an email surface", () => {
    expect(
      detectApplicationType(
        ctx("ai.amical.desktop", TRY_IT_WINDOW_TITLES.email),
      ),
    ).toBe("email");
  });

  it("treats the onboarding notes try-it as a notes surface", () => {
    expect(
      detectApplicationType(
        ctx("ai.amical.desktop", TRY_IT_WINDOW_TITLES.notes),
      ),
    ).toBe("notes");
  });

  it("treats the rest of the setup wizard as a generic surface", () => {
    expect(
      detectApplicationType(ctx("ai.amical.desktop", ONBOARDING_WINDOW_TITLE)),
    ).toBe("default");
  });

  it("keeps the in-app notes treatment for Amical's other windows", () => {
    expect(
      detectApplicationType(ctx("ai.amical.desktop", "Notes Widget")),
    ).toBe("amical-notes");
    expect(detectApplicationType(ctx("ai.amical.desktop", null))).toBe(
      "amical-notes",
    );
  });

  it("still maps real apps by bundle id", () => {
    expect(detectApplicationType(ctx("com.apple.mail", "Inbox"))).toBe("email");
    expect(detectApplicationType(ctx(null, null))).toBe("default");
    // Empty bundle id (e.g. helper denied access to the process) is falsy
    // and short-circuits to default before any matching.
    expect(detectApplicationType(ctx("", "Inbox"))).toBe("default");
    expect(detectApplicationType(undefined)).toBe("default");
  });

  it("recognizes its own exe path on Windows (helper has no bundle ids)", () => {
    const exe = "C:\\Users\\z\\AppData\\Local\\amical\\app-1.8.0\\Amical.exe";
    expect(detectApplicationType(ctx(exe, TRY_IT_WINDOW_TITLES.email))).toBe(
      "email",
    );
    expect(detectApplicationType(ctx(exe, TRY_IT_WINDOW_TITLES.notes))).toBe(
      "notes",
    );
    expect(detectApplicationType(ctx(exe, ONBOARDING_WINDOW_TITLE))).toBe(
      "default",
    );
    expect(detectApplicationType(ctx(exe, "Notes Widget"))).toBe(
      "amical-notes",
    );
    // Dev runs are electron.exe — not our surface, falls through to default.
    expect(
      detectApplicationType(
        ctx("C:\\dev\\electron.exe", TRY_IT_WINDOW_TITLES.email),
      ),
    ).toBe("default");
  });
});
