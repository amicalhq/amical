const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const generatedDir = 'src/helper/swift/KeyTapHelper/Sources/KeyTapHelper/models/generated';

try {
  // Remove existing generated models and create the directory
  if (fs.existsSync(generatedDir)) {
    fs.rmSync(generatedDir, { recursive: true, force: true });
  }
  fs.mkdirSync(generatedDir, { recursive: true });

  console.log('Directory created/cleaned successfully.');

  // Generate Swift models from JSON schemas using quicktype
  const commands = [
    'quicktype --src-lang schema --lang swift ' +
      '-o src/helper/swift/KeyTapHelper/Sources/KeyTapHelper/models/generated/models.swift ' +
      'generated/schemas/helper-envelopes/rpc-request.schema.json ' +
      'generated/schemas/helper-envelopes/rpc-response.schema.json ' +
      'generated/schemas/helper-requests/get-accessibility-tree-details-params.schema.json ' +
      'generated/schemas/helper-responses/get-accessibility-tree-details-result.schema.json ' +
      'generated/schemas/helper-requests/paste-text-params.schema.json ' +
      'generated/schemas/helper-responses/paste-text-result.schema.json ' +
      'generated/schemas/helper-requests/mute-system-audio-params.schema.json ' +
      'generated/schemas/helper-responses/mute-system-audio-result.schema.json ' +
      'generated/schemas/helper-requests/restore-system-audio-params.schema.json ' +
      'generated/schemas/helper-responses/restore-system-audio-result.schema.json ' +
      'generated/schemas/helper-events/key-down-event.schema.json ' +
      'generated/schemas/helper-events/key-up-event.schema.json',
  ];

  commands.forEach((command) => {
    console.log(`Executing: ${command}`);
    execSync(command, { stdio: 'inherit' });
  });

  console.log('Swift models generated successfully.');
} catch (error) {
  console.error('Error generating Swift models:', error);
  process.exit(1);
}
