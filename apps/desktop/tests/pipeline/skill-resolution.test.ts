import { describe, it, expect } from "vitest";
import {
  resolveSessionSkills,
  INSTRUCT_PRESET_ID,
} from "@/pipeline/providers/transcription/skill-resolution";

describe("resolveSessionSkills", () => {
  it("returns the instruct preset when isInstruct, ignoring formatting", () => {
    expect(
      resolveSessionSkills({ isInstruct: true, enableFormatting: false }),
    ).toEqual([{ preset: INSTRUCT_PRESET_ID }]);
    expect(
      resolveSessionSkills({ isInstruct: true, enableFormatting: true }),
    ).toEqual([{ preset: INSTRUCT_PRESET_ID }]);
  });

  it("returns the default bridge preset when only formatting is enabled", () => {
    expect(
      resolveSessionSkills({ isInstruct: false, enableFormatting: true }),
    ).toEqual([{ preset: "default", args: { tone: ["casual"] } }]);
  });

  it("returns no skills (raw transcript) when neither is set", () => {
    expect(
      resolveSessionSkills({ isInstruct: false, enableFormatting: false }),
    ).toEqual([]);
  });
});
