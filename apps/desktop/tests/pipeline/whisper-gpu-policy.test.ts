import { describe, expect, it } from "vitest";
import { decideWhisperGpuUse } from "../../src/pipeline/providers/transcription/whisper-gpu-policy";

describe("decideWhisperGpuUse", () => {
  it("disables GPU on Intel-only macOS x64 graphics", () => {
    const decision = decideWhisperGpuUse(
      [
        {
          vendor: "Intel",
          model: "Intel(R) Iris(TM) Plus Graphics",
        },
      ],
      "darwin",
      "x64",
    );

    expect(decision.useGpu).toBe(false);
  });

  it("keeps GPU enabled when an AMD controller is present on macOS x64", () => {
    const decision = decideWhisperGpuUse(
      [
        {
          vendor: "Intel",
          model: "Intel UHD Graphics 630",
        },
        {
          vendor: "AMD",
          model: "AMD Radeon Pro 5500M",
        },
      ],
      "darwin",
      "x64",
    );

    expect(decision.useGpu).toBe(true);
  });

  it("keeps GPU enabled for AMD Radeon HD graphics on macOS x64", () => {
    const decision = decideWhisperGpuUse(
      [
        {
          vendor: "AMD",
          model: "AMD Radeon HD - FirePro D700",
        },
      ],
      "darwin",
      "x64",
    );

    expect(decision.useGpu).toBe(true);
  });

  it("keeps GPU enabled on non-x64 macOS", () => {
    const decision = decideWhisperGpuUse(
      [
        {
          vendor: "Intel",
          model: "Intel(R) Iris(TM) Plus Graphics",
        },
      ],
      "darwin",
      "arm64",
    );

    expect(decision.useGpu).toBe(true);
  });

  it("keeps GPU enabled on non-macOS platforms", () => {
    const decision = decideWhisperGpuUse(
      [
        {
          vendor: "Intel",
          model: "Intel UHD Graphics",
        },
      ],
      "win32",
      "x64",
    );

    expect(decision.useGpu).toBe(true);
  });

  it("keeps GPU enabled if graphics probing returns no controllers", () => {
    const decision = decideWhisperGpuUse([], "darwin", "x64");

    expect(decision.useGpu).toBe(true);
  });
});
