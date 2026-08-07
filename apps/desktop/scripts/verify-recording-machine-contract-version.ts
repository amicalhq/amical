import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertRecordingMachineVersionAdvance,
  parseRecordingMachineVectorArtifact,
  type RecordingMachineVectorArtifact,
} from "./recording-machine-contract";
import { RECORDING_MACHINE_VECTOR_ARTIFACT_PATH } from "./generate-recording-machine-vectors";

const WORKSPACE_ROOT = resolve(__dirname, "../../..");
const ARTIFACT_REPOSITORY_PATH =
  "apps/desktop/tests/main/recording-machine-vectors.json";

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: WORKSPACE_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function verifyRecordingMachineContractVersion(
  current: RecordingMachineVectorArtifact,
  base: RecordingMachineVectorArtifact | null,
): void {
  if (base === null) {
    if (current.contractVersion !== 1) {
      throw new Error(
        "The initial recording contract artifact must use contractVersion 1",
      );
    }
    return;
  }

  assertRecordingMachineVersionAdvance(base, current);
}

function readBaseArtifact(
  baseRevision: string,
): RecordingMachineVectorArtifact | null {
  let artifactPath: string;
  try {
    artifactPath = git([
      "ls-tree",
      "-r",
      "--name-only",
      baseRevision,
      "--",
      ARTIFACT_REPOSITORY_PATH,
    ]).trim();
  } catch {
    throw new Error(
      `Recording contract base revision is unavailable: ${baseRevision}`,
    );
  }

  if (!artifactPath) {
    return null;
  }

  return parseRecordingMachineVectorArtifact(
    git(["show", `${baseRevision}:${ARTIFACT_REPOSITORY_PATH}`]),
  );
}

export function verifyRecordingMachineContractVersionAgainstBase(
  baseRevision: string,
): void {
  const current = parseRecordingMachineVectorArtifact(
    readFileSync(RECORDING_MACHINE_VECTOR_ARTIFACT_PATH, "utf8"),
  );
  verifyRecordingMachineContractVersion(
    current,
    readBaseArtifact(baseRevision),
  );
}

if (require.main === module) {
  const baseRevision = process.argv[2];
  if (!baseRevision) {
    throw new Error("A recording contract base revision is required");
  }

  verifyRecordingMachineContractVersionAgainstBase(baseRevision);
  console.log(
    `Recording contract version is valid relative to ${baseRevision}`,
  );
}
