import { describe, it, expect } from "vitest";
import { computeUpdatePrompt } from "../../src/main/services/update-prompt";
import type { UpdateMetadata } from "../../src/main/services/auto-updater";

const meta = (over: Partial<UpdateMetadata> = {}): UpdateMetadata => ({
  action: "prompt",
  version: "1.7.1",
  releaseNotes: "## Amical 1.7.1",
  ...over,
});

describe("computeUpdatePrompt", () => {
  it("returns null when no metadata", () => {
    expect(computeUpdatePrompt(null, true, undefined)).toBeNull();
  });

  it("returns null when not downloaded", () => {
    expect(computeUpdatePrompt(meta(), false, undefined)).toBeNull();
  });

  it("returns null for action none/silent", () => {
    expect(computeUpdatePrompt(meta({ action: "none" }), true, undefined)).toBeNull();
    expect(computeUpdatePrompt(meta({ action: "silent" }), true, undefined)).toBeNull();
  });

  it("returns the prompt for a fresh prompt action", () => {
    expect(computeUpdatePrompt(meta(), true, undefined)).toEqual({
      action: "prompt",
      version: "1.7.1",
      releaseNotes: "## Amical 1.7.1",
    });
  });

  it("returns null when the same version was dismissed", () => {
    expect(computeUpdatePrompt(meta(), true, "1.7.1")).toBeNull();
  });

  it("returns the prompt when a different version was dismissed", () => {
    expect(computeUpdatePrompt(meta(), true, "1.7.0")).not.toBeNull();
  });

  it("ignores dismissal for force updates", () => {
    expect(computeUpdatePrompt(meta({ action: "force" }), true, "1.7.1")).toEqual({
      action: "force",
      version: "1.7.1",
      releaseNotes: "## Amical 1.7.1",
    });
  });
});
