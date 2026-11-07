// Research probes for the exact npm release; this does not load Amical code.
// Usage: node effect-4-probes.mjs /path/to/extracted/package
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageDir = resolve(process.argv[2] ?? "./package");
const metadata = JSON.parse(
  await readFile(resolve(packageDir, "package.json"), "utf8"),
);
assert.equal(metadata.name, "effect");
assert.equal(metadata.version, "4.0.0-rc.115");
const modules = [
  "Effect",
  "Context",
  "Layer",
  "Fiber",
  "Cause",
  "ManagedRuntime",
  "Semaphore",
  "Tracer",
];
const [
  Effect,
  Context,
  Layer,
  Fiber,
  Cause,
  ManagedRuntime,
  Semaphore,
  Tracer,
] = await Promise.all(
  modules.map(
    (name) =>
      import(pathToFileURL(resolve(packageDir, "dist", `${name}.js`)).href),
  ),
);

console.log(`Effect ${metadata.version}; Node ${process.version}`);

// Receiver binding moved from the first argument to an options.self field.
const receiver = { value: 42 };
function* readReceiver() {
  return this.value;
}
const oldReceiver = await Effect.runPromiseExit(
  Effect.gen(receiver, readReceiver),
);
assert.equal(oldReceiver._tag, "Failure");
assert.equal(
  await Effect.runPromise(Effect.gen({ self: receiver }, readReceiver)),
  42,
);
console.log("Effect.gen receiver: old form fails; { self: receiver } succeeds");

// Root runners execute the synchronous prefix before returning.
for (const name of ["runFork", "runForkWith", "runPromise", "runPromiseWith"]) {
  const events = [];
  const run = name.endsWith("With")
    ? Effect[name](Context.empty())
    : Effect[name];
  const result = run(Effect.sync(() => events.push("prefix")));
  events.push("returned");
  assert.deepEqual(events, ["prefix", "returned"], name);
  if (name.includes("Promise")) await result;
  else await Effect.runPromise(Fiber.await(result));
  console.log(`${name}: ${events.join(" -> ")}`);
}

// A static tracer context preserves synchronous root startup.
const traceEvents = [];
const tracer = Tracer.make({
  span: (options) => {
    traceEvents.push(`span:${options.name}`);
    return Tracer.nativeTracer.span(options);
  },
});
const tracedFiber = Effect.runForkWith(Context.make(Tracer.Tracer, tracer))(
  Effect.sync(() => traceEvents.push("prefix")).pipe(Effect.withSpan("probe")),
);
traceEvents.push("returned");
assert.deepEqual(traceEvents, ["span:probe", "prefix", "returned"]);
await Effect.runPromise(Fiber.join(tracedFiber));
console.log(`Context tracer: ${traceEvents.join(" -> ")}`);

// Child/detached forks defer by default; immediate startup is opt-in.
for (const name of ["forkChild", "forkDetach"]) {
  for (const immediate of [false, true]) {
    const events = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect[name](
          Effect.sync(() => events.push("prefix")),
          immediate ? { startImmediately: true } : undefined,
        );
        events.push("fork returned");
        yield* Fiber.join(fiber);
      }),
    );
    assert.deepEqual(
      events,
      immediate ? ["prefix", "fork returned"] : ["fork returned", "prefix"],
    );
    console.log(`${name} immediate=${immediate}: ${events.join(" -> ")}`);
  }
}

