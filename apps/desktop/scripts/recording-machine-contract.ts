import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  transitionRecordingMachine,
  type RecordingMachineEvent,
  type RecordingMachineState,
  type RecordingMachineTransition,
} from "../src/main/managers/recording-state-machine";

export const RECORDING_MACHINE_CONTRACT_VERSION = 1;
export const RECORDING_MACHINE_CONTRACT_SOURCE =
  "src/main/managers/recording-state-machine.ts";

const EXPECTED_STATE_COUNT = 14;
const EXPECTED_EVENT_COUNT = 22;
const EXPECTED_VECTOR_COUNT = EXPECTED_STATE_COUNT * EXPECTED_EVENT_COUNT;

type StateAtomKeyFor<State extends RecordingMachineState> = State extends {
  tag: infer Tag extends string;
  mode: infer Mode extends string;
}
  ? `${Tag}:${Mode}`
  : State extends {
        tag: infer Tag extends string;
        firstChunkReceived: infer HasAudio extends boolean;
      }
    ? `${Tag}:${HasAudio}`
    : State extends {
          tag: infer Tag extends string;
          code: infer Code extends string;
        }
      ? `${Tag}:${Code}`
      : State extends { tag: infer Tag extends string }
        ? Tag
        : never;

type EventAtomKeyFor<Event extends RecordingMachineEvent> = Event extends {
  type: "start";
  mode: infer Mode extends string;
  hasSpeechModel: infer HasSpeechModel extends boolean;
}
  ? `start:${Mode}:${HasSpeechModel}`
  : Event extends {
        type: infer Type extends string;
        quick: infer Quick extends boolean;
      }
    ? `${Type}:${Quick}`
    : Event extends {
          type: "audioChunk";
          hasAudio: infer HasAudio extends boolean;
        }
      ? `audioChunk:${HasAudio}`
      : Event extends { type: infer Type extends string }
        ? Type
        : never;

export type RecordingMachineStateAtomKey =
  StateAtomKeyFor<RecordingMachineState>;
export type RecordingMachineEventAtomKey =
  EventAtomKeyFor<RecordingMachineEvent>;

export const RECORDING_MACHINE_STATE_ATOMS = {
  IDLE: { tag: "IDLE" },
  "STARTING:ptt": { tag: "STARTING", mode: "ptt" },
  "STARTING:hands-free": { tag: "STARTING", mode: "hands-free" },
  "REC_PTT:false": { tag: "REC_PTT", firstChunkReceived: false },
  "REC_PTT:true": { tag: "REC_PTT", firstChunkReceived: true },
  "PTT_Q:false": { tag: "PTT_Q", firstChunkReceived: false },
  "PTT_Q:true": { tag: "PTT_Q", firstChunkReceived: true },
  "REC_HF:false": { tag: "REC_HF", firstChunkReceived: false },
  "REC_HF:true": { tag: "REC_HF", firstChunkReceived: true },
  STOP_N: { tag: "STOP_N" },
  "STOP_C:quick_release": { tag: "STOP_C", code: "quick_release" },
  "STOP_C:no_audio": { tag: "STOP_C", code: "no_audio" },
  "STOP_C:interrupted_start": {
    tag: "STOP_C",
    code: "interrupted_start",
  },
  "STOP_C:user_dismissed": { tag: "STOP_C", code: "user_dismissed" },
} as const satisfies Record<
  RecordingMachineStateAtomKey,
  RecordingMachineState
>;

export const RECORDING_MACHINE_EVENT_ATOMS = {
  "start:ptt:false": {
    type: "start",
    mode: "ptt",
    hasSpeechModel: false,
  },
  "start:ptt:true": {
    type: "start",
    mode: "ptt",
    hasSpeechModel: true,
  },
  "start:hands-free:false": {
    type: "start",
    mode: "hands-free",
    hasSpeechModel: false,
  },
  "start:hands-free:true": {
    type: "start",
    mode: "hands-free",
    hasSpeechModel: true,
  },
  startSessionReady: { type: "startSessionReady" },
  "pttPress:false": { type: "pttPress", quick: false },
  "pttPress:true": { type: "pttPress", quick: true },
  "pttRelease:false": { type: "pttRelease", quick: false },
  "pttRelease:true": { type: "pttRelease", quick: true },
  "toggle:false": { type: "toggle", quick: false },
  "toggle:true": { type: "toggle", quick: true },
  signalStop: { type: "signalStop" },
  sessionFailure: { type: "sessionFailure" },
  dismiss: { type: "dismiss" },
  quickReleaseTimeout: { type: "quickReleaseTimeout" },
  noAudioTimeout: { type: "noAudioTimeout" },
  durationWarningTimeout: { type: "durationWarningTimeout" },
  maxDurationTimeout: { type: "maxDurationTimeout" },
  "audioChunk:false": { type: "audioChunk", hasAudio: false },
  "audioChunk:true": { type: "audioChunk", hasAudio: true },
  reset: { type: "reset" },
  forceReset: { type: "forceReset" },
} as const satisfies Record<
  RecordingMachineEventAtomKey,
  RecordingMachineEvent
