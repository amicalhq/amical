import { describe, expect, it } from "vitest";
import type { GetAccessibilityContextResult } from "@amical/types";
import { detectApplicationType } from "../../src/pipeline/providers/formatting/formatter-prompt";
import {
  ONBOARDING_WINDOW_TITLE,
  TRY_IT_WINDOW_TITLES,
} from "../../src/constants/window-titles";

const ctx = (
  bundleId: string | null,
  title: string | null,
  url: string | null = null,
) =>
  ({
    context: {
      application: { bundleIdentifier: bundleId },
      windowInfo: title === null ? null : { title, url },
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

  it("recognizes its own app on Windows by process name (helper has no bundle ids)", () => {
    const exe = "Amical";
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
    // Dev runs are electron — not our surface, falls through to default.
    expect(
      detectApplicationType(ctx("electron", TRY_IT_WINDOW_TITLES.email)),
    ).toBe("default");
  });
});

describe("detectApplicationType — web apps in browsers", () => {
  // The native bridge reduces a browser URL to its hostname before app
  // detection sees it, so browser windows carry a hostname.
  const detect = (bundleId: string, hostname: string) =>
    detectApplicationType(ctx(bundleId, "", hostname));

  it("classifies web apps by hostname in macOS browsers", () => {
    expect(detect("com.google.Chrome", "mail.google.com")).toBe("email");
    expect(detect("com.apple.Safari", "app.slack.com")).toBe("chat");
    expect(detect("org.chromium.Chromium", "mail.google.com")).toBe("email");
    expect(detect("company.thebrowser.Browser", "app.slack.com")).toBe("chat");
    expect(detect("app.zen-browser.zen", "docs.google.com")).toBe("notes");
  });

  it("classifies web apps in Windows browsers by process name", () => {
    // The Windows helper reports the process name (no path, no .exe) as the
    // bundle id, and resolves a URL only for the browsers it knows.
    expect(detect("chrome", "mail.google.com")).toBe("email");
    expect(detect("msedge", "app.slack.com")).toBe("chat");
    expect(detect("firefox", "docs.google.com")).toBe("notes");
  });

  it("does not classify other apps by URL", () => {
    expect(detect("com.apple.TextEdit", "mail.google.com")).toBe("default");
  });

  it("recognizes Google Chat", () => {
    expect(detect("com.google.Chrome", "chat.google.com")).toBe("chat");
  });
});
