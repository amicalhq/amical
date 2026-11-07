import { describe, expect, it, vi } from "vitest";
import { ipcRenderer } from "electron";
import { audioBridge } from "@/main/preload-audio-bridge";

vi.mock("electron", () => ({
  ipcRenderer: { invoke: vi.fn().mockResolvedValue(undefined) },
}));

describe("audio capture IPC bridge", () => {
  it("forwards channel metadata with only the supplied audio view", async () => {
    const samples = new Float32Array([99, 0.25, -0.5, 99]);
    const captureInfo = {
      inputChannelCount: 2,
      trackChannelCount: 2,
      stereoDownmixEnabled: true,
    };

    await audioBridge.sendAudioChunk(
      "session-1",
      samples.subarray(1, 3),
      true,
      captureInfo,
    );

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      "audio-data-chunk",
      "session-1",
      new Float32Array([0.25, -0.5]).buffer,
      true,
      captureInfo,
    );
  });
});
