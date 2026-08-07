import { describe, expect, it, vi } from "vitest";
import { NativeBridge } from "../../src/services/platform/native-bridge-service";

type NativeBridgeHarness = {
  accessibilityContext: unknown;
  accessibilityContextRefreshId: number;
  call: ReturnType<typeof vi.fn>;
  logger: {
    debug: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  refreshAccessibilityContext: NativeBridge["refreshAccessibilityContext"];
  getAccessibilityContext: NativeBridge["getAccessibilityContext"];
};

const createBridgeWithoutHelper = (): NativeBridgeHarness => {
  const bridge = Object.create(NativeBridge.prototype) as NativeBridgeHarness;
  bridge.accessibilityContext = null;
  bridge.accessibilityContextRefreshId = 0;
  bridge.call = vi.fn();
  bridge.logger = {
    debug: vi.fn(),
    error: vi.fn(),
  };
  return bridge;
};

describe("NativeBridge accessibility context", () => {
  it("does not let an older refresh overwrite the latest context", async () => {
    const older = Promise.withResolvers<unknown>();
    const latest = Promise.withResolvers<unknown>();
    const bridge = createBridgeWithoutHelper();
    bridge.call
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise);

    const olderRefresh = bridge.refreshAccessibilityContext();
    const latestRefresh = bridge.refreshAccessibilityContext();

    latest.resolve({ context: { application: { name: "Latest" } } });
    await latestRefresh;
    older.resolve({ context: { application: { name: "Older" } } });
    await olderRefresh;

    expect(bridge.getAccessibilityContext()?.context?.application?.name).toBe(
      "Latest",
    );
  });
});
