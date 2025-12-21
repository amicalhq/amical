import { execSync } from "child_process";
import fs from "fs";

const generatedDir =
  "../native-helpers/swift-helper/Sources/SwiftHelper/models/generated";

try {
  // Remove existing generated models and create the directory
  if (fs.existsSync(generatedDir)) {
    fs.rmSync(generatedDir, { recursive: true, force: true });
  }
  fs.mkdirSync(generatedDir, { recursive: true });

  console.log("Directory created/cleaned successfully.");

  // Generate Swift models from JSON schemas using quicktype
  const commands = [
    "quicktype --src-lang schema --lang swift " +
      `-o ${generatedDir}/models.swift ` +
      "generated/json-schemas/rpc/rpc-request.schema.json " +
      "generated/json-schemas/rpc/rpc-response.schema.json " +
      "generated/json-schemas/methods/get-accessibility-tree-details-params.schema.json " +
      "generated/json-schemas/methods/get-accessibility-tree-details-result.schema.json " +
      "generated/json-schemas/methods/get-accessibility-context-params.schema.json " +
      "generated/json-schemas/methods/get-accessibility-context-result.schema.json " +
      "generated/json-schemas/methods/paste-text-params.schema.json " +
      "generated/json-schemas/methods/paste-text-result.schema.json " +
      "generated/json-schemas/methods/mute-system-audio-params.schema.json " +
      "generated/json-schemas/methods/mute-system-audio-result.schema.json " +
      "generated/json-schemas/methods/restore-system-audio-params.schema.json " +
      "generated/json-schemas/methods/restore-system-audio-result.schema.json " +
      "generated/json-schemas/methods/set-shortcuts-params.schema.json " +
      "generated/json-schemas/methods/set-shortcuts-result.schema.json " +
      "generated/json-schemas/events/key-down-event.schema.json " +
      "generated/json-schemas/events/key-up-event.schema.json " +
      "generated/json-schemas/events/flags-changed-event.schema.json " +
      "generated/json-schemas/events/helper-event.schema.json",
  ];

  commands.forEach((command) => {
    console.log(`Executing: ${command}`);
    execSync(command, { stdio: "inherit" });
  });

  console.log("Swift models generated successfully.");
} catch (error) {
  console.error("Error generating Swift models:", error);
  process.exit(1);
}
