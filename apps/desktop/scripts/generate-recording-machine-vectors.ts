import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertRecordingMachineVersionAdvance,
  buildRecordingMachineVectorArtifact,
  parseRecordingMachineVectorArtifact,
  renderRecordingMachineVectorArtifact,
} from "./recording-machine-contract";

export const RECORDING_MACHINE_VECTOR_ARTIFACT_PATH = resolve(
  __dirname,
  "../tests/main/recording-machine-vectors.json",
);

export function generateRecordingMachineVectorArtifact(
  artifactPath = RECORDING_MACHINE_VECTOR_ARTIFACT_PATH,
): "unchanged" | "written" {
  const next = buildRecordingMachineVectorArtifact();
  const rendered = renderRecordingMachineVectorArtifact(next);

  if (existsSync(artifactPath)) {
    const previousSerialized = readFileSync(artifactPath, "utf8");
    const previous = parseRecordingMachineVectorArtifact(previousSerialized);
    assertRecordingMachineVersionAdvance(previous, next);

    if (previousSerialized === rendered) {
      return "unchanged";
    }
  }

  writeFileSync(artifactPath, rendered, "utf8");
  return "written";
}

if (require.main === module) {
  const result = generateRecordingMachineVectorArtifact();
  console.log(
    result === "written"
      ? `Wrote ${RECORDING_MACHINE_VECTOR_ARTIFACT_PATH}`
      : `Already up to date: ${RECORDING_MACHINE_VECTOR_ARTIFACT_PATH}`,
  );
}