>;

export interface RecordingMachineVector {
  state: RecordingMachineState;
  event: RecordingMachineEvent;
  expect: RecordingMachineTransition;
}

export interface RecordingMachineVectorArtifact {
  contractVersion: number;
  contentDigest: string;
  source: string;
  counts: {
    states: number;
    events: number;
    vectors: number;
  };
  vectors: RecordingMachineVector[];
}

function assertNever(value: never): never {
  throw new Error(`Unhandled recording machine atom: ${JSON.stringify(value)}`);
}

export function encodeRecordingMachineStateAtom(
  state: RecordingMachineState,
): RecordingMachineStateAtomKey {
  switch (state.tag) {
    case "IDLE":
    case "STOP_N":
      return state.tag;
    case "STARTING":
      return `${state.tag}:${state.mode}`;
    case "REC_PTT":
    case "PTT_Q":
    case "REC_HF":
      return `${state.tag}:${state.firstChunkReceived}`;
    case "STOP_C":
      return `${state.tag}:${state.code}`;
    default:
      return assertNever(state);
  }
}

export function encodeRecordingMachineEventAtom(
  event: RecordingMachineEvent,
): RecordingMachineEventAtomKey {
  switch (event.type) {
    case "start":
      return `${event.type}:${event.mode}:${event.hasSpeechModel}`;
    case "pttPress":
    case "pttRelease":
    case "toggle":
      return `${event.type}:${event.quick}`;
    case "audioChunk":
      return `${event.type}:${event.hasAudio}`;
    case "startSessionReady":
    case "signalStop":
    case "sessionFailure":
    case "dismiss":
    case "quickReleaseTimeout":
    case "noAudioTimeout":
    case "durationWarningTimeout":
    case "maxDurationTimeout":
    case "reset":
    case "forceReset":
      return event.type;
    default:
      return assertNever(event);
  }
}

function assertManifestMatchesEncoder<Atom>(
  name: string,
  manifest: Record<string, Atom>,
  encode: (atom: Atom) => string,
  expectedCount: number,
): void {
  const entries = Object.entries(manifest);
  if (entries.length !== expectedCount) {
    throw new Error(
      `${name} manifest has ${entries.length} atoms; expected ${expectedCount}`,
    );
  }

  for (const [key, atom] of entries) {
    const encodedKey = encode(atom);
    if (encodedKey !== key) {
      throw new Error(`${name} manifest key ${key} encodes as ${encodedKey}`);
    }
  }
}

