import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { transitionLifecycle } from "../../src/main/lifecycle/machine";
import { projectLifecycle } from "../../src/main/lifecycle/projection";
import type {
  LifecycleCommand,
  LifecycleEvent,
  LifecycleState,
} from "../../src/main/lifecycle/types";
import {
  LIFECYCLE_EVENT_ATOMS,
  LIFECYCLE_STATE_ATOMS,
  EXPECTED_VECTOR_COUNT,
  assertLifecycleAtomManifests,
  encodeLifecycleEventAtom,
  encodeLifecycleStateAtom,
} from "./atoms";
import { LIFECYCLE_TRACES, type LifecycleTrace } from "./traces";

export const LIFECYCLE_CONTRACT_VERSION = 1;
export const LIFECYCLE_CONTRACT_SOURCE = "src/main/lifecycle/machine.ts";
export const LIFECYCLE_CONTRACT_ARTIFACT_PATH = resolve(
  __dirname,
  "../../tests/main/lifecycle-contract.json",
);

export interface LifecycleVector {
  state: LifecycleState;
  event: LifecycleEvent;
  expect: { state: LifecycleState; commands: LifecycleCommand[] };
}

export interface LifecycleContractArtifact {
  contractVersion: number;
  contentDigest: string;
  source: string;
  counts: { states: number; events: number; vectors: number; traces: number };
  atoms: {
    states: Record<string, LifecycleState>;
    events: Record<string, LifecycleEvent>;
  };
  vectors: LifecycleVector[];
  traces: LifecycleTrace[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function buildLifecycleVectors(): LifecycleVector[] {
  assertLifecycleAtomManifests();

  const vectors: LifecycleVector[] = [];
  for (const state of Object.values(LIFECYCLE_STATE_ATOMS)) {
    for (const event of Object.values(LIFECYCLE_EVENT_ATOMS)) {
      const stateInput = clone(state);
      const eventInput = clone(event);
      const stateSnapshot = clone(stateInput);
      const eventSnapshot = clone(eventInput);
      const transition = transitionLifecycle(stateInput, eventInput);

      if (
        !isDeepStrictEqual(stateInput, stateSnapshot) ||
        !isDeepStrictEqual(eventInput, eventSnapshot)
      ) {
        throw new Error(
          `Lifecycle reducer mutated ${encodeLifecycleStateAtom(stateSnapshot)} × ` +
            encodeLifecycleEventAtom(eventSnapshot),
        );
      }

      if (
        transition.commands.length === 0 &&
        isDeepStrictEqual(transition.state, stateSnapshot) &&
        transition.state !== stateInput
      ) {
        throw new Error(
          `Lifecycle reducer returned an equal but distinct state for no-op ` +
            `${encodeLifecycleStateAtom(stateSnapshot)} × ${encodeLifecycleEventAtom(eventSnapshot)}`,
        );
      }

      vectors.push({
        state: stateSnapshot,
        event: eventSnapshot,
        expect: clone({
          state: transition.state,
          commands: transition.commands,
        }),
      });
    }
  }

  if (vectors.length !== EXPECTED_VECTOR_COUNT) {
    throw new Error(
      `Generated ${vectors.length} lifecycle vectors; expected ${EXPECTED_VECTOR_COUNT}`,
    );
  }
  return vectors;
}

/**
 * Trace fixtures carry hand-written expectations; the reducer must agree
 * with every step or the artifact refuses to build. This is the double-entry
 * check on the same reducer the vectors are generated from.
 */
export function validateLifecycleTraces(): LifecycleTrace[] {
  for (const trace of LIFECYCLE_TRACES) {
    let state = clone(trace.given);
    trace.steps.forEach((step, index) => {
      const transition = transitionLifecycle(state, clone(step.event));
      const projection = projectLifecycle(transition.state);
      const actual = {
        state: transition.state,
        commands: transition.commands,
        projection,
      };
      if (!isDeepStrictEqual(actual, step.expect)) {
        throw new Error(
          `Lifecycle trace "${trace.name}" diverges at step ${index + 1}: ` +
            `expected ${JSON.stringify(step.expect)}, got ${JSON.stringify(actual)}`,
        );
      }
      state = transition.state;
    });
  }
  return clone(LIFECYCLE_TRACES);
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot canonicalize a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  throw new Error(`Cannot canonicalize ${typeof value}`);
}

export function lifecycleContentDigest(
  content: Pick<LifecycleContractArtifact, "atoms" | "traces" | "vectors">,
): string {
  return `sha256:${createHash("sha256")
    .update(
      canonicalJson({
        atoms: content.atoms,
        traces: content.traces,
        vectors: content.vectors,
      }),
      "utf8",
    )
    .digest("hex")}`;
}

export function buildLifecycleContractArtifact(): LifecycleContractArtifact {
  const vectors = buildLifecycleVectors();
  const traces = validateLifecycleTraces();
  const atoms = {
    states: clone(LIFECYCLE_STATE_ATOMS),
    events: clone(LIFECYCLE_EVENT_ATOMS),
  };
  return {
    contractVersion: LIFECYCLE_CONTRACT_VERSION,
    contentDigest: lifecycleContentDigest({ atoms, traces, vectors }),
    source: LIFECYCLE_CONTRACT_SOURCE,
    counts: {
      states: Object.keys(atoms.states).length,
      events: Object.keys(atoms.events).length,
      vectors: vectors.length,
      traces: traces.length,
    },
    atoms,
    vectors,
    traces,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  name: string,
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      `${name} keys are ${actual.join(", ")}; expected ${expected.join(", ")}`,
    );
  }
}

export function parseLifecycleContractArtifact(
  serialized: string,
): LifecycleContractArtifact {
  const parsed: unknown = JSON.parse(serialized);
  if (!isObject(parsed)) {
    throw new Error("Lifecycle contract artifact must be an object");
  }
  assertExactKeys("Lifecycle contract artifact", parsed, [
    "contractVersion",
    "contentDigest",
    "source",
    "counts",
    "atoms",
    "vectors",
    "traces",
  ]);
  if (
    !Number.isInteger(parsed.contractVersion) ||
    (parsed.contractVersion as number) < 1
  ) {
    throw new Error("Lifecycle contract version must be a positive integer");
  }
  if (
    typeof parsed.contentDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(parsed.contentDigest)
  ) {
    throw new Error(
      "Lifecycle contract artifact has an invalid content digest",
    );
  }
  if (typeof parsed.source !== "string" || parsed.source.length === 0) {
    throw new Error("Lifecycle contract artifact source must be a path");
  }
  if (!isObject(parsed.counts)) {
    throw new Error("Lifecycle contract artifact counts must be an object");
  }
  assertExactKeys("Lifecycle contract counts", parsed.counts, [
    "states",
    "events",
    "vectors",
    "traces",
  ]);
  if (!isObject(parsed.atoms)) {
    throw new Error("Lifecycle contract artifact atoms must be an object");
  }
  assertExactKeys("Lifecycle contract atoms", parsed.atoms, [
    "states",
    "events",
  ]);
  if (!Array.isArray(parsed.vectors) || !Array.isArray(parsed.traces)) {
    throw new Error(
      "Lifecycle contract artifact vectors and traces must be arrays",
    );
  }

  const counts = parsed.counts as LifecycleContractArtifact["counts"];
  const atoms = parsed.atoms as LifecycleContractArtifact["atoms"];
  if (
    !Number.isInteger(counts.states) ||
    counts.states < 1 ||
    !Number.isInteger(counts.events) ||
    counts.events < 1 ||
    counts.states * counts.events !== counts.vectors ||
    counts.vectors !== parsed.vectors.length ||
    counts.traces !== parsed.traces.length ||
    counts.states !== Object.keys(atoms.states).length ||
    counts.events !== Object.keys(atoms.events).length
  ) {
    throw new Error("Lifecycle contract artifact counts are inconsistent");
  }

  const artifact = parsed as unknown as LifecycleContractArtifact;
  if (lifecycleContentDigest(artifact) !== artifact.contentDigest) {
    throw new Error(
      "Lifecycle contract artifact content digest does not match",
    );
  }
  return artifact;
}

export function renderLifecycleContractArtifact(
  artifact: LifecycleContractArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export function assertLifecycleVersionAdvance(
  previous: LifecycleContractArtifact,
  next: LifecycleContractArtifact,
): void {
  if (next.contractVersion < previous.contractVersion) {
    throw new Error(
      `Lifecycle contract version cannot decrease from ${previous.contractVersion} to ${next.contractVersion}`,
    );
  }
  if (
    previous.contentDigest !== next.contentDigest &&
    next.contractVersion <= previous.contractVersion
  ) {
    throw new Error(
      `Lifecycle contract changed without increasing contractVersion above ${previous.contractVersion}`,
    );
  }
}
