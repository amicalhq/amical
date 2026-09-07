import { describe, expect, it, vi } from "vitest";
import { updaterRouter } from "../../src/trpc/routers/updater";

const requirement = { required: true, evaluatedVersion: "1.0.0" };

describe("required update subscription", () => {
  it("publishes cached policy immediately and recording completion without a refetch", async () => {
    let active = true;
    let changed!: () => void;
    let recorded!: () => void;
    const offConfig = vi.fn();
    const offRecording = vi.fn();
    const caller = updaterRouter.createCaller({
      services: {
        remoteConfigService: {
          getUpdateRequirement: () => requirement,
          onChange: (callback: () => void) => {
            changed = callback;
            return offConfig;
          },
        },
        recordingLifecycle: {
          getSnapshot: () => ({
            projection: { publicState: active ? "recording" : "idle" },
          }),
          onSnapshot: (callback: () => void) => {
            recorded = callback;
            return offRecording;
          },
        },
      },
    } as never);
    const states: unknown[] = [];
    const subscription = (await caller.updateRequirement()).subscribe({
      next: (state) => states.push(state),
    });
    expect(states.at(-1)).toEqual({ requirement, recordingActive: true });
    active = false;
    recorded();
    expect(states.at(-1)).toEqual({ requirement, recordingActive: false });
    changed();
    subscription.unsubscribe();
    expect(offConfig).toHaveBeenCalledOnce();
    expect(offRecording).toHaveBeenCalledOnce();
  });
});
