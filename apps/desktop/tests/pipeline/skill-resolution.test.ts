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

const ctx = (bundleId: string | null): GetAccessibilityContextResult | null =>
  bundleId === null
    ? null
    : ({
        context: { application: { bundleIdentifier: bundleId } },
      } as unknown as GetAccessibilityContextResult);

// Built-in rows as listSkills() resolves them (preset + seeded tone).
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
  it("returns the instruct preset when isInstruct, ignoring formatting/app", async () => {
    expect(
      await resolveSessionSkills({
        isInstruct: true,
        enableFormatting: false,
        accessibilityContext: ctx("com.tinyspeck.slackmacgap"),
      }),
    ).toEqual([{ preset: INSTRUCT_PRESET_ID }]);
  });

  it("returns no skills (raw transcript) when formatting is off", async () => {
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: false,
        accessibilityContext: ctx("com.tinyspeck.slackmacgap"),
      }),
    ).toEqual([]);
  });

  it("resolves a macOS bundle id to the catalog preset + built-in tone", async () => {
    // slack → work_messages (PRESET_APP_DEFAULTS); work skill tone = casual
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx("com.tinyspeck.slackmacgap"),
      }),
    ).toEqual([{ preset: "work_messages", args: { tone: ["casual"] } }]);
  });

  it("resolves a Windows process name case-insensitively", async () => {
    // "OUTLOOK" → outlook → email preset; email skill tone = formal
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: ctx("OUTLOOK"),
      }),
    ).toEqual([{ preset: "email", args: { tone: ["formal"] } }]);
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
    ).toEqual([{ preset: "default", args: { tone: ["casual"] } }]);
  });

  it("falls back to default when there is no accessibility context", async () => {
    expect(
      await resolveSessionSkills({
        isInstruct: false,
        enableFormatting: true,
        accessibilityContext: null,
      }),
    ).toEqual([{ preset: "default", args: { tone: ["casual"] } }]);
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
