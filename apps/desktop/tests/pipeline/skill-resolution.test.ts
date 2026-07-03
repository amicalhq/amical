import { describe, it, expect, vi, beforeEach } from "vitest";

// resolveSessionSkills reads built-in skill tones from the DB; mock listSkills.
const listSkillsMock = vi.hoisted(() => vi.fn());
vi.mock("@/db/skills", () => ({ listSkills: listSkillsMock }));

import {
  resolveSessionSkills,
  buildPresetSkill,
  INSTRUCT_PRESET_ID,
} from "@/pipeline/providers/transcription/skill-resolution";
import type { GetAccessibilityContextResult } from "@amical/types";

const ctx = (
  bundleId: string | null,
  url?: string,
): GetAccessibilityContextResult | null =>
  bundleId === null
    ? null
    : ({
        context: {
          application: { bundleIdentifier: bundleId },
          windowInfo: url ? { url } : undefined,
        },
      } as unknown as GetAccessibilityContextResult);

// Built-in rows as listSkills() resolves them. Only isBuiltIn + preset + tone
// matter here — surface→preset resolution comes from the app catalog, not these
// rows; listSkills only supplies the optional per-preset tone.
const BUILT_INS = [
  { id: "personal", isBuiltIn: true, preset: "personal_messages", tone: "casual" },
  { id: "work", isBuiltIn: true, preset: "work_messages", tone: "casual" },
  { id: "email", isBuiltIn: true, preset: "email", tone: "formal" },
  { id: "default", isBuiltIn: true, preset: "default", tone: "casual" },
];

beforeEach(() => {
  listSkillsMock.mockReset();
  listSkillsMock.mockResolvedValue(BUILT_INS);
});

describe("resolveSessionSkills", () => {
  it("returns the instruct preset when isInstruct, ignoring formatting/app and personalization", async () => {
    expect(
      await resolveSessionSkills({
        isInstruct: true,
        enableFormatting: false,
        accessibilityContext: ctx("com.tinyspeck.slackmacgap"),
      }),
    ).toEqual([{ preset: INSTRUCT_PRESET_ID }]);
    expect(listSkillsMock).not.toHaveBeenCalled();
  });

  it("returns no skills (raw transcript) when formatting is off", async () => {
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: false,
        accessibilityContext: ctx("com.tinyspeck.slackmacgap"),
      }),
    ).toEqual([]);
    expect(listSkillsMock).not.toHaveBeenCalled();
  });

  it("resolves a macOS bundle id to the catalog preset and masks the DB tone while personalization is off", async () => {
    // slack → work_messages (PRESET_APP_DEFAULTS); DB tone is read but omitted while gated
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx("com.tinyspeck.slackmacgap"),
      }),
    ).toEqual([{ preset: "work_messages" }]);
    expect(listSkillsMock).toHaveBeenCalledTimes(1);
  });

  it("resolves a Windows process name case-insensitively", async () => {
    // "OUTLOOK" → outlook → email preset; tone is omitted while gated
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx("OUTLOOK"),
      }),
    ).toEqual([{ preset: "email" }]);
  });

  it("resolves a browser tab hostname via the site catalog", async () => {
    // mail.google.com → email (PRESET_SITE_DEFAULTS)
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx(
          "com.google.Chrome",
          "https://mail.google.com/mail/u/0/#inbox?compose=new",
        ),
      }),
    ).toEqual([{ preset: "email" }]);
  });

  it("resolves an already-normalized bare hostname (the shape production sends)", async () => {
    // normalizeAccessibilityContext strips windowInfo.url to the hostname
    // before it reaches here; re-extraction must be idempotent.
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx("com.google.Chrome", "mail.google.com"),
      }),
    ).toEqual([{ preset: "email" }]);
  });

  it("resolves a web app to the same preset as its native app (Notion → markdown_notes)", async () => {
    // notion.com sits under the Work skill in the picker, but the catalog
    // resolves it to markdown_notes — matching native Notion, not work_messages.
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx("com.google.Chrome", "https://notion.com/"),
      }),
    ).toEqual([{ preset: "markdown_notes" }]);
  });

  it("matches a subdomain of a catalog site by longest suffix", async () => {
    // app.notion.com is not a catalog entry; notion.com is, and app.notion.com
    // ends on that label boundary → markdown_notes.
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx("com.google.Chrome", "https://app.notion.com/workspace"),
      }),
    ).toEqual([{ preset: "markdown_notes" }]);
  });

  it("matches the www / legacy form of a catalog site (notion.so → markdown_notes)", async () => {
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx("com.google.Chrome", "https://www.notion.so/page"),
      }),
    ).toEqual([{ preset: "markdown_notes" }]);
  });

  it("does not let a lookalike domain hijack a catalog site (label-boundary safe)", async () => {
    // evilnotion.so must NOT match notion.so; unknown app → default preset.
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx("com.unknown.example", "https://evilnotion.so/"),
      }),
    ).toEqual([{ preset: "default" }]);
  });

  it("omits tone for a preset with no built-in skill (e.g. ai)", async () => {
    // cursor → ai (PRESET_APP_DEFAULTS); no built-in skill for "ai" → no tone
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx("com.todesktop.230313mzl4w4u92"),
      }),
    ).toEqual([{ preset: "ai" }]);
  });

  it("falls back to the default preset for an unknown app (matches prior bridge)", async () => {
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx("com.unknown.example"),
      }),
    ).toEqual([{ preset: "default" }]);
  });

  it("falls back to default when there is no accessibility context", async () => {
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: null,
      }),
    ).toEqual([{ preset: "default" }]);
  });
});

describe("buildPresetSkill", () => {
  it("includes tone args when set", () => {
    expect(buildPresetSkill("email", "formal")).toEqual({
      preset: "email",
      args: { tone: ["formal"] },
    });
  });

  it("omits args when tone is null", () => {
    expect(buildPresetSkill("ai", null)).toEqual({ preset: "ai" });
  });
});
