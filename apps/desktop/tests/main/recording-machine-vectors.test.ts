import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RECORDING_MACHINE_CONTRACT_VERSION,
  RECORDING_MACHINE_EVENT_ATOMS,
  RECORDING_MACHINE_STATE_ATOMS,
  assertRecordingMachineManifests,
  assertRecordingMachineVersionAdvance,
  buildRecordingMachineVectorArtifact,
  encodeRecordingMachineEventAtom,
  encodeRecordingMachineStateAtom,
  parseRecordingMachineVectorArtifact,
  recordingMachineContentDigest,
  renderRecordingMachineVectorArtifact,
} from "../../scripts/recording-machine-contract";
import { RECORDING_MACHINE_VECTOR_ARTIFACT_PATH } from "../../scripts/generate-recording-machine-vectors";

const readCheckedArtifact = () => {
  const serialized = readFileSync(
    RECORDING_MACHINE_VECTOR_ARTIFACT_PATH,
    "utf8",
  );
  return {
    artifact: parseRecordingMachineVectorArtifact(serialized),
    serialized,
  };
};

describe("recording machine contract vectors", () => {
  it("declares the complete concrete state and event domains", () => {
    expect(assertRecordingMachineManifests).not.toThrow();
    expect(Object.keys(RECORDING_MACHINE_STATE_ATOMS)).toHaveLength(14);
    expect(Object.keys(RECORDING_MACHINE_EVENT_ATOMS)).toHaveLength(22);
  });

  it("matches the checked artifact generated from the reducer", () => {
    const { artifact, serialized } = readCheckedArtifact();
    const expected = buildRecordingMachineVectorArtifact();

    expect(artifact).toEqual(expected);
    expect(serialized).toBe(renderRecordingMachineVectorArtifact(expected));
    expect(artifact.contractVersion).toBe(RECORDING_MACHINE_CONTRACT_VERSION);
    expect(artifact.contentDigest).toBe(
      recordingMachineContentDigest(artifact.vectors),
    );
  });

  it("contains every state and event pair exactly once", () => {
    const { artifact } = readCheckedArtifact();
    const stateKeys = Object.keys(RECORDING_MACHINE_STATE_ATOMS).sort();
    const eventKeys = Object.keys(RECORDING_MACHINE_EVENT_ATOMS).sort();
    const artifactStateKeys = [
      ...new Set(
        artifact.vectors.map(({ state }) =>
          encodeRecordingMachineStateAtom(state),
        ),
      ),
    ].sort();
    const artifactEventKeys = [
      ...new Set(
        artifact.vectors.map(({ event }) =>
          encodeRecordingMachineEventAtom(event),
        ),
      ),
    ].sort();
    const pairs = new Set(
      artifact.vectors.map(
        ({ state, event }) =>
          `${encodeRecordingMachineStateAtom(state)}\u0000${encodeRecordingMachineEventAtom(event)}`,
      ),
    );

    expect(artifactStateKeys).toEqual(stateKeys);
    expect(artifactEventKeys).toEqual(eventKeys);
    expect(pairs.size).toBe(14 * 22);
    expect(artifact.vectors).toHaveLength(14 * 22);
  });

  it("validates a prior artifact independently of the current domain", () => {
    const current = buildRecordingMachineVectorArtifact();
    const vectors = [current.vectors[0]!];
    const previous = {
      ...current,
      source: "src/main/managers/previous-recording-state-machine.ts",
      counts: { states: 1, events: 1, vectors: 1 },
      contentDigest: recordingMachineContentDigest(vectors),
      vectors,
    };

    expect(
      parseRecordingMachineVectorArtifact(
        renderRecordingMachineVectorArtifact(previous),
      ),
    ).toEqual(previous);
    expect(() =>
      parseRecordingMachineVectorArtifact(
        renderRecordingMachineVectorArtifact({
          ...previous,
          contentDigest: `sha256:${"0".repeat(64)}`,
        }),
      ),
    ).toThrow("content digest does not match");
  });

  it("requires a higher version when vector content changes", () => {
    const current = buildRecordingMachineVectorArtifact();
    const changedVectors = structuredClone(current.vectors);
    changedVectors[0]!.expect.commands = [];
    const changed = {
      ...current,
      contentDigest: recordingMachineContentDigest(changedVectors),
      vectors: changedVectors,
    };

    expect(() =>
      assertRecordingMachineVersionAdvance(current, changed),
    ).toThrow("changed without increasing contractVersion");
    expect(() =>
      assertRecordingMachineVersionAdvance(current, {
        ...changed,
        contractVersion: current.contractVersion - 1,
      }),
    ).toThrow("cannot decrease");
    expect(() =>
      assertRecordingMachineVersionAdvance(current, {
        ...changed,
        contractVersion: current.contractVersion + 1,
      }),
    ).not.toThrow();
  });
});
