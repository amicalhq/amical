import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { zodToJsonSchema } from "zod-to-json-schema";

// Import schemas from the types package
import { RpcRequestSchema } from "../src/schemas/rpc/request.js";
import { RpcResponseSchema } from "../src/schemas/rpc/response.js";
import {
  GetAccessibilityTreeDetailsParamsSchema,
  GetAccessibilityTreeDetailsResultSchema,
} from "../src/schemas/methods/get-accessibility-tree-details.js";
import {
  GetAccessibilityContextParamsSchema,
  GetAccessibilityContextResultSchema,
} from "../src/schemas/methods/get-accessibility-context.js";
import {
  PasteTextParamsSchema,
  PasteTextResultSchema,
} from "../src/schemas/methods/paste-text.js";
import {
  MuteSystemAudioParamsSchema,
  MuteSystemAudioResultSchema,
} from "../src/schemas/methods/mute-system-audio.js";
import {
  RestoreSystemAudioParamsSchema,
  RestoreSystemAudioResultSchema,
} from "../src/schemas/methods/restore-system-audio.js";
import {
  SetShortcutsParamsSchema,
  SetShortcutsResultSchema,
} from "../src/schemas/methods/set-shortcuts.js";
import {
  KeyDownEventSchema,
  KeyUpEventSchema,
  FlagsChangedEventSchema,
  HelperEventSchema,
} from "../src/schemas/events/key-events.js";

// Output directory
const baseOutputDir = "generated/json-schemas";

const schemasToGenerate = [
  { zod: RpcRequestSchema, name: "RpcRequest", category: "rpc" },
  { zod: RpcResponseSchema, name: "RpcResponse", category: "rpc" },
  {
    zod: GetAccessibilityTreeDetailsParamsSchema,
    name: "GetAccessibilityTreeDetailsParams",
    category: "methods",
  },
  {
    zod: GetAccessibilityTreeDetailsResultSchema,
    name: "GetAccessibilityTreeDetailsResult",
    category: "methods",
  },
  {
    zod: GetAccessibilityContextParamsSchema,
    name: "GetAccessibilityContextParams",
    category: "methods",
  },
  {
    zod: GetAccessibilityContextResultSchema,
    name: "GetAccessibilityContextResult",
    category: "methods",
  },
  { zod: KeyDownEventSchema, name: "KeyDownEvent", category: "events" },
  { zod: KeyUpEventSchema, name: "KeyUpEvent", category: "events" },
  {
    zod: FlagsChangedEventSchema,
    name: "FlagsChangedEvent",
    category: "events",
  },
  { zod: HelperEventSchema, name: "HelperEvent", category: "events" },
  { zod: PasteTextParamsSchema, name: "PasteTextParams", category: "methods" },
  { zod: PasteTextResultSchema, name: "PasteTextResult", category: "methods" },
  {
    zod: RestoreSystemAudioParamsSchema,
    name: "RestoreSystemAudioParams",
    category: "methods",
  },
  {
    zod: RestoreSystemAudioResultSchema,
    name: "RestoreSystemAudioResult",
    category: "methods",
  },
  {
    zod: MuteSystemAudioParamsSchema,
    name: "MuteSystemAudioParams",
    category: "methods",
  },
  {
    zod: MuteSystemAudioResultSchema,
    name: "MuteSystemAudioResult",
    category: "methods",
  },
  {
    zod: SetShortcutsParamsSchema,
    name: "SetShortcutsParams",
    category: "methods",
  },
  {
    zod: SetShortcutsResultSchema,
    name: "SetShortcutsResult",
    category: "methods",
  },
];

schemasToGenerate.forEach(({ zod, name, category }) => {
  const schemaOutputDir = path.join(baseOutputDir, category);

  // Ensure the output directory for the category exists
  if (!existsSync(schemaOutputDir)) {
    mkdirSync(schemaOutputDir, { recursive: true });
  }

  // Convert PascalCase or camelCase name to kebab-case for the filename
  const kebabCaseName = name
    .replace(
      /([A-Z])/g,
      (match, p1, offset) => (offset > 0 ? "-" : "") + p1.toLowerCase(),
    )
    .replace(/^-/, ""); // Remove leading dash if first letter was uppercase

  const outputPath = path.join(schemaOutputDir, `${kebabCaseName}.schema.json`);
  const jsonSchema = zodToJsonSchema(zod, name);

  writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2));
  console.log(`Generated JSON schema for ${name} at ${outputPath}`);
});

console.log(`All JSON schemas generated successfully in ${baseOutputDir}`);
