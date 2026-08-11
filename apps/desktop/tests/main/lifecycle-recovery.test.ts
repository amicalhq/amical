import { describe, expect, it } from "vitest";
import {
  RECOVERY_INTERRUPTED_CAUSE,
  decideRecovery,
} from "../../src/main/lifecycle/recovery";

describe("lifecycle recovery disposition", () => {
  it("keeps audible audio as a re-transcribable failure", () => {
    expect(decideRecovery({ hasAudibleAudio: true })).toEqual({
      kind: "failure",
      cause: RECOVERY_INTERRUPTED_CAUSE,
    });
  });

  it("deletes sessions that captured nothing audible", () => {
    expect(decideRecovery({ hasAudibleAudio: false })).toEqual({
      kind: "discard",
      reason: "no_audio",
    });
  });
});
