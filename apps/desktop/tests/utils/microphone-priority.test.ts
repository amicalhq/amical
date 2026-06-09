import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVICE_ID,
  healPendingMicrophone,
  mergeConnectedMicrophones,
  promoteAmongConnected,
  resolveActiveMicrophone,
  type AudioDevice,
  type MicrophonePriorityEntry,
} from "../../src/utils/audio-devices";

const def: AudioDevice = {
  deviceId: DEFAULT_DEVICE_ID,
  label: "System Default (Built-in)",
  isDefault: true,
};
const builtin: AudioDevice = { deviceId: "builtin", label: "Built-in mic" };
const headset: AudioDevice = { deviceId: "headset", label: "USB Headset" };
const other: AudioDevice = { deviceId: "other", label: "Other Mic" };

const builtinE: MicrophonePriorityEntry = {
  deviceId: "builtin",
  name: "Built-in mic",
};
const headsetE: MicrophonePriorityEntry = {
  deviceId: "headset",
  name: "USB Headset",
};
const otherE: MicrophonePriorityEntry = {
  deviceId: "other",
  name: "Other Mic",
};

describe("resolveActiveMicrophone", () => {
  it("returns the highest-ranked entry that is connected", () => {
    expect(
      resolveActiveMicrophone([headsetE, builtinE], [def, builtin, headset]),
    ).toBe("headset");
  });

  it("falls back to the next entry when the top one is disconnected", () => {
    // Headset unplugged -> only default + builtin connected.
    expect(resolveActiveMicrophone([headsetE, builtinE], [def, builtin])).toBe(
      "builtin",
    );
  });

  it("falls back to the system default when nothing in the chain is connected", () => {
    expect(resolveActiveMicrophone([headsetE], [def])).toBe(DEFAULT_DEVICE_ID);
  });

  it("matches by deviceId only — a changed id is treated as a different device", () => {
    const priority: MicrophonePriorityEntry[] = [
      { deviceId: "stale-id", name: "USB Headset" },
    ];
    // Headset reconnected under a new id; the stale entry no longer resolves.
    expect(resolveActiveMicrophone(priority, [def, headset])).toBe(
      DEFAULT_DEVICE_ID,
    );
  });

  it("returns the default for an empty/undefined chain", () => {
    expect(resolveActiveMicrophone(undefined, [def])).toBe(DEFAULT_DEVICE_ID);
    expect(resolveActiveMicrophone([], [def])).toBe(DEFAULT_DEVICE_ID);
  });
});

describe("promoteAmongConnected", () => {
  it("moves to the absolute top when every mic is connected", () => {
    expect(
      promoteAmongConnected([builtinE, headsetE], headsetE, [builtin, headset]),
    ).toEqual([headsetE, builtinE]);
  });

  it("stays below a higher-ranked DISCONNECTED mic (the whole point)", () => {
    // Headset is ranked #1 but unplugged; builtin is active. Selecting `other`
    // should make it active without jumping above the headset.
    const result = promoteAmongConnected(
      [headsetE, builtinE, otherE],
      otherE,
      [builtin, other], // headset disconnected
    );
    expect(result).toEqual([headsetE, otherE, builtinE]);
    // headset still #1 -> reclaims active when it reconnects.
    expect(result[0]).toEqual(headsetE);
    // `other` is now the highest-ranked connected mic -> active.
    expect(resolveActiveMicrophone(result, [builtin, other])).toBe("other");
  });

  it("is a no-op when the mic is already the active one", () => {
    expect(
      promoteAmongConnected([builtinE, otherE], builtinE, [builtin, other]),
    ).toEqual([builtinE, otherE]);
  });
});

describe("mergeConnectedMicrophones", () => {
  it("appends newly-seen connected devices while preserving rank", () => {
    expect(
      mergeConnectedMicrophones([headsetE], [def, headset, builtin]),
    ).toEqual([
      headsetE,
      { deviceId: DEFAULT_DEVICE_ID, name: "System Default (Built-in)" },
      builtinE,
    ]);
  });

  it("keeps disconnected entries in the chain", () => {
    // Headset not connected, but stays remembered in the chain.
    const merged = mergeConnectedMicrophones([headsetE], [def]);
    expect(merged[0]).toEqual(headsetE);
    expect(merged).toContainEqual({
      deviceId: DEFAULT_DEVICE_ID,
      name: "System Default (Built-in)",
    });
  });

  it("seeds the full list from an empty base (default first)", () => {
    expect(
      mergeConnectedMicrophones([], [def, builtin, headset]).map(
        (e) => e.deviceId,
      ),
    ).toEqual([DEFAULT_DEVICE_ID, "builtin", "headset"]);
  });
});

describe("healPendingMicrophone", () => {
  it("prepends a healed id-set entry when the pending device is connected", () => {
    expect(
      healPendingMicrophone([builtinE], "USB Headset", [def, builtin, headset]),
    ).toEqual([headsetE, builtinE]);
  });

  it("returns null when there is no pending value", () => {
    expect(
      healPendingMicrophone([builtinE], undefined, [def, builtin]),
    ).toBeNull();
  });

  it("returns null when the pending device isn't connected", () => {
    expect(healPendingMicrophone([], "USB Headset", [def, builtin])).toBeNull();
  });

  it("returns the chain unchanged (to clear pending) when already ranked by id", () => {
    const priority = [headsetE, builtinE];
    expect(healPendingMicrophone(priority, "USB Headset", [def, headset])).toBe(
      priority,
    );
  });
});
