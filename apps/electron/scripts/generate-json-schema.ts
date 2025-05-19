import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Import new Zod schemas
import { RpcRequestSchema } from '../src/schemas/helper-envelopes/request';
import { RpcResponseSchema } from '../src/schemas/helper-envelopes/response';
import { GetAccessibilityTreeDetailsParamsSchema } from '../src/schemas/helper-requests/get-accessibility-tree-details';
import { GetAccessibilityTreeDetailsResultSchema } from '../src/schemas/helper-responses/get-accessibility-tree-details';
import { KeyDownEventSchema, KeyUpEventSchema } from '../src/schemas/helper-events/key-event';
import { PasteTextParamsSchema } from '../src/schemas/helper-requests/paste-text';
import { PasteTextResultSchema } from '../src/schemas/helper-responses/paste-text';
import { RestoreSystemAudioParamsSchema } from '../src/schemas/helper-requests/restore-system-audio';
import { RestoreSystemAudioResultSchema } from '../src/schemas/helper-responses/restore-system-audio';
import { MuteSystemAudioParamsSchema } from '../src/schemas/helper-requests/mute-system-audio';
import { MuteSystemAudioResultSchema } from '../src/schemas/helper-responses/mute-system-audio';

// Output directory as per rpc.md
const baseOutputDir = 'generated/schemas';

const schemasToGenerate = [
  { zod: RpcRequestSchema, name: 'RpcRequest', category: 'helper-envelopes' },
  { zod: RpcResponseSchema, name: 'RpcResponse', category: 'helper-envelopes' },
  {
    zod: GetAccessibilityTreeDetailsParamsSchema,
    name: 'GetAccessibilityTreeDetailsParams',
    category: 'helper-requests',
  },
  {
    zod: GetAccessibilityTreeDetailsResultSchema,
    name: 'GetAccessibilityTreeDetailsResult',
    category: 'helper-responses',
  },
  { zod: KeyDownEventSchema, name: 'KeyDownEvent', category: 'helper-events' }, // For unsolicited events
  { zod: KeyUpEventSchema, name: 'KeyUpEvent', category: 'helper-events' }, // For unsolicited events
  { zod: PasteTextParamsSchema, name: 'PasteTextParams', category: 'helper-requests' },
  { zod: PasteTextResultSchema, name: 'PasteTextResult', category: 'helper-responses' },
  {
    zod: RestoreSystemAudioParamsSchema,
    name: 'RestoreSystemAudioParams',
    category: 'helper-requests',
  },
  {
    zod: RestoreSystemAudioResultSchema,
    name: 'RestoreSystemAudioResult',
    category: 'helper-responses',
  },
  { zod: MuteSystemAudioParamsSchema, name: 'MuteSystemAudioParams', category: 'helper-requests' },
  { zod: MuteSystemAudioResultSchema, name: 'MuteSystemAudioResult', category: 'helper-responses' },
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