export function assertRecordingMachineManifests(): void {
  assertManifestMatchesEncoder(
    "state",
    RECORDING_MACHINE_STATE_ATOMS,
    encodeRecordingMachineStateAtom,
    EXPECTED_STATE_COUNT,
  );
  assertManifestMatchesEncoder(
    "event",
    RECORDING_MACHINE_EVENT_ATOMS,
    encodeRecordingMachineEventAtom,
    EXPECTED_EVENT_COUNT,
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function buildRecordingMachineVectors(): RecordingMachineVector[] {
  assertRecordingMachineManifests();

  const states = Object.values(
    RECORDING_MACHINE_STATE_ATOMS,
  ) as RecordingMachineState[];
  const events = Object.values(
    RECORDING_MACHINE_EVENT_ATOMS,
  ) as RecordingMachineEvent[];
  const vectors: RecordingMachineVector[] = [];

  for (const state of states) {
    for (const event of events) {
      const stateInput = clone(state);
      const eventInput = clone(event);
      const stateSnapshot = clone(stateInput);
      const eventSnapshot = clone(eventInput);
      const transition = transitionRecordingMachine(stateInput, eventInput);

      if (
        !isDeepStrictEqual(stateInput, stateSnapshot) ||
        !isDeepStrictEqual(eventInput, eventSnapshot)
      ) {
        throw new Error(
          `Recording reducer mutated ${encodeRecordingMachineStateAtom(stateSnapshot)} × ` +
            encodeRecordingMachineEventAtom(eventSnapshot),
        );
      }

      vectors.push({
        state: stateSnapshot,
        event: eventSnapshot,
        expect: clone(transition),
      });
    }
  }

  if (vectors.length !== EXPECTED_VECTOR_COUNT) {
    throw new Error(
      `Generated ${vectors.length} recording vectors; expected ${EXPECTED_VECTOR_COUNT}`,
    );
  }

  return vectors;
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

export function recordingMachineContentDigest(
  vectors: readonly RecordingMachineVector[],
): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(vectors), "utf8")
    .digest("hex")}`;
}

export function buildRecordingMachineVectorArtifact(): RecordingMachineVectorArtifact {
  const vectors = buildRecordingMachineVectors();
  return {
    contractVersion: RECORDING_MACHINE_CONTRACT_VERSION,
    contentDigest: recordingMachineContentDigest(vectors),
    source: RECORDING_MACHINE_CONTRACT_SOURCE,
    counts: {
      states: EXPECTED_STATE_COUNT,
      events: EXPECTED_EVENT_COUNT,
      vectors: EXPECTED_VECTOR_COUNT,
    },
    vectors,
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

export function parseRecordingMachineVectorArtifact(
  serialized: string,
): RecordingMachineVectorArtifact {
  const parsed: unknown = JSON.parse(serialized);
  if (!isObject(parsed)) {
    throw new Error("Recording vector artifact must be an object");
  }

  assertExactKeys("Recording vector artifact", parsed, [
    "contractVersion",
    "contentDigest",
    "source",
    "counts",
    "vectors",
  ]);

  if (
    !Number.isInteger(parsed.contractVersion) ||
    (parsed.contractVersion as number) < 1
  ) {
    throw new Error("Recording contract version must be a positive integer");
  }
  if (
    typeof parsed.contentDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(parsed.contentDigest)
  ) {
    throw new Error("Recording vector artifact has an invalid content digest");
  }
  if (typeof parsed.source !== "string" || parsed.source.length === 0) {
    throw new Error("Recording vector artifact source must be a path");
  }
  if (!isObject(parsed.counts)) {
    throw new Error("Recording vector artifact counts must be an object");
  }
  assertExactKeys("Recording vector counts", parsed.counts, [
    "states",
    "events",
    "vectors",
  ]);
  if (!Array.isArray(parsed.vectors)) {
    throw new Error("Recording vector artifact vectors must be an array");
  }

  const { states, events, vectors } = parsed.counts;
  if (
    !Number.isInteger(states) ||
    (states as number) < 1 ||
    !Number.isInteger(events) ||
    (events as number) < 1 ||
    !Number.isInteger(vectors) ||
    (vectors as number) < 1 ||
    (states as number) * (events as number) !== vectors ||
    vectors !== parsed.vectors.length
  ) {
    throw new Error("Recording vector artifact counts are inconsistent");
  }

  const artifact = parsed as unknown as RecordingMachineVectorArtifact;
  if (
    recordingMachineContentDigest(artifact.vectors) !== artifact.contentDigest
  ) {
    throw new Error("Recording vector artifact content digest does not match");
  }

  return artifact;
}

export function renderRecordingMachineVectorArtifact(
  artifact: RecordingMachineVectorArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export function assertRecordingMachineVersionAdvance(
  previous: RecordingMachineVectorArtifact,
  next: RecordingMachineVectorArtifact,
): void {
  if (next.contractVersion < previous.contractVersion) {
    throw new Error(
      `Recording contract version cannot decrease from ${previous.contractVersion} to ${next.contractVersion}`,
    );
  }

  if (
    previous.contentDigest !== next.contentDigest &&
    next.contractVersion <= previous.contractVersion
  ) {
    throw new Error(
      `Recording vectors changed without increasing contractVersion above ${previous.contractVersion}`,
    );
  }
}
