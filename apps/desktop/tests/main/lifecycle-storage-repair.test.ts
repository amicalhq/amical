import { describe, expect, it, vi } from "vitest";
import { FakeTimers } from "../helpers/lifecycle-fakes";

const db = vi.hoisted(() => ({
  stampTranscriptionDisposition: vi.fn(
    async (): Promise<unknown> => ({
      id: 1,
    }),
  ),
  deleteProvisionalTranscription: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock("../../src/db/transcriptions", () => db);
vi.mock("../../src/db/daily-stats", () => ({
  incrementDailyStats: vi.fn(async () => undefined),
}));

import { createStorageAdapter } from "../../src/main/lifecycle/adapters/storage";
import type { LifecyclePortFact } from "../../src/main/lifecycle/ports";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const REPAIR_MS = 9;

describe("lifecycle storage quarantine-lite repair", () => {
  it("reports the settled attempt on failure, then retries once in the background", async () => {
    const facts: LifecyclePortFact[] = [];
    const timers = new FakeTimers();
    const adapter = createStorageAdapter((fact) => facts.push(fact), {
      timers,
      repairDelayMs: REPAIR_MS,
    });

    db.stampTranscriptionDisposition.mockRejectedValueOnce(
      new Error("db locked"),
    );
    adapter.commit("s1", { kind: "success", text: "kept text" });
    await settle();

    // The attempt settled (failed): the fact fires either way (D15) so the
    // machine never eats the grace bound for a known failure. One repair
    // timer armed.
    expect(facts).toEqual([{ type: "storageFinished", session: "s1" }]);
    expect(timers.armedDurations()).toEqual([REPAIR_MS]);

    timers.fire(REPAIR_MS);
    await settle();

    // The repair stamped the row silently — no second fact (the machine
    // already moved on; a late fact would be a fenced no-op anyway).
    expect(facts).toEqual([{ type: "storageFinished", session: "s1" }]);
    expect(db.stampTranscriptionDisposition).toHaveBeenCalledTimes(2);
    expect(db.stampTranscriptionDisposition).toHaveBeenLastCalledWith("s1", {
      disposition: "success",
      text: "kept text",
    });
  });

  it("gives up after a failed repair (startup recovery settles the row)", async () => {
    const facts: LifecyclePortFact[] = [];
    const timers = new FakeTimers();
    const adapter = createStorageAdapter((fact) => facts.push(fact), {
      timers,
      repairDelayMs: REPAIR_MS,
    });

    db.stampTranscriptionDisposition.mockRejectedValue(new Error("db gone"));
    adapter.commit("s1", { kind: "dismissed" });
    await settle();
    timers.fire(REPAIR_MS);
    await settle();

    expect(facts).toEqual([{ type: "storageFinished", session: "s1" }]);
    expect(timers.armedDurations()).toEqual([]); // no retry loop
    db.stampTranscriptionDisposition.mockResolvedValue({ id: 1 });
  });
});
