import { execSync } from "child_process";
import fs from "fs";

// Rust models for the Linux helper. Like the Swift and C# models, the output
// is gitignored and generate:all writes it again.
const outputFile = "../native-helpers/linux-helper/src/models/generated.rs";
const schemaDir = "generated/json-schemas";

// Params and result of every method, and the events that the Linux helper
// sends. Not in the list:
// - rpc/rpc-response: the helper writes its own envelope. quicktype types the
//   `any` result as an Option that it writes as null, but a response must
//   omit the field that it does not use.
// - methods/get-helper-capabilities-result: set-helper-options-result holds
//   the same object as `capabilities`. quicktype never merges top-level types,
//   so it would make two identical structs. The helper uses `Capabilities`.
// - events/helper-event: it holds only the macOS and Windows events.
// - events/flags-changed-event: no helper sends it.
const schemaNames = [
  "rpc/rpc-request",
  "methods/get-accessibility-tree-details-params",
  "methods/get-accessibility-tree-details-result",
  "methods/get-accessibility-context-params",
  "methods/get-accessibility-context-result",
  "methods/get-accessibility-status-params",
  "methods/get-accessibility-status-result",
  "methods/request-accessibility-permission-params",
  "methods/request-accessibility-permission-result",
  "methods/paste-text-params",
  "methods/paste-text-result",
  "methods/start-recording-params",
  "methods/start-recording-result",
  "methods/stop-recording-params",
  "methods/stop-recording-result",
  "methods/set-shortcuts-params",
  "methods/set-shortcuts-result",
  "methods/set-draft-enter-capture-params",
  "methods/set-draft-enter-capture-result",
  "methods/set-allow-injected-keys-params",
  "methods/set-allow-injected-keys-result",
  "methods/recheck-pressed-keys-params",
  "methods/recheck-pressed-keys-result",
  "methods/get-selected-text-via-copy-params",
  "methods/get-selected-text-via-copy-result",
  "methods/start-edit-watch-params",
  "methods/start-edit-watch-result",
  "methods/read-edit-watch-params",
  "methods/read-edit-watch-result",
  "methods/stop-edit-watch-params",
  "methods/stop-edit-watch-result",
  "methods/get-helper-capabilities-params",
  "methods/set-helper-options-params",
  "methods/set-helper-options-result",
  "methods/prepare-injection-params",
  "methods/prepare-injection-result",
  "events/key-down-event",
  "events/key-up-event",
  "events/active-display-changed-event",
  "events/shortcut-activated-event",
  "events/shortcut-deactivated-event",
  "events/shortcuts-bound-event",
];
const schemaFiles = schemaNames.map(
  (name) => `${schemaDir}/${name}.schema.json`,
);

type JsonSchema = { [key: string]: unknown };

// zod writes `.nullable()` as `anyOf: [<type>, { type: "null" }]`.
function allowsNull(schema: unknown): boolean {
  const { anyOf } = schema as JsonSchema;
  return (
    Array.isArray(anyOf) &&
    anyOf.some((option) => (option as JsonSchema).type === "null")
  );
}

// Property names that accept null (`.nullable()`), and property names that
// may be left out but do not accept null (`.optional()`).
function collectProperties(
  schema: unknown,
  nullable: Set<string>,
  optional: Set<string>,
): void {
  if (!schema || typeof schema !== "object") return;
  const { properties, required } = schema as JsonSchema;
  if (properties && typeof properties === "object") {
    const requiredNames = new Set(Array.isArray(required) ? required : []);
    for (const [name, property] of Object.entries(properties)) {
      if (allowsNull(property)) nullable.add(name);
      else if (!requiredNames.has(name)) optional.add(name);
    }
  }
  for (const value of Object.values(schema)) {
    collectProperties(value, nullable, optional);
  }
}

// quicktype's --skip-serializing-none leaves out every None field. That is
// right for `.optional()` fields (the zod schema rejects null), but a
// `.nullable()` field should go on the wire as null. This removes the skip
// attribute from the fields whose JSON name accepts null. quicktype writes
// them as snake_case fields in camelCase structs.
function writeNullableFieldsAsNull(
  rust: string,
  nullable: Set<string>,
): string {
  for (const name of nullable) {
    const field = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const skipped = new RegExp(
      `^ {4}#\\[serde\\(skip_serializing_if = "Option::is_none"\\)\\]\\n(?= {4}pub ${field}: )`,
      "gm",
    );
    if (!skipped.test(rust)) {
      throw new Error(`quicktype output has no skipped field "${field}"`);
    }
    rust = rust.replace(skipped, "");
  }
  return rust;
}

try {
  // Only the results and events that the helper writes matter: serde
  // ignores the skip attribute when it reads a request.
  const written = schemaFiles.filter(
    (file) => file.endsWith("-result.schema.json") || file.includes("/events/"),
  );
  const nullable = new Set<string>();
  const optional = new Set<string>();
  for (const file of written) {
    collectProperties(
      JSON.parse(fs.readFileSync(file, "utf8")),
      nullable,
      optional,
    );
  }
  // The rewrite works on JSON names, so a name must mean the same in every
  // schema that the helper writes.
  const ambiguous = [...nullable].filter((name) => optional.has(name));
  if (ambiguous.length > 0) {
    throw new Error(
      `Properties that are nullable in one schema and optional in another: ${ambiguous.join(", ")}`,
    );
  }

  const command =
    "quicktype --src-lang schema --lang rust " +
    "--derive-debug --derive-clone --derive-partial-eq " +
    "--skip-serializing-none --visibility public --density normal " +
    `-o ${outputFile} ` +
    schemaFiles.join(" ");
  console.log("Executing quicktype...");
  execSync(command, { stdio: "inherit" });

  let content = fs.readFileSync(outputFile, "utf8");

  // Remove quicktype's "Example code" comment block.
  const useLine = content.indexOf("use serde::");
  if (useLine === -1) {
    throw new Error("Could not find the serde import in quicktype's output");
  }
  content = content.slice(useLine);

  // Remove the "Schema" suffix from type names, as the C# models do.
  content = content.replace(/(\w+)Schema/g, "$1");

  content = writeNullableFieldsAsNull(content, nullable);

  const header = `// <auto-generated />
// Generated by packages/types/scripts/generate-rust-models.ts from the JSON
// schemas. DO NOT EDIT. Change the zod schemas in packages/types, then run
// \`pnpm --filter @amical/types generate:all\`.
#![allow(dead_code, clippy::all)]

`;
  fs.writeFileSync(outputFile, header + content);

  console.log("Rust models generated successfully.");
} catch (error) {
  console.error("Error generating Rust models:", error);
  process.exit(1);
}
