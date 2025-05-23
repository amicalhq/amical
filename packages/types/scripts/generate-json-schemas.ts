import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Import schemas from the types package
import { RpcRequestSchema } from '../src/schemas/rpc/request';
import { RpcResponseSchema } from '../src/schemas/rpc/response';
import { 
  GetAccessibilityTreeDetailsParamsSchema,
  GetAccessibilityTreeDetailsResultSchema 
} from '../src/schemas/methods/get-accessibility-tree-details';
import { 
  PasteTextParamsSchema,
  PasteTextResultSchema 
} from '../src/schemas/methods/paste-text';
import { 
  MuteSystemAudioParamsSchema,
  MuteSystemAudioResultSchema 
} from '../src/schemas/methods/mute-system-audio';
import { 
  RestoreSystemAudioParamsSchema,
  RestoreSystemAudioResultSchema 
} from '../src/schemas/methods/restore-system-audio';
import { 
  KeyDownEventSchema, 
  KeyUpEventSchema 
} from '../src/schemas/events/key-events';

// Output directory
const baseOutputDir = 'generated/json-schemas';

const schemasToGenerate = [
  { zod: RpcRequestSchema, name: 'RpcRequest', category: 'rpc' },
  { zod: RpcResponseSchema, name: 'RpcResponse', category: 'rpc' },
  {
    zod: GetAccessibilityTreeDetailsParamsSchema,
    name: 'GetAccessibilityTreeDetailsParams',
    category: 'methods',
  },
  {
    zod: GetAccessibilityTreeDetailsResultSchema,
    name: 'GetAccessibilityTreeDetailsResult',
    category: 'methods',
  },
  { zod: KeyDownEventSchema, name: 'KeyDownEvent', category: 'events' },
  { zod: KeyUpEventSchema, name: 'KeyUpEvent', category: 'events' },
  { zod: PasteTextParamsSchema, name: 'PasteTextParams', category: 'methods' },
  { zod: PasteTextResultSchema, name: 'PasteTextResult', category: 'methods' },
  {
    zod: RestoreSystemAudioParamsSchema,
    name: 'RestoreSystemAudioParams',
    category: 'methods',
  },
  {
    zod: RestoreSystemAudioResultSchema,
    name: 'RestoreSystemAudioResult',
    category: 'methods',
  },
  { zod: MuteSystemAudioParamsSchema, name: 'MuteSystemAudioParams', category: 'methods' },
  { zod: MuteSystemAudioResultSchema, name: 'MuteSystemAudioResult', category: 'methods' },
];

schemasToGenerate.forEach(({ zod, name, category }) => {
  const schemaOutputDir = path.join(baseOutputDir, category);

  // Ensure the output directory for the category exists
  if (!existsSync(schemaOutputDir)) {
    mkdirSync(schemaOutputDir, { recursive: true });
  }

  // Convert PascalCase or camelCase name to kebab-case for the filename
  const kebabCaseName = name
    .replace(/([A-Z])/g, (match, p1, offset) => (offset > 0 ? '-' : '') + p1.toLowerCase())
    .replace(/^-/, ''); // Remove leading dash if first letter was uppercase

  const outputPath = path.join(schemaOutputDir, `${kebabCaseName}.schema.json`);
  const jsonSchema = zodToJsonSchema(zod, name);

  writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2));
  console.log(`Generated JSON schema for ${name} at ${outputPath}`);
});

console.log(`All JSON schemas generated successfully in ${baseOutputDir}`); 