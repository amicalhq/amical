import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Simple App Tests', () => {
  test('packaged app launches successfully', async () => {
    // Path to the packaged app
    const appPath = path.join(__dirname, '..', 'out', 'Amical-darwin-arm64', 'Amical.app');
    
    // Verify app exists
    expect(fs.existsSync(appPath)).toBeTruthy();
    
    // Launch the app
    const electronApp = await electron.launch({
      executablePath: path.join(appPath, 'Contents', 'MacOS', 'Amical'),
      timeout: 30000,
    });
    
    try {
      // Wait for first window
      const window = await electronApp.firstWindow();
      
      // Basic checks
      expect(window).toBeTruthy();
      
      // Wait for app to stabilize
      await window.waitForTimeout(2000);
      
      // Check if window is visible
      const isVisible = await window.isVisible();
      expect(isVisible).toBe(true);
      
      // Take a screenshot for debugging
      await window.screenshot({ path: 'test-results/app-launched.png' });
      
    } finally {
      // Always close the app
      await electronApp.close();
    }
  });
});