import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  runFork,
  runPromise,
  setSpanEndSink,
} from "../../src/main/runtime/telemetry-runtime";

describe("telemetry runtime shell", () => {
  // This test must stay FIRST: it pins that the module-load-time runtime has
  // no cold phase — the very first fork runs its synchronous prefix before
  // runFork returns. A lazily built runtime (ManagedRuntime) fails this.
  it("runs the synchronous prefix of the first fork before returning", () => {
    let ran = false;
    runFork(
      Effect.sync(() => {
        ran = true;
      }),
    );
    expect(ran).toBe(true);
  });

  it("withSpan reaches the sink exactly once with the span name", async () => {
    const names: string[] = [];
    setSpanEndSink((span) => {
      names.push(span.name);
    });
    try {
      await runPromise(Effect.void.pipe(Effect.withSpan("probe.span")));
    } finally {
      setSpanEndSink(() => {});
    }
    expect(names).toEqual(["probe.span"]);
  });

  it("a failing span still reaches the sink with the failure exit", async () => {
    const seen: Array<{ name: string; failed: boolean }> = [];
    setSpanEndSink((span, exit) => {
      seen.push({ name: span.name, failed: exit._tag === "Failure" });
    });
    try {
      await runPromise(
        Effect.fail(new Error("boom")).pipe(
          Effect.withSpan("probe.fail"),
          Effect.ignore,
        ),
      );
    } finally {
      setSpanEndSink(() => {});
    }
    expect(seen).toEqual([{ name: "probe.fail", failed: true }]);
  });

  it("a throwing sink never poisons the fiber", async () => {
    setSpanEndSink(() => {
      throw new Error("sink boom");
    });
    try {
      const result = await runPromise(
        Effect.succeed("ok").pipe(Effect.withSpan("probe.poison")),
      );
      expect(result).toBe("ok");
    } finally {
      setSpanEndSink(() => {});
    }
  });

  it("nested spans carry parentage through fiber context", async () => {
    const parents: Array<string | null> = [];
    setSpanEndSink((span) => {
      parents.push(
        span.parent._tag === "Some" && span.parent.value._tag === "Span"
          ? span.parent.value.name
          : null,
      );
    });
    try {
      await runPromise(
        Effect.void.pipe(Effect.withSpan("child"), Effect.withSpan("parent")),
      );
    } finally {
      setSpanEndSink(() => {});
    }
    // child ends first (parent name recorded), then parent (no parent).
    expect(parents).toEqual(["parent", null]);
  });

  it("children inherit the trace id; separate roots get distinct trace ids", async () => {
    const traces: Array<{ name: string; traceId: string }> = [];
    setSpanEndSink((span) => {
      traces.push({ name: span.name, traceId: span.traceId });
    });
    try {
      await runPromise(
        Effect.void.pipe(Effect.withSpan("child-a"), Effect.withSpan("root-a")),
      );
      await runPromise(Effect.void.pipe(Effect.withSpan("root-b")));
    } finally {
      setSpanEndSink(() => {});
    }
    const byName = Object.fromEntries(traces.map((t) => [t.name, t.traceId]));
    expect(byName["child-a"]).toBe(byName["root-a"]);
    expect(byName["root-b"]).not.toBe(byName["root-a"]);
  });
});