// ManagedRuntime can initialize synchronously when its layers are synchronous.
const Service = Context.Service("effect-4-probe/Service");
for (const name of ["runFork", "runPromise", "runSync"]) {
  const events = [];
  const runtime = ManagedRuntime.make(Layer.succeed(Service, {}));
  try {
    const result = runtime[name](Effect.sync(() => events.push("prefix")));
    events.push("returned");
    assert.deepEqual(events, ["prefix", "returned"], name);
    if (name === "runPromise") await result;
    if (name === "runFork") await Effect.runPromise(Fiber.await(result));
    console.log(`ManagedRuntime cold sync ${name}: ${events.join(" -> ")}`);
  } finally {
    await runtime.dispose();
  }
}
const asyncRuntime = ManagedRuntime.make(
  Layer.effect(
    Service,
    Effect.promise(async () => ({})),
  ),
);
try {
  const events = [];
  const fiber = asyncRuntime.runFork(Effect.sync(() => events.push("prefix")));
  events.push("returned");
  assert.deepEqual(events, ["returned"]);
  await Effect.runPromise(Fiber.join(fiber));
  assert.deepEqual(events, ["returned", "prefix"]);
  console.log(`ManagedRuntime cold async runFork: ${events.join(" -> ")}`);
} finally {
  await asyncRuntime.dispose();
}

// Typed recovery/result conversion can discard a co-present finalizer defect.
const typed = { _tag: "QuotaExceeded", message: "typed" };
const defect = new Error("finalizer bug");
const mixed = Effect.fail(typed).pipe(Effect.ensuring(Effect.die(defect)));
const raw = await Effect.runPromiseExit(mixed);
assert.equal(raw._tag, "Failure");
assert.deepEqual(
  raw.cause.reasons.map((reason) => reason._tag),
  ["Fail", "Die"],
);
assert.equal(raw.cause.reasons[0].error, typed);
assert.equal(raw.cause.reasons[1].defect, defect);
console.log("Mixed raw Exit: Fail(typed) + Die(defect)");
for (const name of ["catch", "catchDefect"]) {
  let handlerRan = false;
  const recovered = await Effect.runPromiseExit(
    mixed.pipe(
      Effect[name](() => {
        handlerRan = true;
        return Effect.succeed("handled");
      }),
    ),
  );
  assert.equal(handlerRan, true);
  assert.equal(recovered._tag, "Success");
  assert.equal(recovered.value, "handled");
  console.log(`Mixed ${name}: handler ran; Success(handled)`);
}
const result = await Effect.runPromiseExit(Effect.result(mixed));
assert.equal(result._tag, "Success");
assert.equal(result.value._tag, "Failure");
assert.equal(result.value.failure, typed);
assert.equal(Object.hasOwn(Cause, "electFailures"), false);
console.log(
  "Mixed result: Success(Result.Failure(typed)); electFailures absent",
);

// Raw defects retain identity across span annotation boundaries.
for (const [name, effect] of [
  ["plain", Effect.die(defect)],
  ["one span", Effect.die(defect).pipe(Effect.withSpan("one"))],
  [
    "nested spans",
    Effect.die(defect).pipe(Effect.withSpan("inner"), Effect.withSpan("outer")),
  ],
]) {
  const exit = await Effect.runPromiseExit(effect);
  assert.equal(exit._tag, "Failure");
  assert.equal(exit.cause.reasons[0].defect, defect);
  console.log(`Defect identity ${name}: preserved`);
}
assert.equal(Object.hasOwn(Cause, "originalError"), false);

// Semaphore(1) permits a new arrival to overtake an already queued waiter.
const semaphore = Semaphore.makeUnsafe(1);
const order = [];
Effect.runSync(semaphore.take(1));
const waiter = Effect.runFork(
  semaphore.withPermit(Effect.sync(() => order.push("queued earlier"))),
);
try {
  await Effect.runPromise(
    semaphore
      .release(1)
      .pipe(
        Effect.andThen(
          semaphore.withPermit(Effect.sync(() => order.push("new arrival"))),
        ),
      ),
  );
  await Effect.runPromise(Fiber.join(waiter));
  assert.deepEqual(order, ["new arrival", "queued earlier"]);
  console.log(`Semaphore overtaking: ${order.join(" -> ")}`);
} finally {
  await Effect.runPromise(Fiber.interrupt(waiter));
}

console.log("All RC characterization checks passed.");
