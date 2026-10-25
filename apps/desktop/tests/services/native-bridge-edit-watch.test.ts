import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NativeBridge,
  NativeBridgeTimeoutError,
} from "../../src/services/platform/native-bridge-service";

const FIELD_TEXT = "SECRET FIELD TEXT 7f3a";

type Harness = {
  pending: Map<string, unknown>;
  lateEditWatchIds: Set<string>;
  logger: Record<"debug" | "info" | "warn" | "error", ReturnType<typeof vi.fn>>;
  telemetryService: { captureException: ReturnType<typeof vi.fn> };
  proc: unknown;
  readEditWatch: NativeBridge["readEditWatch"];
  handleHelperLine: (line: string) => void;
};

function createBridge() {
  const bridge = Object.create(NativeBridge.prototype) as Harness;
  bridge.pending = new Map();
  bridge.lateEditWatchIds = new Set();
  bridge.logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  bridge.telemetryService = { captureException: vi.fn() };
  const written: string[] = [];
  bridge.proc = {
    stdin: {
      writable: true,
      write: (data: string, callback?: (error?: Error) => void) => {
        written.push(data);
        callback?.();
        return true;
      },
    },
  };
  return { bridge, written };
}

const everythingLogged = (bridge: Harness) =>
  JSON.stringify(Object.values(bridge.logger).map((fn) => fn.mock.calls));

const answer = (id: string) =>
  JSON.stringify({
    id,
    result: { readStatus: "ok", text: FIELD_TEXT, selection: null, readMs: 3 },
  });

describe("NativeBridge edit watch redaction", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops a late read answer without logging it and reports no exception for the timeout", async () => {
    vi.useFakeTimers();
    const { bridge, written } = createBridge();

    const read = bridge.readEditWatch("w1");
    const { id } = JSON.parse(written[0]) as { id: string };
    vi.advanceTimersByTime(2000);
    await expect(read).rejects.toBeInstanceOf(NativeBridgeTimeoutError);
    expect(bridge.telemetryService.captureException).not.toHaveBeenCalled();

    bridge.handleHelperLine(answer(id));

    expect(everythingLogged(bridge)).not.toContain(FIELD_TEXT);
    expect(bridge.logger.warn).not.toHaveBeenCalled();
    expect(bridge.lateEditWatchIds.has(id)).toBe(false);
  });

  it("never logs the text of a timely read answer", async () => {
    const { bridge, written } = createBridge();

    const read = bridge.readEditWatch("w1");
    const { id } = JSON.parse(written[0]) as { id: string };
    bridge.handleHelperLine(answer(id));

    await expect(read).resolves.toMatchObject({
      readStatus: "ok",
      text: FIELD_TEXT,
    });
    expect(everythingLogged(bridge)).not.toContain(FIELD_TEXT);
  });

  it("redacts a read answer with no pending call and a broken read line, in logs and telemetry", () => {
    const { bridge } = createBridge();
    const errors: Error[] = [];
    (bridge as unknown as NativeBridge).on("error", (error: Error) =>
      errors.push(error),
    );

    bridge.handleHelperLine(answer("unknown-id"));
    bridge.handleHelperLine(answer("cut-off").slice(0, -2));

    expect(everythingLogged(bridge)).not.toContain(FIELD_TEXT);
    expect(errors.map((error) => error.message).join()).not.toContain(
      FIELD_TEXT,
    );
    expect(
      JSON.stringify(bridge.telemetryService.captureException.mock.calls),
    ).not.toContain(FIELD_TEXT);
    expect(bridge.telemetryService.captureException).toHaveBeenCalledTimes(1);
  });
});
