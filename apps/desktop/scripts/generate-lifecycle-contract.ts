import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  LIFECYCLE_CONTRACT_ARTIFACT_PATH,
  assertLifecycleVersionAdvance,
  buildLifecycleContractArtifact,
  parseLifecycleContractArtifact,
  renderLifecycleContractArtifact,
} from "./lifecycle-contract/contract";

export function generateLifecycleContractArtifact(
  artifactPath = LIFECYCLE_CONTRACT_ARTIFACT_PATH,
): "unchanged" | "written" {
  const next = buildLifecycleContractArtifact();
  const rendered = renderLifecycleContractArtifact(next);

  if (existsSync(artifactPath)) {
    const previousSerialized = readFileSync(artifactPath, "utf8");
    const previous = parseLifecycleContractArtifact(previousSerialized);
    assertLifecycleVersionAdvance(previous, next);

    if (previousSerialized === rendered) {
      return "unchanged";
    }
  }

  writeFileSync(artifactPath, rendered, "utf8");
  return "written";
}

if (require.main === module) {
  const result = generateLifecycleContractArtifact();
  console.log(
    result === "written"
      ? `Wrote ${LIFECYCLE_CONTRACT_ARTIFACT_PATH}`
      : `Already up to date: ${LIFECYCLE_CONTRACT_ARTIFACT_PATH}`,
  );
}
