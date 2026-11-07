import { describe, expect, it } from "vitest";
import {
  RECOVERY_INTERRUPTED_CAUSE,
  decideRecovery,
} from "../../src/main/lifecycle/recovery";

describe("lifecycle recovery disposition", () => {
  it("keeps captured audio as a re-transcribable failure", () => {
    expect(decideRecovery({ hasCapturedAudio: true })).toEqual({
      kind: "failure",
      cause: RECOVERY_INTERRUPTED_CAUSE,
    });
  });

  it("deletes sessions that captured no audio artifact", () => {
    expect(decideRecovery({ hasCapturedAudio: false })).toEqual({
      kind: "discard",
      reason: "no_audio",
    });
  });
});
