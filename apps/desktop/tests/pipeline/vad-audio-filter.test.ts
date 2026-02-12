import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAD_CONFIG,
  extractSpeechFromVad,
} from "../../src/pipeline/utils/vad-audio-filter";

describe("extractSpeechFromVad", () => {
  const config = {
    ...DEFAULT_VAD_CONFIG,
    startFrames: 2,
    endSilenceFrames: 1,
    preRollFrames: 0,
    postRollFrames: 0,
    minSpeechFrames: 2,
  };

  it("rejects speech when only one high-probability frame is provided", () => {
    const audioData = new Float32Array(DEFAULT_VAD_CONFIG.frameSize * 10).fill(
      0.5,
    );
    const result = extractSpeechFromVad(audioData, [1], config);

    expect(result.audio.length).toBe(0);
    expect(result.segments).toHaveLength(0);
  });

  it("accepts speech when probabilities are provided per audio frame", () => {
    const frameCount = 10;
    const audioData = new Float32Array(
      DEFAULT_VAD_CONFIG.frameSize * frameCount,
    ).fill(0.5);
    const vadProbs = new Array(frameCount).fill(1);

    const result = extractSpeechFromVad(audioData, vadProbs, config);

    expect(result.audio.length).toBe(audioData.length);
    expect(result.segments).toHaveLength(1);
  });
});
