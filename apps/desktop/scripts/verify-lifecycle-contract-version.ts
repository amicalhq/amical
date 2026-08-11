import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LIFECYCLE_CONTRACT_ARTIFACT_PATH,
  assertLifecycleVersionAdvance,
  parseLifecycleContractArtifact,
  type LifecycleContractArtifact,
} from "./lifecycle-contract/contract";

const WORKSPACE_ROOT = resolve(__dirname, "../../..");
const ARTIFACT_REPOSITORY_PATH =
  "apps/desktop/tests/main/lifecycle-contract.json";

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: WORKSPACE_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function verifyLifecycleContractVersion(
  current: LifecycleContractArtifact,
  base: LifecycleContractArtifact | null,
): void {
  if (base === null) {
    if (current.contractVersion !== 1) {
      throw new Error(
        "The initial lifecycle contract artifact must use contractVersion 1",
      );
    }
    return;
  }
  assertLifecycleVersionAdvance(base, current);
}

function readBaseArtifact(
  baseRevision: string,
): LifecycleContractArtifact | null {
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
      `Lifecycle contract base revision is unavailable: ${baseRevision}`,
    );
  }
  if (!artifactPath) {
    return null;
  }
  return parseLifecycleContractArtifact(
    git(["show", `${baseRevision}:${ARTIFACT_REPOSITORY_PATH}`]),
  );
}

export function verifyLifecycleContractVersionAgainstBase(
  baseRevision: string,
): void {
  const current = parseLifecycleContractArtifact(
    readFileSync(LIFECYCLE_CONTRACT_ARTIFACT_PATH, "utf8"),
  );
  verifyLifecycleContractVersion(current, readBaseArtifact(baseRevision));
}

if (require.main === module) {
  const baseRevision = process.argv[2];
  if (!baseRevision) {
    throw new Error("A lifecycle contract base revision is required");
  }
  verifyLifecycleContractVersionAgainstBase(baseRevision);
  console.log(
    `Lifecycle contract version is valid relative to ${baseRevision}`,
  );
}
