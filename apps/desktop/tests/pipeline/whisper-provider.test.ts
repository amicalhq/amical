import { describe, expect, it, vi } from "vitest";
import type { GetAccessibilityContextResult } from "@amical/types";
import type { ModelService } from "../../src/services/model-service";
import type { TranscribeContext } from "../../src/pipeline/core/pipeline-types";
import { WhisperProvider } from "../../src/pipeline/providers/transcription/whisper-provider";

const targetAppContext = {
  context: {
    textSelection: {
      preSelectionText: "ctrl esc to focus or unfocus Claude",
    },
  },
} as unknown as GetAccessibilityContextResult;

describe("WhisperProvider initial prompt", () => {
  it("does not send target-app text when one language is forced", async () => {
    const provider = new WhisperProvider({} as ModelService);
    const exec = vi.fn().mockResolvedValue({ text: "тест" });

    vi.spyOn(provider, "initializeWhisper").mockResolvedValue();
    Object.assign(provider, { workerWrapper: { exec } });

    const context: TranscribeContext = {
      languages: ["ru"],
      vocabulary: ["Amical"],
      accessibilityContext: targetAppContext,
    };

    for (let frame = 0; frame < 3; frame++) {
      await provider.transcribe({
        audioData: new Float32Array(512).fill(0.1),
        speechProbability: 1,
        context,
      });
    }
    await provider.flush(context);

    const transcribeCall = exec.mock.calls.find(
      ([method]) => method === "transcribeAudio",
    );
    expect(transcribeCall).toBeDefined();
    expect(transcribeCall?.[1][1]).toMatchObject({
      languages: ["ru"],
      initial_prompt: "Amical",
    });
  });
});
