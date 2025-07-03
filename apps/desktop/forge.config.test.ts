import baseConfig from './forge.config';
import type { ForgeConfig } from "@electron-forge/shared-types";

// Test-specific configuration that disables ASAR for Playwright compatibility
const testConfig: ForgeConfig = {
  ...baseConfig,
  packagerConfig: {
    ...baseConfig.packagerConfig,
    // Disable ASAR for testing
    asar: false,
    // Add test-specific naming
    name: "Amical-Test",
    // Disable code signing for tests
    osxSign: false,
    osxNotarize: false,
  },
};

export default testConfig;