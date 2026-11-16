import fs from "node:fs";
import { EventEmitter } from "node:events";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real NativeBridge over a fake helper process: the error sites under
// test are the bridge's own spawn-error and stdout handlers.
const helper = vi.hoisted(() => ({
  proc: null as EventEmitter | null,
  failSpawn: false,
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  return {
    ...actual,
    spawn: vi.fn(() => {
      helper.proc = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
      });
      // Like Node, a failed spawn reports "error" on the next tick.
      const proc = helper.proc;
      if (helper.failSpawn) {
        process.nextTick(() => proc.emit("error", new Error("spawn EACCES")));
      }
      return proc;
    }),
  };
});

// Deterministic platform gate: the layer always builds the bridge.
vi.mock("../../src/utils/platform", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, isMacOS: () => true, isWindows: () => false };
});

import { NativeBridgeLive } from "../../src/main/runtime/layers";
import { NativeBridge } from "../../src/services/platform/native-bridge-service";
import {
  AppScopeTag,
  NativeBridgeTag,
  TelemetryServiceTag,
} from "../../src/main/runtime/tags";

describe("NativeBridgeLive error events", () => {
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      scope = null;
    }
    helper.failSpawn = false;
    vi.restoreAllMocks();
  });

  async function buildBridge() {
    vi.spyOn(
      NativeBridge.prototype as unknown as { determineHelperPath(): string },
      "determineHelperPath",
    ).mockReturnValue("/helper/bin/NativeHelper");
    vi.spyOn(fs, "accessSync").mockReturnValue(undefined);
    const telemetry = { captureException: vi.fn() };
    scope = Effect.runSync(Scope.make());
    const ctx = await Effect.runPromise(
      Layer.build(
        NativeBridgeLive.pipe(
          Layer.provide(Layer.succeed(TelemetryServiceTag, telemetry as never)),
          Layer.provide(Layer.succeed(AppScopeTag, scope)),
        ),
      ).pipe(Scope.provide(scope)),
    );
    const bridge = Context.get(ctx, NativeBridgeTag) as unknown as {
      handleHelperLine(line: string): void;
    };
    return { bridge, telemetry, proc: helper.proc! };
  }

  it("does not throw when the helper process fails to spawn", async () => {
    const { proc, telemetry } = await buildBridge();

    expect(() => proc.emit("error", new Error("spawn EACCES"))).not.toThrow();
    expect(telemetry.captureException).toHaveBeenCalledTimes(1);
  });

  it("emits no ready when the helper process fails to spawn", async () => {
    helper.failSpawn = true;
    const emit = vi.spyOn(
      NativeBridge.prototype as unknown as { emit(event: string): boolean },
      "emit",
    );

    const { bridge } = await buildBridge();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Only this bridge: an earlier test's bridge can emit late.
    const events = emit.mock.calls
      .filter((_, i) => emit.mock.contexts[i] === bridge)
      .map(([event]) => event);
    expect(events).toContain("error");
    expect(events).not.toContain("ready");
  });

  it("does not throw on a helper stdout line that is not JSON", async () => {
    const { bridge, telemetry } = await buildBridge();

    expect(() => bridge.handleHelperLine("not json")).not.toThrow();
    expect(telemetry.captureException).toHaveBeenCalledTimes(1);
  });
});
